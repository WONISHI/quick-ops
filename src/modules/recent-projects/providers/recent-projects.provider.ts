import * as vscode from 'vscode';
import * as path from 'path';
import { getReactWebviewHtml } from '../../../utils/WebviewHelper';
import { ExtensionContextProvider } from '../../../common/providers/extension-context.provider';
import { RecentProjectsService } from '../recent-projects.service';
import type {
  RecentProjectFileItem,
  RecentProjectItem,
  RecentProjectsWebviewMessage,
} from '../recent-projects.type';

export class RecentProjectsProvider implements vscode.WebviewViewProvider {
  public static inject = [ExtensionContextProvider, RecentProjectsService];

  public currentActivePath = '';

  private view?: vscode.WebviewView;
  private focusRootPath = '';

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
      console.log('[RecentProjectsProvider] receive message:', message);

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
        this.revealCurrentActive();
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

    console.log('[RecentProjectsProvider] projects count:', projects.length);
    console.log('[RecentProjectsProvider] projects:', projects);
    console.log('[RecentProjectsProvider] currentWorkspace:', currentWorkspace);

    this.postMessage({
      type: 'updateProjects',
      data: projects,
      projects,
      currentWorkspace,
      currentUriStr: currentWorkspace?.fsPath || '',
      lastOpenedPath: this.currentActivePath || '',
      activeFilePath: this.currentActivePath || '',
      refreshExpandedTree,
      focusRootPath: this.focusRootPath,
    });

    this.postMessage({
      type: 'recentProjects',
      data: projects,
      projects,
      currentWorkspace,
      currentUriStr: currentWorkspace?.fsPath || '',
      activePath: this.currentActivePath,
      refreshExpandedTree,
      focusRootPath: this.focusRootPath,
    });
  }

  public requestVisibleMetadataSync(): void {
    this.postMessage({
      type: 'metadataSyncRequested',
      activePath: this.currentActivePath,
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

  public setActivePath(pathValue: string): void {
    this.currentActivePath = pathValue;

    this.postMessage({
      type: 'activePathChanged',
      activePath: pathValue,
    });
  }

  public revealCurrentActive(): void {
    const editor = vscode.window.activeTextEditor;

    if (!editor || editor.document.uri.scheme !== 'file') return;

    const activePath = editor.document.uri.toString();

    this.setActivePath(activePath);

    this.postMessage({
      type: 'revealActivePath',
      activePath,
    });
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

      case 'openProject':
      case 'openProjectCurrent':
      case 'openInVsCode': {
        const targetPath = this.getMessagePath(message);

        if (targetPath) {
          await this.openProject(targetPath, false);
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

      case 'addToHistory': {
        const targetPath = this.getMessagePath(message);

        if (targetPath) {
          await this.addPathToHistory(
            targetPath,
            message.projectName || message.name,
          );
        }

        break;
      }

      case 'readDir': {
        const targetPath = this.getMessagePath(message);

        if (targetPath) {
          await this.handleReadDir(targetPath, message.requestId);
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

        if (targetPath) {
          await this.handleSearchFileName(
            targetPath,
            message.query || '',
            Boolean(message.focusOnly),
            message.requestId,
          );
        }

        break;
      }

      case 'searchFolder': {
        const targetPath = this.getMessagePath(message);

        if (targetPath) {
          await this.handleSearchInFolder(
            targetPath,
            message.query || '',
            Boolean(message.focusOnly),
            message.requestId,
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

  private async addPathToHistory(
    fsPath: string,
    projectName?: string,
  ): Promise<void> {
    const parsed = this.resolveProjectAddress(fsPath);

    if (!parsed) return;

    await this.insertProjectToHistory(
      projectName || parsed.defaultName,
      parsed.fsPath,
      parsed.platform,
      parsed.customDomain,
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
    requestId?: number,
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
    requestId?: number,
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

    return entries
      .filter(([name]) => {
        return name !== '.DS_Store' && name !== 'Thumbs.db';
      })
      .map(([name, type]) => {
        const childUri = vscode.Uri.joinPath(uri, name);
        const isFolder = (type & vscode.FileType.Directory) !== 0;

        return {
          path: childUri.toString(),
          name,
          isFolder,
          diagnostics: this.getDiagnostics(childUri),
        };
      })
      .sort((a, b) => {
        if (a.isFolder !== b.isFolder) {
          return a.isFolder ? -1 : 1;
        }

        return a.name.localeCompare(b.name);
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

      this.refresh(true);
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
      this.refresh(true);
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

      this.refresh(true);
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

      this.refresh(true);
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

        this.refresh(true);

        return;
      }

      vscode.window.showErrorMessage(`重命名失败：${this.toErrorMessage(error)}`);
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
    requestId?: number,
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
          });
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
    requestId?: number,
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
    };
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