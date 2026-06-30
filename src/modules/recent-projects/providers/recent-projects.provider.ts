import * as vscode from 'vscode';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { getReactWebviewHtml } from '../../../utils/WebviewHelper';
import { ExtensionContextProvider } from '../../../common/providers/extension-context.provider';
import { RecentProjectsService } from '../recent-projects.service';
import {
  RECENT_PROJECTS_CONTEXT_KEYS,
  RECENT_PROJECTS_STORAGE_KEYS,
} from '../recent-projects.constant';
import type {
  GitFileStatus,
  RecentProjectFileItem,
  RecentProjectItem,
  RecentProjectsWebviewMessage,
  WebviewRequestId,
} from '../recent-projects.type';

const execFileAsync = promisify(execFile);

export class RecentProjectsProvider implements vscode.WebviewViewProvider {
  public static inject = [ExtensionContextProvider, RecentProjectsService];

  public currentActivePath = '';

  private view?: vscode.WebviewView;
  private focusRootPath = '';

  private revealVisibleProjectPaths: string[] | undefined;
  private revealVisibleInWebview = true;

  constructor(
    private readonly extensionContextProvider: ExtensionContextProvider,
    private readonly recentProjectsService: RecentProjectsService,
  ) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView;

    const context = this.extensionContextProvider.getContext();

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [context.extensionUri],
    };

    webviewView.webview.html = getReactWebviewHtml(
      context.extensionUri,
      webviewView.webview,
      '/projects',
    );

    webviewView.webview.onDidReceiveMessage(async message => {
      try {
        await this.handleMessage(message);
      } catch (error) {
        console.error('[RecentProjectsProvider] handleMessage failed:', error);

        this.postMessage({
          type: 'error',
          requestId: message?.requestId,
          error: this.toErrorMessage(error),
        });
      }
    });

    webviewView.onDidDispose(() => {
      if (this.view === webviewView) {
        this.view = undefined;
      }
    });

    setTimeout(() => {
      void this.ensureCurrentWorkspaceInHistory().then(() => {
        this.refresh(true);
        this.syncActiveEditor();
        void this.checkPendingFileOpen();
      });
    }, 100);

    setTimeout(() => {
      this.refresh(true);
    }, 500);
  }

  public dispose(): void {
    this.view = undefined;
    this.focusRootPath = '';
    this.currentActivePath = '';
    this.revealVisibleProjectPaths = undefined;
    this.revealVisibleInWebview = true;
  }

  public getRecentProjects(): RecentProjectItem[] {
    return this.recentProjectsService.getRecentProjects();
  }

  public parseRemoteUrlInput(input: string) {
    return this.recentProjectsService.parseRemoteUrlInput(input);
  }

  public async insertProjectToHistory(
    name: string,
    fsPath: string,
    platform?: any,
    customDomain?: string,
  ): Promise<void> {
    await this.recentProjectsService.insertProjectToHistory(
      name,
      fsPath,
      platform,
      customDomain,
    );

    this.refresh(true);
  }

  public async addLocalProject(): Promise<void> {
    await this.recentProjectsService.addLocalProject();
    this.refresh(true);
  }

  public async addRemoteProject(): Promise<void> {
    await this.recentProjectsService.addRemoteProject();
    this.refresh(true);
  }

  public async showAddProjectQuickPick(): Promise<void> {
    const quickPick = vscode.window.createQuickPick();

    quickPick.placeholder =
      '直接输入本地绝对路径或远程 URL 按回车，或在下方选择';

    const defaultItems: vscode.QuickPickItem[] = [
      {
        label: '$(folder) 浏览本地项目...',
        description: '打开系统文件夹选择器',
        alwaysShow: true,
      },
      {
        label: '$(repo) 填写远程仓库...',
        description: '手动输入添加 GitHub / GitLab / Gitee 链接',
        alwaysShow: true,
      },
    ];

    quickPick.items = defaultItems;

    quickPick.onDidChangeValue(value => {
      const inputValue = value.trim();

      if (!inputValue) {
        quickPick.items = defaultItems;
        return;
      }

      const isRemote =
        /^(https?:\/\/|git@|vscode-vfs:\/\/)/i.test(inputValue) ||
        /^([^/]+\/[^/]+)$/.test(inputValue);

      quickPick.items = [
        {
          label: isRemote
            ? '$(repo) 识别为〖远程仓库〗并添加'
            : '$(folder) 识别为〖本地项目〗并添加',
          description: inputValue,
          alwaysShow: true,
        },
        ...defaultItems,
      ];
    });

    quickPick.onDidAccept(async () => {
      const inputValue = quickPick.value.trim();
      const selected = quickPick.selectedItems[0];

      quickPick.hide();
      quickPick.dispose();

      if (inputValue && selected?.description === inputValue) {
        await this.addInputProject(inputValue);
        return;
      }

      if (selected?.label.includes('浏览本地项目')) {
        await this.addLocalProject();
        return;
      }

      if (selected?.label.includes('填写远程仓库')) {
        await this.addRemoteProject();
      }
    });

    quickPick.show();
  }

  public refresh(refreshExpandedTree = true): void {
    const projects = this.getRecentProjects();
    const currentWorkspace = this.getCurrentWorkspaceProject(projects);

    this.postMessage({
      type: 'updateProjects',
      data: projects,
      projects,
      currentWorkspace,
      currentUriStr: currentWorkspace?.fsPath || '',
      lastOpenedPath: this.currentActivePath || '',
      activeFilePath: this.currentActivePath || '',
      activePath: this.currentActivePath || '',
      refreshExpandedTree,
      focusRootPath: this.focusRootPath,
    });

    this.postMessage({
      type: 'recentProjects',
      data: projects,
      projects,
      currentWorkspace,
      currentUriStr: currentWorkspace?.fsPath || '',
      activePath: this.currentActivePath || '',
      lastOpenedPath: this.currentActivePath || '',
      activeFilePath: this.currentActivePath || '',
      refreshExpandedTree,
      focusRootPath: this.focusRootPath,
    });

    if (refreshExpandedTree) {
      this.postMessage({
        type: 'refreshExpandedDirs',
        forceRefresh: true,
        activePath: this.currentActivePath || '',
        lastOpenedPath: this.currentActivePath || '',
        activeFilePath: this.currentActivePath || '',
      });
    }
  }

  public requestVisibleMetadataSync(): void {
    this.postMessage({
      type: 'metadataSyncRequested',
      activePath: this.currentActivePath,
    });

    this.postMessage({
      type: 'refreshVisibleMetadata',
      activePath: this.currentActivePath,
    });

    this.postMessage({
      type: 'refreshExpandedDirs',
      forceRefresh: true,
      activePath: this.currentActivePath,
      lastOpenedPath: this.currentActivePath,
      activeFilePath: this.currentActivePath,
    });
  }

  public async syncAllBranches(): Promise<void> {
    await this.recentProjectsService.syncAllBranches();
    this.refresh(false);
  }

  public async clearAll(): Promise<void> {
    await this.recentProjectsService.clearAll();
    this.refresh(true);
  }

  public setActivePath(fsPath: string): void {
    this.currentActivePath = fsPath;
    this.updateRevealContext(fsPath);

    this.postMessage({
      type: 'activeEditorChanged',
      fsPath,
    });

    this.postMessage({
      type: 'activePathChanged',
      activePath: fsPath,
      lastOpenedPath: fsPath,
      activeFilePath: fsPath,
    });
  }

  public syncActiveEditor(): void {
    const editor = vscode.window.activeTextEditor;

    if (!editor || editor.document.uri.scheme !== 'file') {
      this.currentActivePath = '';
      this.updateRevealContext('');
      return;
    }

    this.setActivePath(editor.document.uri.toString());
  }

  public revealCurrentActive(): void {
    const editor = vscode.window.activeTextEditor;

    if (editor && editor.document.uri.scheme === 'file') {
      this.currentActivePath = editor.document.uri.toString();
    }

    if (!this.currentActivePath) {
      vscode.window.showInformationMessage('当前没有可定位的本地文件');
      return;
    }

    let realPath = this.currentActivePath;

    if (realPath.startsWith('quickops-ro:')) {
      const match = realPath.match(/target=([^&]+)/);

      if (match) {
        realPath = decodeURIComponent(match[1]);
      }
    }

    const projects = this.getRecentProjects();
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const currentWorkspaceStr = workspaceFolder?.uri.toString();

    let rootProject = projects.find(project => {
      return this.isInsidePath(realPath, project.fsPath);
    });

    if (
      !rootProject &&
      currentWorkspaceStr &&
      this.isInsidePath(realPath, currentWorkspaceStr)
    ) {
      rootProject = {
        id: 'current-workspace',
        name: workspaceFolder?.name || '当前工作区',
        fsPath: currentWorkspaceStr,
        platform: 'local',
        createdAt: Date.now(),
        lastOpenedAt: Date.now(),
      } as RecentProjectItem;
    }

    if (!rootProject) {
      vscode.window.showInformationMessage('当前文件不在项目资源管理器列表中，无法定位。');
      return;
    }

    const parentPaths = this.buildParentPaths(realPath, rootProject.fsPath);
    const projectName = rootProject.customName || rootProject.name;

    this.currentActivePath = realPath;
    this.updateRevealContext(realPath);

    this.postMessage({
      type: 'revealPath',
      targetPath: realPath,
      parentPaths,
      projectName,
    });
  }

  public updateRevealContext(activePath: string): void {
    let realPath = activePath;

    if (realPath.startsWith('quickops-ro:')) {
      const match = realPath.match(/target=([^&]+)/);

      if (match) {
        realPath = decodeURIComponent(match[1]);
      }
    }

    let canReveal = false;

    const projects = this.getRecentProjects();
    const currentWorkspaceStr =
      vscode.workspace.workspaceFolders?.[0]?.uri.toString();

    if (realPath) {
      if (Array.isArray(this.revealVisibleProjectPaths)) {
        canReveal = this.revealVisibleProjectPaths.some(projectPath => {
          return this.isInsidePath(realPath, projectPath);
        });
      } else if (
        currentWorkspaceStr &&
        this.isInsidePath(realPath, currentWorkspaceStr)
      ) {
        canReveal = true;
      } else {
        canReveal = projects.some(project => {
          return this.isInsidePath(realPath, project.fsPath);
        });
      }
    }

    void vscode.commands.executeCommand(
      'setContext',
      RECENT_PROJECTS_CONTEXT_KEYS.canRevealInRecent,
      canReveal && this.revealVisibleInWebview,
    );
  }

  public selectForCompare(uri: string): void {
    this.recentProjectsService.selectForCompare(uri);
  }

  public async compareWithSelected(uri: string): Promise<void> {
    await this.recentProjectsService.compareWithSelected(uri);
  }

  private async handleMessage(
    message: RecentProjectsWebviewMessage & Record<string, any>,
  ): Promise<void> {
    switch (message.type) {
      case 'ready':
      case 'webviewLoaded':
      case 'refresh':
        this.refresh(message.refreshExpandedTree ?? true);

        if (this.currentActivePath) {
          this.setActivePath(this.currentActivePath);
        }

        break;

      case 'addLocal':
      case 'addLocalProject':
        await this.addLocalProject();
        break;

      case 'addRemote':
      case 'addRemoteProject':
        await this.addRemoteProject();
        break;

      case 'clearAll':
        await this.clearAll();
        break;

      case 'syncBranches':
        await this.syncAllBranches();
        break;

      case 'revealCurrentActive':
        this.revealCurrentActive();
        break;

      case 'updateRevealVisibility':
      case 'updateVisibleProjectPaths': {
        this.revealVisibleInWebview = message.visible !== false;
        this.revealVisibleProjectPaths = Array.isArray(message.visibleProjectPaths)
          ? message.visibleProjectPaths.filter((item: unknown): item is string => {
              return typeof item === 'string';
            })
          : undefined;

        this.updateRevealContext(this.currentActivePath);
        break;
      }

      case 'addToHistory':
        await this.addToExplorerHistory(message);
        break;

      case 'addToGitList': {
        const targetPath = this.getMessagePath(message);

        if (targetPath) {
          await this.addToGitList(targetPath);
        }

        break;
      }

      case 'openProject': {
        const targetPath = this.getMessagePath(message);

        if (targetPath) {
          await this.openProject(targetPath, false);
        }

        break;
      }

      case 'openProjectCurrent': {
        const targetPath = this.getMessagePath(message);

        if (!targetPath) break;

        const proj = this.getRecentProjects().find(item => {
          return item.fsPath === targetPath;
        });

        const projectName = proj?.customName || proj?.name || '该项目';

        const confirm = await vscode.window.showWarningMessage(
          `确定要在当前窗口打开 [ ${projectName} ] 吗？\n这将会关闭您当前正在工作的工作区！`,
          { modal: true },
          '确认覆盖打开',
        );

        if (confirm === '确认覆盖打开') {
          await this.openProject(targetPath, false);
        }

        break;
      }

      case 'openInVsCode': {
        const targetPath = this.getMessagePath(message);

        if (targetPath) {
          await this.openInVsCode(targetPath);
        }

        break;
      }

      case 'openInNewWindow': {
        const targetPath = this.getMessagePath(message);

        if (targetPath) {
          await this.openProject(targetPath, true);
        }

        break;
      }

      case 'removeProject':
      case 'delete': {
        const targetPath = this.getMessagePath(message);

        if (targetPath) {
          await this.removeProject(targetPath);
        }

        break;
      }

      case 'editProjectName':
      case 'edit': {
        const targetPath = this.getMessagePath(message);

        if (targetPath) {
          await this.editProjectName(targetPath);
        }

        break;
      }

      case 'changeAddress': {
        const targetPath = this.getMessagePath(message);

        if (targetPath) {
          await this.changeProjectAddress(targetPath);
        }

        break;
      }

      case 'readDir':
      case 'readFocusDir': {
        const targetPath = this.getMessagePath(message);
        const requestId = this.getRequestId(message);

        if (targetPath) {
          await this.handleReadDir(targetPath, requestId);
        }

        break;
      }

      case 'openFile':
      case 'openFileNormal':
      case 'openFileInNewTab':
      case 'openFileNormalInNewTab':
      case 'openWith': {
        const targetPath = this.getMessagePath(message);

        if (targetPath) {
          await this.openFile(targetPath, false);
        }

        break;
      }

      case 'openFileToSide':
      case 'openFileNormalToSide': {
        const targetPath = this.getMessagePath(message);

        if (targetPath) {
          await this.openFile(targetPath, true);
        }

        break;
      }

      case 'createFile': {
        const targetPath = this.getMessagePath(message);

        if (targetPath && message.name) {
          await this.createFile(targetPath, message.name);
        }

        break;
      }

      case 'createFolder': {
        const targetPath = this.getMessagePath(message);

        if (targetPath && message.name) {
          await this.createFolder(targetPath, message.name);
        }

        break;
      }

      case 'deletePath':
      case 'deleteFileEntity': {
        const targetPath = this.getMessagePath(message);

        if (targetPath) {
          await this.deletePath(targetPath);
        }

        break;
      }

      case 'renamePath': {
        const oldPath = message.oldPath || message.fsPath || message.path;
        const nextPath = message.newPath || message.name;

        if (oldPath && nextPath) {
          await this.renamePath(oldPath, nextPath);
        }

        break;
      }

      case 'moveFileEntity': {
        const sourcePath =
          message.sourceFsPath ||
          message.sourcePath ||
          message.fsPath ||
          message.path;

        const targetFolderPath =
          message.targetFolderFsPath ||
          message.targetFolderPath ||
          message.targetPath;

        if (sourcePath && targetFolderPath) {
          await this.moveFileEntity(
            sourcePath,
            targetFolderPath,
            Boolean(message.isFolder),
          );
        }

        break;
      }

      case 'discardFileChanges': {
        const targetPath = this.getMessagePath(message);

        if (targetPath) {
          await this.discardFileChanges(targetPath, message.status);
        }

        break;
      }

      case 'compareWithOldCode': {
        const targetPath = this.getMessagePath(message);

        if (targetPath) {
          await this.compareWithOldCode(
            targetPath,
            message.projectName || message.name || 'Quick Ops',
            message.status,
          );
        }

        break;
      }

      case 'copyFileName':
        if (message.name) {
          await vscode.env.clipboard.writeText(message.name);
        }
        break;

      case 'copyToClipboard':
        if (message.text) {
          await vscode.env.clipboard.writeText(String(message.text));
        }
        break;

      case 'copyFile': {
        const targetPath = this.getMessagePath(message);

        if (targetPath) {
          await vscode.env.clipboard.writeText(targetPath);
        }

        break;
      }

      case 'openInExplorer':
      case 'revealInExplorer': {
        const targetPath = this.getMessagePath(message);

        if (targetPath) {
          await this.openInExplorer(targetPath);
        }

        break;
      }

      case 'openExternalLink': {
        const targetPath = this.getMessagePath(message);

        if (targetPath) {
          await this.openExternalLink(targetPath);
        }

        break;
      }

      case 'selectForCompare': {
        const targetPath = this.getMessagePath(message);

        if (targetPath) {
          this.selectForCompare(targetPath);
        }

        break;
      }

      case 'compareWithSelected': {
        const targetPath = this.getMessagePath(message);

        if (targetPath) {
          await this.compareWithSelected(targetPath);
        }

        break;
      }

      case 'searchFileName': {
        const targetPath = this.getMessagePath(message);
        const requestId = this.getRequestId(message);

        if (targetPath) {
          await this.handleSearchFileName(
            targetPath,
            message.query || '',
            Boolean(message.focusOnly),
            requestId,
          );
        }

        break;
      }

      case 'searchFolder':
      case 'searchInFolder': {
        const targetPath = this.getMessagePath(message);
        const requestId = this.getRequestId(message);

        if (targetPath) {
          await this.handleSearchInFolder(
            targetPath,
            message.query || '',
            Boolean(message.focusOnly),
            requestId,
          );
        }

        break;
      }

      case 'focusRoot': {
        const targetPath = this.getMessagePath(message);

        if (targetPath) {
          this.focusRootPath = targetPath;
          this.refresh(true);
        }

        break;
      }

      case 'exitFocusRoot':
        this.focusRootPath = '';
        this.refresh(true);
        break;

      case 'updateSingleBranch':
      case 'switchBranch':
        await this.syncAllBranches();
        break;

      default:
        console.warn('[RecentProjectsProvider] unknown message:', message);
        break;
    }
  }

  private async ensureCurrentWorkspaceInHistory(): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

    if (!workspaceFolder) return;

    const fsPath = workspaceFolder.uri.toString();
    const name = path.basename(workspaceFolder.uri.fsPath) || '当前工作区';

    const existed = this.getRecentProjects().some(project => {
      return (
        this.normalizeProjectPath(project.fsPath) ===
        this.normalizeProjectPath(fsPath)
      );
    });

    if (existed) return;

    await this.recentProjectsService.insertProjectToHistory(name, fsPath, 'local');
  }

  private async addInputProject(inputValue: string): Promise<void> {
    const parsed = this.resolveProjectAddress(inputValue.trim());

    if (!parsed) {
      vscode.window.showErrorMessage('项目地址格式不正确');
      return;
    }

    const existed = this.getRecentProjects().some(project => {
      return (
        this.normalizeProjectPath(project.fsPath) ===
        this.normalizeProjectPath(parsed.fsPath)
      );
    });

    if (existed) {
      vscode.window.showWarningMessage('⚠️ 该项目已存在于列表中！');
      return;
    }

    let name = parsed.name;

    if (!name) {
      name = await vscode.window.showInputBox({
        title: '确认项目名称',
        value: parsed.defaultName,
        ignoreFocusOut: true,
        validateInput: value => {
          return value.trim() ? null : '项目名称不能为空';
        },
      });

      if (!name) return;
    }

    await this.insertProjectToHistory(
      name,
      parsed.fsPath,
      parsed.platform,
      parsed.customDomain,
    );
  }

  /**
   * 对齐 master：
   * 右键“添加到资源管理器记录”不走 resolveProjectAddress，
   * 不二次转换 file://，直接使用 webview 传来的 fsPath。
   */
  private async addToExplorerHistory(
    data: RecentProjectsWebviewMessage & Record<string, any>,
  ): Promise<void> {
    const fsPath = String(data.fsPath || data.path || data.uri || '');

    if (!fsPath) {
      vscode.window.showWarningMessage('未获取到项目地址，无法添加到资源管理器记录');
      return;
    }

    const currentWorkspace = vscode.workspace.workspaceFolders?.find(folder => {
      return folder.uri.toString() === fsPath;
    });

    const name = currentWorkspace
      ? currentWorkspace.name
      : data.projectName || data.name || path.basename(fsPath);

    let platform: any;
    let customDomain: string | undefined;

    if (fsPath.startsWith('vscode-vfs://') || fsPath.startsWith('http')) {
      const parsed = this.parseRemoteUrlInput(fsPath);

      if (parsed) {
        platform = parsed.platform;
        customDomain = parsed.customDomain;
      }
    }

    await this.insertProjectToHistory(name, fsPath, platform, customDomain);

    vscode.window.showInformationMessage('✅ 已将当前项目添加到资源管理器记录');
  }

  private async addToGitList(fsPath: string): Promise<void> {
    const context = this.extensionContextProvider.getContext();

    const gitProjects = context.globalState.get<RecentProjectItem[]>(
      RECENT_PROJECTS_STORAGE_KEYS.gitProjectsHistory,
      [],
    );

    const existed = gitProjects.find(project => {
      return project.fsPath === fsPath;
    });

    if (existed) {
      vscode.window.showWarningMessage('⚠️ 该项目已在 Git 记录列表中');
      return;
    }

    const proj = this.getRecentProjects().find(project => {
      return project.fsPath === fsPath;
    });

    const fallbackProject = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      fsPath,
      name: path.basename(fsPath),
      platform: fsPath.startsWith('vscode-vfs://') ? 'remote' : 'local',
      createdAt: Date.now(),
      lastOpenedAt: Date.now(),
    } as RecentProjectItem;

    gitProjects.unshift(proj || fallbackProject);

    await context.globalState.update(
      RECENT_PROJECTS_STORAGE_KEYS.gitProjectsHistory,
      gitProjects,
    );

    vscode.window.showInformationMessage('✅ 已添加到 Git 记录列表');

    void vscode.commands.executeCommand('quickOps.refreshGitProjects').then(
      undefined,
      () => undefined,
    );
  }

  private async openProject(
    fsPath: string,
    forceNewWindow = false,
  ): Promise<void> {
    const uri = this.toUri(fsPath);

    if (!uri) return;

    await this.recentProjectsService.touchProject(fsPath).catch(() => undefined);

    await vscode.commands.executeCommand('vscode.openFolder', uri, forceNewWindow);
  }

  private async openInVsCode(fsPath: string): Promise<void> {
    const targetUri = this.toUri(fsPath);

    if (!targetUri) return;

    if (targetUri.scheme !== 'file') {
      await vscode.commands.executeCommand('vscode.open', targetUri);
      return;
    }

    let currentLine = 0;
    let currentChar = 0;

    for (const editor of vscode.window.visibleTextEditors) {
      const sameFile =
        editor.document.uri.toString() === targetUri.toString() ||
        editor.document.uri.fsPath === targetUri.fsPath ||
        (
          editor.document.uri.scheme === 'quickops-ro' &&
          editor.document.uri.query.includes(encodeURIComponent(fsPath))
        );

      if (sameFile) {
        currentLine = editor.selection.active.line;
        currentChar = editor.selection.active.character;
        break;
      }
    }

    const choice = await vscode.window.showInformationMessage(
      '要在 VS Code 原生资源管理器中完全打开该文件吗？',
      { modal: true },
      '在当前窗口打开 (替换工作区)',
      '在新窗口打开',
      '仅作为散文件打开',
    );

    if (!choice) return;

    if (choice === '仅作为散文件打开') {
      const doc = await vscode.workspace.openTextDocument(targetUri);
      const editor = await vscode.window.showTextDocument(doc, { preview: false });
      const pos = new vscode.Position(currentLine, currentChar);

      editor.selection = new vscode.Selection(pos, pos);
      editor.revealRange(
        new vscode.Range(pos, pos),
        vscode.TextEditorRevealType.InCenter,
      );

      return;
    }

    const projects = this.getRecentProjects();
    const rootProject = projects.find(project => {
      return this.isInsidePath(fsPath, project.fsPath);
    });

    const workspaceUri = rootProject
      ? this.toUri(rootProject.fsPath)
      : vscode.Uri.file(path.dirname(targetUri.fsPath));

    if (!workspaceUri) return;

    const context = this.extensionContextProvider.getContext();

    await context.globalState.update(
      RECENT_PROJECTS_STORAGE_KEYS.pendingOpenFile,
      {
        path: fsPath,
        line: currentLine,
        char: currentChar,
        targetWorkspace: workspaceUri.toString(),
      },
    );

    const forceNewWindow = choice === '在新窗口打开';

    await vscode.commands.executeCommand('vscode.openFolder', workspaceUri, forceNewWindow);
  }

  private async checkPendingFileOpen(): Promise<void> {
    const context = this.extensionContextProvider.getContext();

    const pending = context.globalState.get<{
      path: string;
      line: number;
      char: number;
      targetWorkspace?: string;
    }>(RECENT_PROJECTS_STORAGE_KEYS.pendingOpenFile);

    if (!pending) return;

    const currentWorkspaceStr =
      vscode.workspace.workspaceFolders?.[0]?.uri.toString();

    if (pending.targetWorkspace && currentWorkspaceStr !== pending.targetWorkspace) {
      return;
    }

    await context.globalState.update(
      RECENT_PROJECTS_STORAGE_KEYS.pendingOpenFile,
      undefined,
    );

    const targetUri = this.toUri(pending.path);

    if (!targetUri) return;

    let attempts = 0;
    const maxAttempts = 40;

    const tryOpen = async (): Promise<boolean> => {
      try {
        await vscode.workspace.fs.stat(targetUri);

        const doc = await vscode.workspace.openTextDocument(targetUri);
        const editor = await vscode.window.showTextDocument(doc, { preview: false });
        const pos = new vscode.Position(pending.line, pending.char);

        editor.selection = new vscode.Selection(pos, pos);
        editor.revealRange(
          new vscode.Range(pos, pos),
          vscode.TextEditorRevealType.InCenter,
        );

        return true;
      } catch {
        return false;
      }
    };

    const poll = async (): Promise<void> => {
      const success = await tryOpen();

      if (success) return;

      attempts++;

      if (attempts < maxAttempts) {
        setTimeout(() => void poll(), 50);
      }
    };

    void poll();
  }

  private async removeProject(fsPath: string): Promise<void> {
    await this.recentProjectsService.removeProject(fsPath);
    this.refresh(true);
  }

  private async editProjectName(fsPath: string): Promise<void> {
    const project = this.findProjectByPath(fsPath);

    if (!project) {
      vscode.window.showWarningMessage('未找到该项目记录');
      return;
    }

    const name = await vscode.window.showInputBox({
      title: '修改项目名称',
      prompt: '请输入新的项目名称',
      value: project.name,
      ignoreFocusOut: true,
      validateInput: value => {
        return value.trim() ? null : '项目名称不能为空';
      },
    });

    if (!name) return;

    await this.recentProjectsService.updateProject(fsPath, {
      name: name.trim(),
    });

    this.refresh(true);
  }

  private async changeProjectAddress(fsPath: string): Promise<void> {
    const project = this.findProjectByPath(fsPath);

    if (!project) {
      vscode.window.showWarningMessage('未找到该项目记录');
      return;
    }

    const newAddress = await vscode.window.showInputBox({
      title: '修改项目地址',
      prompt: '请输入新的本地路径或远程仓库地址',
      value: project.fsPath,
      ignoreFocusOut: true,
      validateInput: value => {
        return value.trim() ? null : '地址不能为空';
      },
    });

    if (!newAddress) return;

    const parsed = this.resolveProjectAddress(newAddress.trim());

    if (!parsed) {
      vscode.window.showErrorMessage('项目地址格式不正确');
      return;
    }

    await this.recentProjectsService.removeProject(project.fsPath);

    await this.insertProjectToHistory(
      project.name,
      parsed.fsPath,
      parsed.platform,
      parsed.customDomain,
    );

    this.refresh(true);
  }

  private async openFile(fsPath: string, toSide = false): Promise<void> {
    const uri = this.toUri(fsPath);

    if (!uri) return;

    try {
      const stat = await vscode.workspace.fs.stat(uri);

      if ((stat.type & vscode.FileType.Directory) !== 0) {
        await this.handleReadDir(uri.toString());
        return;
      }

      const doc = await vscode.workspace.openTextDocument(uri);

      await vscode.window.showTextDocument(doc, {
        preview: false,
        viewColumn: toSide ? vscode.ViewColumn.Beside : undefined,
      });

      this.setActivePath(uri.toString());
    } catch {
      await vscode.commands.executeCommand('vscode.open', uri);
    }
  }

  private async handleReadDir(
    fsPath: string,
    requestId?: WebviewRequestId,
  ): Promise<void> {
    const uri = this.toUri(fsPath);

    if (!uri) {
      this.postDirectoryResult(fsPath, [], requestId, '无效路径');
      return;
    }

    try {
      const children = await this.readDirectoryChildren(uri);

      this.postDirectoryResult(fsPath, children, requestId);
    } catch (error) {
      this.postDirectoryResult(fsPath, [], requestId, this.toErrorMessage(error));
    }
  }

  private postDirectoryResult(
    fsPath: string,
    children: RecentProjectFileItem[],
    requestId?: WebviewRequestId,
    error?: string,
  ): void {
    const message = {
      requestId,
      fsPath,
      path: fsPath,
      children,
      data: children,
      error,
    };

    this.postMessage({
      type: 'readDirResult',
      ...message,
    });

    this.postMessage({
      type: 'dirData',
      ...message,
    });

    this.postMessage({
      type: 'updateDirChildren',
      ...message,
    });
  }

  private async readDirectoryChildren(
    uri: vscode.Uri,
  ): Promise<RecentProjectFileItem[]> {
    const entries = await vscode.workspace.fs.readDirectory(uri);

    const gitRoot = uri.scheme === 'file' ? await this.getGitRoot(uri.fsPath) : '';
    const statusMap = gitRoot
      ? await this.getGitStatusMap(gitRoot)
      : new Map<string, GitFileStatus>();

    const children = await Promise.all(
      entries
        .filter(([name]) => {
          return name !== '.DS_Store' && name !== 'Thumbs.db';
        })
        .map(async ([name, type]) => {
          const childUri = vscode.Uri.joinPath(uri, name);
          const isFolder = (type & vscode.FileType.Directory) !== 0;

          const gitRelativePath =
            gitRoot && childUri.scheme === 'file'
              ? path.relative(gitRoot, childUri.fsPath).replace(/\\/g, '/')
              : '';

          const status = gitRoot
            ? this.getChildGitStatus(gitRelativePath, isFolder, statusMap)
            : undefined;

          return {
            path: childUri.toString(),
            name,
            isFolder,
            status,
            diagnostics: this.getDiagnostics(childUri),
          } as RecentProjectFileItem;
        }),
    );

    return children.sort((a, b) => {
      if (a.isFolder !== b.isFolder) {
        return a.isFolder ? -1 : 1;
      }

      return a.name.localeCompare(b.name);
    });
  }

  private async getGitRoot(nativePath: string): Promise<string> {
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['rev-parse', '--show-toplevel'],
        {
          cwd: nativePath,
        },
      );

      return String(stdout).trim();
    } catch {
      return '';
    }
  }

  private async getGitStatusMap(
    gitRoot: string,
  ): Promise<Map<string, GitFileStatus>> {
    const statusMap = new Map<string, GitFileStatus>();

    try {
      const { stdout } = await execFileAsync(
        'git',
        ['-c', 'core.quotepath=false', 'status', '--porcelain=v1', '-uall'],
        {
          cwd: gitRoot,
          maxBuffer: 1024 * 1024 * 20,
        },
      );

      String(stdout)
        .split(/\r?\n/)
        .map(line => line.trimEnd())
        .filter(Boolean)
        .forEach(line => {
          const rawStatus = line.slice(0, 2);
          const rawPath = line.slice(3).trim();

          if (!rawPath) return;

          const filePath = rawPath.includes(' -> ')
            ? rawPath.split(' -> ').pop() || rawPath
            : rawPath;

          const normalizedPath = filePath.replace(/\\/g, '/');
          const normalizedStatus = this.normalizeGitStatus(rawStatus);

          if (!normalizedStatus) return;

          statusMap.set(normalizedPath, normalizedStatus);
        });
    } catch (error) {
      console.warn('[RecentProjectsProvider] getGitStatusMap failed:', error);
    }

    return statusMap;
  }

  private getChildGitStatus(
    gitRelativePath: string,
    isFolder: boolean,
    statusMap: Map<string, GitFileStatus>,
  ): GitFileStatus | undefined {
    if (!gitRelativePath) return undefined;

    const normalizedPath = gitRelativePath.replace(/\\/g, '/');

    if (!isFolder) {
      return statusMap.get(normalizedPath);
    }

    const prefix = normalizedPath.endsWith('/')
      ? normalizedPath
      : `${normalizedPath}/`;

    const childStatuses = [...statusMap.entries()]
      .filter(([filePath]) => {
        return filePath.startsWith(prefix);
      })
      .map(([, status]) => status)
      .filter(Boolean);

    if (childStatuses.length === 0) return undefined;

    return this.pickFolderStatus(childStatuses);
  }

  private normalizeGitStatus(rawStatus: string): GitFileStatus | undefined {
    const value = rawStatus.trim();

    if (!value) return undefined;

    if (value.includes('U')) return 'C';
    if (value.includes('?')) return 'U';
    if (value.includes('A')) return 'A';
    if (value.includes('D')) return 'D';
    if (value.includes('R')) return 'R';
    if (value.includes('C')) return 'C';
    if (value.includes('M')) return 'M';

    return 'M';
  }

  private normalizeGitStatusKey(status?: string): string {
    const value = String(status || '').trim();

    if (!value) return '';

    if (value === 'untracked') return 'U';
    if (value === 'modified') return 'M';
    if (value === 'added') return 'A';
    if (value === 'deleted') return 'D';
    if (value === 'renamed') return 'R';
    if (value === 'conflicted') return 'C';

    return value;
  }

  private pickFolderStatus(
    statuses: GitFileStatus[],
  ): GitFileStatus | undefined {
    const priority: GitFileStatus[] = ['C', 'D', 'R', 'A', 'M', 'U'];

    return priority.find(status => {
      return statuses.includes(status);
    });
  }

  private async createFile(parentPath: string, fileName: string): Promise<void> {
    const parentUri = this.toWritableLocalFolderUri(parentPath);

    if (!parentUri) return;

    const name = this.normalizeEntityName(fileName);

    if (!name) return;

    const targetUri = vscode.Uri.joinPath(parentUri, ...this.toPathParts(name));

    try {
      await this.ensureParentDirectory(targetUri);
      await vscode.workspace.fs.writeFile(targetUri, new Uint8Array());
      await this.openFile(targetUri.toString());

      this.refreshTreeAfterFileChange();
    } catch (error) {
      vscode.window.showErrorMessage(`新建文件失败：${this.toErrorMessage(error)}`);
    }
  }

  private async createFolder(
    parentPath: string,
    folderName: string,
  ): Promise<void> {
    const parentUri = this.toWritableLocalFolderUri(parentPath);

    if (!parentUri) return;

    const name = this.normalizeEntityName(folderName);

    if (!name) return;

    const targetUri = vscode.Uri.joinPath(parentUri, ...this.toPathParts(name));

    try {
      await vscode.workspace.fs.createDirectory(targetUri);

      this.refreshTreeAfterFileChange();
    } catch (error) {
      vscode.window.showErrorMessage(
        `新建文件夹失败：${this.toErrorMessage(error)}`,
      );
    }
  }

  private async deletePath(fsPath: string): Promise<void> {
    const uri = this.toUri(fsPath);

    if (!uri || uri.scheme !== 'file') {
      vscode.window.showWarningMessage('当前只支持删除本地文件');
      return;
    }

    const answer = await vscode.window.showWarningMessage(
      `确认删除 ${path.basename(uri.fsPath)} 吗？`,
      {
        modal: true,
      },
      '删除',
    );

    if (answer !== '删除') return;

    try {
      await vscode.workspace.fs.delete(uri, {
        recursive: true,
        useTrash: true,
      });

      this.refreshTreeAfterFileChange();
    } catch (error) {
      vscode.window.showErrorMessage(`删除失败：${this.toErrorMessage(error)}`);
    }
  }

  private async renamePath(
    oldPath: string,
    newNameOrPath: string,
  ): Promise<void> {
    const oldUri = this.toUri(oldPath);

    if (!oldUri || oldUri.scheme !== 'file') {
      vscode.window.showWarningMessage('当前只支持重命名本地文件');
      return;
    }

    const nextUri = newNameOrPath.includes('://')
      ? this.toUri(newNameOrPath)
      : vscode.Uri.file(path.join(path.dirname(oldUri.fsPath), newNameOrPath));

    if (!nextUri) return;

    try {
      await vscode.workspace.fs.rename(oldUri, nextUri, {
        overwrite: false,
      });

      this.refreshTreeAfterFileChange();
    } catch (error: any) {
      if (String(error?.message || '').includes('FileExists')) {
        const answer = await vscode.window.showWarningMessage(
          '目标已存在，是否覆盖？',
          {
            modal: true,
          },
          '覆盖',
        );

        if (answer !== '覆盖') return;

        await vscode.workspace.fs.rename(oldUri, nextUri, {
          overwrite: true,
        });

        this.refreshTreeAfterFileChange();

        return;
      }

      vscode.window.showErrorMessage(`重命名失败：${this.toErrorMessage(error)}`);
    }
  }

  private async moveFileEntity(
    sourceFsPath: string,
    targetFolderFsPath: string,
    isFolder: boolean,
  ): Promise<void> {
    const sourceUri = this.toUri(sourceFsPath);
    const targetFolderUri = this.toUri(targetFolderFsPath);

    if (!sourceUri || !targetFolderUri) return;

    if (sourceUri.scheme !== 'file' || targetFolderUri.scheme !== 'file') {
      vscode.window.showWarningMessage('当前只支持移动本地文件。');
      return;
    }

    const targetUri = vscode.Uri.file(
      path.join(targetFolderUri.fsPath, path.basename(sourceUri.fsPath)),
    );

    try {
      let overwrite = false;

      try {
        await vscode.workspace.fs.stat(targetUri);

        const picked = await vscode.window.showWarningMessage(
          `目标位置已存在 ${path.basename(targetUri.fsPath)}，是否覆盖？`,
          { modal: true },
          '覆盖',
        );

        if (picked !== '覆盖') return;

        overwrite = true;
      } catch {
        overwrite = false;
      }

      await vscode.workspace.fs.rename(sourceUri, targetUri, {
        overwrite,
      });

      vscode.window.showInformationMessage(`${isFolder ? '文件夹' : '文件'}移动成功`);
      this.refreshTreeAfterFileChange();
    } catch (error) {
      vscode.window.showErrorMessage(`移动失败：${this.toErrorMessage(error)}`);
    }
  }

  private async openInExplorer(fsPath: string): Promise<void> {
    const uri = this.toUri(fsPath);

    if (!uri) return;

    await vscode.commands.executeCommand('revealFileInOS', uri);
  }

  private async openExternalLink(fsPath: string): Promise<void> {
    const uri = this.toUri(fsPath);

    if (!uri) return;

    if (uri.scheme === 'vscode-vfs') {
      const platform = uri.authority;
      const repoPath = uri.path.replace(/^\/+/, '');

      let url = '';

      if (platform.includes('github.com') || platform === 'github') {
        url = `https://github.com/${repoPath}`;
      } else if (platform.includes('gitlab.com') || platform === 'gitlab') {
        url = `https://gitlab.com/${repoPath}`;
      } else if (platform.includes('gitee.com') || platform === 'gitee') {
        url = `https://gitee.com/${repoPath}`;
      } else {
        url = `https://${platform}/${repoPath}`;
      }

      await vscode.env.openExternal(vscode.Uri.parse(url));
      return;
    }

    await vscode.env.openExternal(uri);
  }

  private async handleSearchFileName(
    fsPath: string,
    query: string,
    focusOnly: boolean,
    requestId?: WebviewRequestId,
  ): Promise<void> {
    const uri = this.toUri(fsPath);

    if (!uri || !query.trim()) {
      this.postMessage({
        type: 'searchFileNameResult',
        requestId,
        results: [],
        data: [],
      });

      return;
    }

    const results: RecentProjectFileItem[] = [];
    const lowerQuery = query.trim().toLowerCase();
    const maxResults = 200;

    const walk = async (
      dirUri: vscode.Uri,
      rootUri: vscode.Uri,
    ): Promise<void> => {
      if (results.length >= maxResults) return;

      let entries: [string, vscode.FileType][];

      try {
        entries = await vscode.workspace.fs.readDirectory(dirUri);
      } catch {
        return;
      }

      for (const [name, type] of entries) {
        if (results.length >= maxResults) break;
        if (this.shouldIgnoreName(name)) continue;

        const childUri = vscode.Uri.joinPath(dirUri, name);
        const isFolder = (type & vscode.FileType.Directory) !== 0;
        const relativePath = path.posix.relative(rootUri.path, childUri.path);

        if (
          name.toLowerCase().includes(lowerQuery) ||
          relativePath.toLowerCase().includes(lowerQuery)
        ) {
          results.push({
            path: childUri.toString(),
            name,
            relativePath,
            isFolder,
            diagnostics: this.getDiagnostics(childUri),
          } as RecentProjectFileItem);
        }

        if (isFolder) {
          await walk(childUri, rootUri);
        }
      }
    };

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Window,
        title: 'Quick Ops: 正在按文件名/路径检索...',
      },
      async () => {
        await walk(uri, uri);
      },
    );

    this.postMessage({
      type: 'searchFileNameResult',
      requestId,
      results,
      data: results,
      focusOnly,
    });
  }

  private async handleSearchInFolder(
    fsPath: string,
    query: string,
    focusOnly: boolean,
    requestId?: WebviewRequestId,
  ): Promise<void> {
    const uri = this.toUri(fsPath);

    if (!uri || !query.trim()) {
      this.postMessage({
        type: 'searchFolderResult',
        requestId,
        results: [],
        data: [],
      });

      return;
    }

    const lowerQuery = query.trim().toLowerCase();
    const results: any[] = [];
    const maxResults = 200;
    let matchCount = 0;

    const walk = async (
      dirUri: vscode.Uri,
      rootUri: vscode.Uri,
    ): Promise<void> => {
      if (matchCount >= maxResults) return;

      let entries: [string, vscode.FileType][];

      try {
        entries = await vscode.workspace.fs.readDirectory(dirUri);
      } catch {
        return;
      }

      for (const [name, type] of entries) {
        if (matchCount >= maxResults) break;
        if (this.shouldIgnoreName(name)) continue;

        const childUri = vscode.Uri.joinPath(dirUri, name);
        const isFolder = (type & vscode.FileType.Directory) !== 0;

        if (isFolder) {
          await walk(childUri, rootUri);
          continue;
        }

        if (this.isBinaryLikeFile(name)) continue;

        try {
          const stat = await vscode.workspace.fs.stat(childUri);

          if (stat.size > 2 * 1024 * 1024) continue;

          const contentBytes = await vscode.workspace.fs.readFile(childUri);
          const content = Buffer.from(contentBytes).toString('utf8');
          const lines = content.split(/\r?\n/);
          const matches: Array<{ line: number; text: string }> = [];

          lines.forEach((line, index) => {
            if (matchCount >= maxResults) return;

            if (line.toLowerCase().includes(lowerQuery)) {
              matches.push({
                line: index + 1,
                text: line.trim().slice(0, 300),
              });

              matchCount++;
            }
          });

          if (matches.length > 0) {
            const relativePath = path.posix.relative(rootUri.path, childUri.path);

            results.push({
              file: relativePath,
              fullPath: childUri.toString(),
              matches,
              diagnostics: this.getDiagnostics(childUri),
            });
          }
        } catch {
          // 忽略不可读取文件
        }
      }
    };

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Window,
        title: 'Quick Ops: 正在检索文件夹内容...',
      },
      async () => {
        await walk(uri, uri);
      },
    );

    this.postMessage({
      type: 'searchFolderResult',
      requestId,
      results,
      data: results,
      focusOnly,
    });
  }

  private async getGitFileLocation(fsPath: string): Promise<
    | {
        uri: vscode.Uri;
        nativePath: string;
        gitRoot: string;
        relativePath: string;
      }
    | undefined
  > {
    const uri = this.toUri(fsPath);

    if (!uri || uri.scheme !== 'file') return undefined;

    const nativePath = uri.fsPath;
    const gitRoot = await this.getGitRoot(path.dirname(nativePath));

    if (!gitRoot) return undefined;

    const relativePath = path.relative(gitRoot, nativePath).replace(/\\/g, '/');

    if (!relativePath || relativePath.startsWith('..')) return undefined;

    return {
      uri,
      nativePath,
      gitRoot,
      relativePath,
    };
  }

  private async discardFileChanges(
    fsPath: string,
    status?: string,
  ): Promise<void> {
    const location = await this.getGitFileLocation(fsPath);

    if (!location) {
      vscode.window.showWarningMessage('该文件不在本地 Git 仓库中，无法取消变更。');
      return;
    }

    const fileName = path.basename(location.nativePath);
    const statusKey = this.normalizeGitStatusKey(status);
    const isUntracked = statusKey === 'U' || statusKey === '?' || statusKey === 'A';

    const confirmText = isUntracked ? '删除未提交文件' : '取消变更';
    const message = isUntracked
      ? `确定要删除未提交的新文件 “${fileName}” 吗？该操作不可恢复。`
      : `确定要取消 “${fileName}” 的所有未提交变更吗？该操作不可恢复。`;

    const picked = await vscode.window.showWarningMessage(
      message,
      { modal: true },
      confirmText,
    );

    if (picked !== confirmText) return;

    try {
      if (isUntracked) {
        await vscode.workspace.fs.delete(location.uri, {
          recursive: true,
          useTrash: false,
        });
      } else {
        await execFileAsync('git', ['reset', '--', location.relativePath], {
          cwd: location.gitRoot,
        });

        await execFileAsync('git', ['checkout', '--', location.relativePath], {
          cwd: location.gitRoot,
        });
      }

      vscode.window.showInformationMessage(`已取消 ${fileName} 的变更`);
      this.refreshTreeAfterFileChange();
    } catch (error) {
      vscode.window.showErrorMessage(`取消变更失败：${this.toErrorMessage(error)}`);
    }
  }

  private async compareWithOldCode(
    fsPath: string,
    projectName: string,
    status?: string,
  ): Promise<void> {
    const location = await this.getGitFileLocation(fsPath);

    if (!location) {
      vscode.window.showWarningMessage('该文件不在本地 Git 仓库中，无法与旧代码对比。');
      return;
    }

    try {
      const statusKey = this.normalizeGitStatusKey(status);
      const isNewFile = statusKey === 'U' || statusKey === '?' || statusKey === 'A';
      const isDeletedFile = statusKey === 'D';

      const oldContent = isNewFile
        ? ''
        : await this.getFileContentFromGit(
            location.gitRoot,
            'HEAD',
            location.relativePath,
          );

      const context = this.extensionContextProvider.getContext();

      const tempDir = vscode.Uri.joinPath(
        context.globalStorageUri,
        'quickops-diff',
      );

      await vscode.workspace.fs.createDirectory(tempDir);

      const oldUri = vscode.Uri.joinPath(
        tempDir,
        `${Date.now()}-${path.basename(location.nativePath)}.old`,
      );

      await vscode.workspace.fs.writeFile(
        oldUri,
        Buffer.from(oldContent, 'utf8'),
      );

      let workingUri = location.uri;

      if (isDeletedFile) {
        const emptyUri = vscode.Uri.joinPath(
          tempDir,
          `${Date.now()}-${path.basename(location.nativePath)}.current`,
        );

        await vscode.workspace.fs.writeFile(
          emptyUri,
          Buffer.from('', 'utf8'),
        );

        workingUri = emptyUri;
      }

      await vscode.commands.executeCommand(
        'vscode.diff',
        oldUri,
        workingUri,
        `${projectName}: ${path.basename(location.nativePath)} · 旧代码 ↔ 当前代码`,
        {
          preview: true,
          viewColumn: vscode.ViewColumn.Active,
        },
      );
    } catch (error) {
      vscode.window.showErrorMessage(`打开旧代码对比失败：${this.toErrorMessage(error)}`);
    }
  }

  private async getFileContentFromGit(
    gitRoot: string,
    ref: string,
    relativePath: string,
  ): Promise<string> {
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['show', `${ref}:${relativePath}`],
        {
          cwd: gitRoot,
          maxBuffer: 1024 * 1024 * 20,
        },
      );

      return String(stdout);
    } catch {
      return '';
    }
  }

  private refreshTreeAfterFileChange(): void {
    this.refresh(false);
    this.requestVisibleMetadataSync();

    setTimeout(() => {
      this.postMessage({
        type: 'refreshExpandedDirs',
        forceRefresh: true,
        activePath: this.currentActivePath,
        lastOpenedPath: this.currentActivePath,
        activeFilePath: this.currentActivePath,
      });
    }, 200);
  }

  private buildParentPaths(targetPath: string, rootPath: string): string[] {
    const parentPaths: string[] = [];

    const targetUri = this.toUri(targetPath);
    const rootUri = this.toUri(rootPath);

    if (!targetUri || !rootUri) {
      parentPaths.push(rootPath);
      return parentPaths;
    }

    let currentPath = targetUri.path;
    const rootUriPath = rootUri.path;

    while (currentPath.length > rootUriPath.length && currentPath !== '/') {
      currentPath = path.posix.dirname(currentPath);
      parentPaths.push(targetUri.with({ path: currentPath }).toString());
    }

    parentPaths.push(rootPath);

    return Array.from(new Set(parentPaths));
  }

  private getCurrentWorkspaceProject(
    projects: RecentProjectItem[],
  ): RecentProjectItem | null {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

    if (!workspaceFolder) return null;

    const workspaceUriStr = workspaceFolder.uri.toString();

    const existed = projects.find(project => {
      return (
        this.normalizeProjectPath(project.fsPath) ===
        this.normalizeProjectPath(workspaceUriStr)
      );
    });

    if (existed) return existed;

    const now = Date.now();

    return {
      id: 'current-workspace',
      name: path.basename(workspaceFolder.uri.fsPath) || '当前工作区',
      fsPath: workspaceUriStr,
      platform: 'local',
      createdAt: now,
      lastOpenedAt: now,
    } as RecentProjectItem;
  }

  private getDiagnostics(uri: vscode.Uri): { errors: number; warnings: number } {
    const diagnostics = vscode.languages.getDiagnostics(uri);

    return {
      errors: diagnostics.filter(item => {
        return item.severity === vscode.DiagnosticSeverity.Error;
      }).length,
      warnings: diagnostics.filter(item => {
        return item.severity === vscode.DiagnosticSeverity.Warning;
      }).length,
    };
  }

  private getRequestId(
    message: RecentProjectsWebviewMessage & Record<string, any>,
  ): WebviewRequestId | undefined {
    const requestId = message.requestId;

    if (typeof requestId === 'string' || typeof requestId === 'number') {
      return requestId;
    }

    return undefined;
  }

  private findProjectByPath(fsPath: string): RecentProjectItem | undefined {
    const normalizedPath = this.normalizeProjectPath(fsPath);

    return this.getRecentProjects().find(project => {
      return this.normalizeProjectPath(project.fsPath) === normalizedPath;
    });
  }

  private resolveProjectAddress(value: string):
    | {
        fsPath: string;
        platform: any;
        customDomain?: string;
        name?: string;
        defaultName: string;
      }
    | undefined {
    if (!value.trim()) return undefined;

    const trimmedValue = value.trim();

    if (
      /^(https?:\/\/|git@|vscode-vfs:\/\/)/i.test(trimmedValue) ||
      /^([^/]+\/[^/]+)$/.test(trimmedValue)
    ) {
      const parsed = this.parseRemoteUrlInput(trimmedValue);

      if (!parsed) return undefined;

      return {
        fsPath: parsed.targetUriStr,
        platform: parsed.platform,
        customDomain: parsed.customDomain,
        defaultName: parsed.repoFullName.split('/').pop() || parsed.repoFullName,
      };
    }

    const uri = vscode.Uri.file(trimmedValue);

    return {
      fsPath: uri.toString(),
      platform: 'local',
      defaultName: path.basename(uri.fsPath) || '本地项目',
    };
  }

  private getMessagePath(message: Record<string, any>): string {
    return (
      message.fsPath ||
      message.path ||
      message.uri ||
      message.targetPath ||
      message.filePath ||
      ''
    );
  }

  private toUri(value: string): vscode.Uri | undefined {
    return this.recentProjectsService.toUri(value);
  }

  private normalizeProjectPath(value: string): string {
    return this.recentProjectsService.normalizeProjectPath(value);
  }

  private normalizeComparePath(value: string): string {
    if (!value) return '';

    let targetValue = value;

    if (targetValue.startsWith('quickops-ro:')) {
      const match = targetValue.match(/target=([^&]+)/);

      if (match) {
        targetValue = decodeURIComponent(match[1]);
      }
    }

    try {
      const uri =
        targetValue.includes('://') || targetValue.startsWith('file:')
          ? vscode.Uri.parse(targetValue)
          : vscode.Uri.file(targetValue);

      if (uri.scheme === 'file') {
        return uri.fsPath.replace(/\\/g, '/').replace(/\/+$/, '');
      }

      return uri.toString().split('?')[0].replace(/\\/g, '/').replace(/\/+$/, '');
    } catch {
      return targetValue.split('?')[0].replace(/\\/g, '/').replace(/\/+$/, '');
    }
  }

  private isInsidePath(child: string, parent: string): boolean {
    const childBase = this.normalizeComparePath(child);
    const parentBase = this.normalizeComparePath(parent);

    if (!childBase || !parentBase) return false;

    const normalizedParent = parentBase.endsWith('/')
      ? parentBase
      : `${parentBase}/`;

    return childBase === parentBase || childBase.startsWith(normalizedParent);
  }

  private toWritableLocalFolderUri(value: string): vscode.Uri | undefined {
    const uri = this.toUri(value);

    if (!uri || uri.scheme !== 'file') {
      vscode.window.showWarningMessage('当前只支持在本地文件夹中新建文件或文件夹。');
      return undefined;
    }

    return uri;
  }

  private normalizeEntityName(name: string): string {
    const value = name.trim().replace(/\\/g, '/');

    if (!value) {
      vscode.window.showWarningMessage('名称不能为空');
      return '';
    }

    if (value.startsWith('/') || value.endsWith('/')) {
      vscode.window.showWarningMessage('名称不能以 / 开头或结尾。');
      return '';
    }

    const parts = value.split('/').map(item => item.trim());

    if (parts.some(item => !item || item === '.' || item === '..')) {
      vscode.window.showWarningMessage('名称中不能包含空路径、. 或 ..。');
      return '';
    }

    const invalidPart = parts.find(item => /[<>:"|?*]/.test(item));

    if (invalidPart) {
      vscode.window.showWarningMessage(`名称包含非法字符: ${invalidPart}`);
      return '';
    }

    return value;
  }

  private toPathParts(value: string): string[] {
    return value.replace(/\\/g, '/').split('/').filter(Boolean);
  }

  private async ensureParentDirectory(fileUri: vscode.Uri): Promise<void> {
    const parentUri = vscode.Uri.file(path.dirname(fileUri.fsPath));

    await vscode.workspace.fs.createDirectory(parentUri);
  }

  private shouldIgnoreName(name: string): boolean {
    return [
      'node_modules',
      'dist',
      'build',
      'out',
      '.git',
      '.svn',
      '.hg',
      '.DS_Store',
      'Thumbs.db',
    ].includes(name);
  }

  private isBinaryLikeFile(name: string): boolean {
    const ext = path.extname(name).toLowerCase();

    return [
      '.png',
      '.jpg',
      '.jpeg',
      '.gif',
      '.ico',
      '.svg',
      '.webp',
      '.bmp',
      '.pdf',
      '.zip',
      '.tar',
      '.gz',
      '.7z',
      '.rar',
      '.exe',
      '.dll',
      '.so',
      '.dylib',
      '.woff',
      '.woff2',
      '.ttf',
      '.eot',
      '.otf',
      '.mp4',
      '.mp3',
      '.mov',
      '.avi',
      '.xlsx',
      '.xls',
      '.docx',
      '.doc',
      '.pptx',
      '.ppt',
    ].includes(ext);
  }

  private postMessage(message: Record<string, any>): void {
    this.view?.webview.postMessage(message);
  }

  private toErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;

    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
}