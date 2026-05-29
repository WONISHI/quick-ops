import * as vscode from 'vscode';
import * as https from 'https';
import * as path from 'path';
import { execFile } from 'child_process';
import { getReactWebviewHtml } from '../utils/WebviewHelper';
import { setupMarkdown } from '../plugins/markdown/setupMarkdown';
import markdownImagePlugin, { restoreMarkdownImagePaths } from '../plugins/markdown/markdownImagePlugin';

export interface RecentProject {
  name: string;
  customName?: string;
  fsPath: string;
  timestamp: number;
  branch?: string;
  platform?: 'github' | 'gitlab';
  customDomain?: string;
}

export class RecentProjectsProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private stateKey = 'quickOps.recentProjectsHistory';
  private lastOpenedPath: string = '';
  private dirCache = new Map<string, { children: any[]; timestamp: number }>();
  private readonly dirCacheTtl = 3000;

  private selectedForCompareUri?: vscode.Uri;
  private selectedForCompareName?: string;
  private activePanels: Map<string, vscode.WebviewPanel> = new Map();

  private currentActivePath: string = '';
  private revealVisibleInWebview: boolean = true;
  private revealVisibleProjectPaths: string[] | undefined = undefined;
  private markdownImageAssets = new Map<string, Record<string, string>>();

  constructor(private context: vscode.ExtensionContext) {
    this.initializeCurrentWorkspace();

    this.checkPendingFileOpen();

    if (vscode.window.activeTextEditor) {
      this.handleEditorChange(vscode.window.activeTextEditor);
    }

    vscode.window.onDidChangeActiveTextEditor(editor => {
      this.handleEditorChange(editor);
    });
  }

  private async checkPendingFileOpen() {
    const pending = this.context.globalState.get<{ path: string, line: number, char: number, targetWorkspace?: string }>('quickOps.pendingOpenFile');
    if (pending) {
      const currentWorkspaceStr = vscode.workspace.workspaceFolders?.[0]?.uri.toString();
      if (pending.targetWorkspace && currentWorkspaceStr !== pending.targetWorkspace) {
        return;
      }

      await this.context.globalState.update('quickOps.pendingOpenFile', undefined);

      const targetUri = pending.path.includes('://') ? vscode.Uri.parse(pending.path) : vscode.Uri.file(pending.path);

      let attempts = 0;
      const maxAttempts = 40;
      const delay = 50;

      const tryOpenDoc = async () => {
        try {
          await vscode.workspace.fs.stat(targetUri);
          const doc = await vscode.workspace.openTextDocument(targetUri);
          const editor = await vscode.window.showTextDocument(doc, { preview: false });
          const pos = new vscode.Position(pending.line, pending.char);
          editor.selection = new vscode.Selection(pos, pos);
          editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
          return true;
        } catch (e) {
          return false;
        }
      };

      const poll = async () => {
        const success = await tryOpenDoc();
        if (!success) {
          attempts++;
          if (attempts < maxAttempts) {
            setTimeout(poll, delay);
          } else {
            console.error('[Quick Ops] 跨窗口恢复坐标失败: 等待文件系统超时');
          }
        }
      };

      // 立刻发起第一次尝试
      poll();
    }
  }

  private handleEditorChange(editor: vscode.TextEditor | undefined) {
    if (editor) {
      let activePath = editor.document.uri.toString();
      if (editor.document.uri.scheme === 'quickops-ro') {
        const match = editor.document.uri.query.match(/target=([^&]+)/);
        if (match) {
          activePath = decodeURIComponent(match[1]);
        }
      }
      this.setActivePath(activePath);
    }
  }

  private normalizeComparePath(value: string) {
    if (!value) return '';

    let result = value.split('?')[0];

    if (result.startsWith('file://')) {
      result = decodeURIComponent(result.replace(/^file:\/\//, ''));

      if (/^\/[a-zA-Z]:\//.test(result)) {
        result = result.slice(1);
      }
    }

    return result.replace(/\\/g, '/').replace(/\/+$/, '');
  }

  private isInsidePath(child: string, parent: string) {
    const childBase = this.normalizeComparePath(child);
    const parentBase = this.normalizeComparePath(parent);
    const normalizedParent = parentBase.endsWith('/') ? parentBase : parentBase + '/';
    return childBase === parentBase || childBase.startsWith(normalizedParent);
  }

  private updateRevealContext(activePath: string) {
    let canReveal = false;
    const projects = this.getRecentProjects();
    const currentWorkspaceStr = vscode.workspace.workspaceFolders?.[0]?.uri.toString();

    if (activePath) {
      if (Array.isArray(this.revealVisibleProjectPaths)) {
        canReveal = this.revealVisibleProjectPaths.some(p => this.isInsidePath(activePath, p));
      } else if (currentWorkspaceStr && this.isInsidePath(activePath, currentWorkspaceStr)) {
        canReveal = true;
      } else if (projects.some(p => this.isInsidePath(activePath, p.fsPath))) {
        canReveal = true;
      }
    }

    vscode.commands.executeCommand('setContext', 'quickOps.canRevealInRecent', canReveal && this.revealVisibleInWebview);
  }

  private setActivePath(fsPath: string) {
    this.currentActivePath = fsPath;
    this.updateRevealContext(fsPath);
    if (this._view) {
      this._view.webview.postMessage({
        type: 'activeEditorChanged',
        fsPath: fsPath
      });
    }
  }

  public revealCurrentActive() {
    if (!this.currentActivePath) return;

    let realPath = this.currentActivePath;
    if (this.currentActivePath.startsWith('quickops-ro:')) {
      const match = this.currentActivePath.match(/target=([^&]+)/);
      if (match) realPath = decodeURIComponent(match[1]);
    }

    const projects = this.getRecentProjects();
    const currentWorkspaceStr = vscode.workspace.workspaceFolders?.[0]?.uri.toString();

    let rootProj = projects.find(p => this.isInsidePath(realPath, p.fsPath));

    if (!rootProj && currentWorkspaceStr && this.isInsidePath(realPath, currentWorkspaceStr)) {
      rootProj = { name: vscode.workspace.workspaceFolders![0].name, fsPath: currentWorkspaceStr } as any;
    }

    if (!rootProj) return;

    const parentPaths: string[] = [];
    const uri = realPath.includes('://') ? vscode.Uri.parse(realPath) : vscode.Uri.file(realPath);
    const rootUri = rootProj.fsPath.includes('://') ? vscode.Uri.parse(rootProj.fsPath) : vscode.Uri.file(rootProj.fsPath);

    let p = uri.path;
    while (p.length > rootUri.path.length && p !== '/') {
      p = path.posix.dirname(p);
      parentPaths.push(uri.with({ path: p }).toString());
    }
    parentPaths.push(rootProj.fsPath);

    const projectName = rootProj.customName || rootProj.name;

    this._view?.webview.postMessage({
      type: 'revealPath',
      targetPath: realPath,
      parentPaths: parentPaths,
      projectName
    });
  }

  private initializeCurrentWorkspace() {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return;

    const currentUriStr = folders[0].uri.toString();
    this.updateSingleBranch(currentUriStr, true);
  }

  private async closeExistingPreviews(fsPath: string) {
    if (this.activePanels.has(fsPath)) {
      this.activePanels.get(fsPath)?.dispose();
      this.activePanels.delete(fsPath);
    }
    if (vscode.window.tabGroups) {
      const tabsToClose: vscode.Tab[] = [];
      for (const group of vscode.window.tabGroups.all) {
        for (const tab of group.tabs) {
          if (tab.input instanceof vscode.TabInputText) {
            if (tab.input.uri.fsPath === fsPath) {
              tabsToClose.push(tab);
            }
          }
        }
      }
      if (tabsToClose.length > 0) {
        await vscode.window.tabGroups.close(tabsToClose);
      }
    }
  }


  private execGit(args: string[], cwd: string): Promise<string> {
    return new Promise((resolve) => {
      execFile('git', args, { cwd }, (error, stdout) => {
        if (error) {
          resolve('');
          return;
        }

        resolve(stdout || '');
      });
    });
  }

  private async getGitRoot(nativePath: string): Promise<string> {
    if (!nativePath) return '';

    const result = await this.execGit(['rev-parse', '--show-toplevel'], nativePath);
    return result.trim();
  }

  private normalizeGitStatus(rawStatus: string) {
    const s = rawStatus.trim().toUpperCase();

    if (!s) return undefined;

    if (s === '??') return 'u';
    if (s.includes('D')) return 'd';
    if (s.includes('M')) return 'm';
    if (s.includes('A')) return 'a';
    if (s.includes('R')) return 'r';
    if (s.includes('C')) return 'c';

    return undefined;
  }

  private normalizeRelativePath(value: string) {
    return value.replace(/\\/g, '/').replace(/^\/+/, '');
  }

  private async getGitStatusMap(nativePath: string): Promise<Map<string, string>> {
    const map = new Map<string, string>();

    try {
      const gitRoot = await this.getGitRoot(nativePath);
      if (!gitRoot) return map;

      const output = await this.execGit(['status', '--porcelain=v1', '-z'], gitRoot);
      if (!output) return map;

      const parts = output.split('\0').filter(Boolean);

      for (let i = 0; i < parts.length; i++) {
        const item = parts[i];
        const rawStatus = item.slice(0, 2);
        const rawPath = item.slice(3);

        if (!rawPath) continue;

        const status = this.normalizeGitStatus(rawStatus);
        if (!status) continue;

        const normalizedPath = this.normalizeRelativePath(rawPath);
        map.set(normalizedPath, status);

        if (rawStatus.toUpperCase().includes('R') && parts[i + 1]) {
          i++;
        }
      }
    } catch {
      return map;
    }

    return map;
  }

  private getGitStatusPriority(status?: string) {
    switch ((status || '').toLowerCase()) {
      case 'd':
        return 60;
      case 'm':
        return 50;
      case 'a':
        return 40;
      case 'u':
        return 30;
      case 'r':
        return 20;
      case 'c':
        return 10;
      default:
        return 0;
    }
  }

  private getChildGitStatus(
    childRelativePath: string,
    isFolder: boolean,
    statusMap: Map<string, string>
  ) {
    const normalizedChildPath = this.normalizeRelativePath(childRelativePath);

    if (!isFolder) {
      return statusMap.get(normalizedChildPath);
    }

    const folderPrefix = normalizedChildPath.endsWith('/')
      ? normalizedChildPath
      : `${normalizedChildPath}/`;

    let finalStatus: string | undefined;
    let finalPriority = 0;

    for (const [changedPath, status] of statusMap.entries()) {
      if (!changedPath.startsWith(folderPrefix)) continue;

      const priority = this.getGitStatusPriority(status);

      if (priority > finalPriority) {
        finalStatus = status;
        finalPriority = priority;
      }
    }

    return finalStatus;
  }

  private getReadOnlyUri(fsPath: string, projectName: string): vscode.Uri {
    const originalUri = fsPath.includes('://') ? vscode.Uri.parse(fsPath) : vscode.Uri.file(fsPath);
    const fileName = originalUri.path.split(/[\\/]/).pop() || 'unknown';

    const virtualPath = `/${projectName}: ${fileName}`;

    return vscode.Uri.from({
      scheme: 'quickops-ro',
      path: virtualPath,
      query: `target=${encodeURIComponent(originalUri.toString())}`,
    });
  }

  public selectForCompare(fsPath: string, projectName?: string) {
    if (projectName) {
      this.selectedForCompareUri = this.getReadOnlyUri(fsPath, projectName);
      this.selectedForCompareName = `${projectName} - ${path.basename(fsPath)} (只读)`;
    } else {
      this.selectedForCompareUri = fsPath.includes('://') ? vscode.Uri.parse(fsPath) : vscode.Uri.file(fsPath);
      this.selectedForCompareName = path.basename(this.selectedForCompareUri.fsPath);
    }
    vscode.window.showInformationMessage(`已选择 "${this.selectedForCompareName}" 进行比较`);
  }

  public async compareWithSelected(fsPath: string, projectName?: string) {
    if (!this.selectedForCompareUri) {
      vscode.window.showWarningMessage('请先选择一个文件以进行比较');
      return;
    }

    let currentUri: vscode.Uri;
    let currentName: string;

    if (projectName) {
      currentUri = this.getReadOnlyUri(fsPath, projectName);
      currentName = `${projectName} - ${path.basename(fsPath)} (只读)`;
    } else {
      currentUri = fsPath.includes('://') ? vscode.Uri.parse(fsPath) : vscode.Uri.file(fsPath);
      currentName = path.basename(currentUri.fsPath);
    }

    const title = `${this.selectedForCompareName} ↔ ${currentName}`;
    await vscode.commands.executeCommand('vscode.diff', this.selectedForCompareUri, currentUri, title);
  }

  public refresh(refreshExpandedTree: boolean = false) {
    this.invalidateDirCache();
    this.updateWebview();

    if (refreshExpandedTree) {
      this._view?.webview.postMessage({
        type: 'refreshExpandedDirs',
      });
    }
  }

  public invalidateDirCache(fsPath?: string) {
    if (!fsPath) {
      this.dirCache.clear();
      return;
    }

    const uri = fsPath.includes('://') ? vscode.Uri.parse(fsPath) : vscode.Uri.file(fsPath);
    const uriStr = uri.toString();

    for (const key of Array.from(this.dirCache.keys())) {
      if (key.endsWith(uriStr) || key.includes(uriStr + '/')) {
        this.dirCache.delete(key);
      }
    }
  }

  public async syncAllBranches() {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Window,
        title: 'Quick Ops: 正在同步所有项目的最新分支...',
        cancellable: false
      },
      async () => {
        await this.refreshBranchesAsync();
        const currentUriStr = vscode.workspace.workspaceFolders?.[0]?.uri.toString();
        if (currentUriStr && !this.getRecentProjects().some(p => p.fsPath === currentUriStr)) {
          await this.updateSingleBranch(currentUriStr, true);
        }
      }
    );
    vscode.window.showInformationMessage('🎉 所有项目分支状态已同步更新完毕！');
  }

  public resolveWebviewView(webviewView: vscode.WebviewView, context: vscode.WebviewViewResolveContext, _token: vscode.CancellationToken) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };

    webviewView.webview.html = getReactWebviewHtml(this.context.extensionUri, webviewView.webview, '/projects');

    webviewView.webview.onDidReceiveMessage(async (data) => {
      switch (data.type) {

        case 'addToHistory': {
          const currentWorkspace = vscode.workspace.workspaceFolders?.find(f => f.uri.toString() === data.fsPath);
          const name = currentWorkspace ? currentWorkspace.name : (data.projectName || path.basename(data.fsPath));

          let platform, customDomain;
          if (data.fsPath.startsWith('vscode-vfs://') || data.fsPath.startsWith('http')) {
            const parsed = this.parseRemoteUrlInput(data.fsPath);
            if (parsed) { platform = parsed.platform; customDomain = parsed.customDomain; }
          }

          await this.insertProjectToHistory(name, data.fsPath, platform, customDomain);
          vscode.window.showInformationMessage('✅ 已将当前项目添加到资源管理器记录');
          break;
        }

        case 'addToGitList': {
          const gitProjects = this.context.globalState.get<any[]>('quickOps.gitProjectsHistory') || [];
          if (!gitProjects.find(p => p.fsPath === data.fsPath)) {
            const proj = this.getRecentProjects().find(p => p.fsPath === data.fsPath);
            gitProjects.unshift(proj || { fsPath: data.fsPath, name: path.basename(data.fsPath) });
            await this.context.globalState.update('quickOps.gitProjectsHistory', gitProjects);
            vscode.window.showInformationMessage('✅ 已添加到 Git 记录列表');
            vscode.commands.executeCommand('quickOps.refreshGitProjects').then(undefined, () => { });
          } else {
            vscode.window.showWarningMessage('⚠️ 该项目已在 Git 记录列表中');
          }
          break;
        }

        case 'openInVsCode': {
          let currentLine = 0;
          let currentChar = 0;
          const targetUri = data.fsPath.includes('://') ? vscode.Uri.parse(data.fsPath) : vscode.Uri.file(data.fsPath);

          for (const editor of vscode.window.visibleTextEditors) {
            if (
              editor.document.uri.fsPath === targetUri.fsPath ||
              (editor.document.uri.scheme === 'quickops-ro' && editor.document.uri.query.includes(encodeURIComponent(data.fsPath)))
            ) {
              currentLine = editor.selection.active.line;
              currentChar = editor.selection.active.character;
              break;
            }
          }

          const choice = await vscode.window.showInformationMessage(
            `要在 VS Code 原生资源管理器中完全打开该文件吗？`,
            { modal: true },
            '在当前窗口打开 (替换工作区)',
            '在新窗口打开',
            '仅作为散文件打开'
          );

          if (!choice) return;

          if (choice === '仅作为散文件打开') {
            try {
              const doc = await vscode.workspace.openTextDocument(targetUri);
              // preview: false 表示它是一个固定标签，不会被一点击就替换掉
              const editor = await vscode.window.showTextDocument(doc, { preview: false });
              const pos = new vscode.Position(currentLine, currentChar);
              editor.selection = new vscode.Selection(pos, pos);
              editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
            } catch (e) {
              vscode.window.showErrorMessage('无法打开该文件');
            }
          } else {
            // 无论是替换当前窗口还是新窗口，都需要切换 Workspace
            const projects = this.getRecentProjects();
            // 寻找该文件所属的项目根目录
            const rootProj = projects.find(p => this.isInsidePath(data.fsPath, p.fsPath));
            const workspaceUri = rootProj
              ? (rootProj.fsPath.includes('://') ? vscode.Uri.parse(rootProj.fsPath) : vscode.Uri.file(rootProj.fsPath))
              : vscode.Uri.joinPath(targetUri, '..'); // 兜底用它的父级目录

            // 把这颗“坐标种子”塞进 globalState
            await this.context.globalState.update('quickOps.pendingOpenFile', {
              path: data.fsPath,
              line: currentLine,
              char: currentChar,
              targetWorkspace: workspaceUri.toString()
            });

            const forceNewWindow = choice === '在新窗口打开';
            await vscode.commands.executeCommand('vscode.openFolder', workspaceUri, forceNewWindow);
          }
          break;
        }

        case 'refresh':
          this.refresh(true);
          if (this.currentActivePath) {
            this.setActivePath(this.currentActivePath);
          }
          break;

        case 'updateRevealVisibility':
          this.revealVisibleInWebview = true;
          this.revealVisibleProjectPaths = Array.isArray(data.visibleProjectPaths) ? data.visibleProjectPaths : undefined;
          this.updateRevealContext(this.currentActivePath);
          break;

        case 'openProject':
          this.openProject(data.fsPath);
          break;
        case 'openProjectCurrent': {
          const proj = this.getRecentProjects().find((p) => p.fsPath === data.fsPath);
          const pName = proj?.customName || proj?.name || '该项目';

          vscode.window.showWarningMessage(
            `确定要在当前窗口打开 [ ${pName} ] 吗？\n这将会关闭您当前正在工作的工作区！`,
            { modal: true },
            '确认覆盖打开'
          ).then(confirm => {
            if (confirm === '确认覆盖打开') {
              this.executeOpen(data.fsPath, false, proj?.branch);
            }
          });
          break;
        }
        case 'openInNewWindow': {
          const projNew = this.getRecentProjects().find((p) => p.fsPath === data.fsPath);
          this.executeOpen(data.fsPath, true, projNew?.branch);
          break;
        }
        case 'removeProject':
          this.removeProjectByPath(data.fsPath);
          break;
        case 'addLocal':
          this.addLocalProject();
          break;
        case 'addRemote':
          this.addRemoteProject();
          break;
        case 'changeAddress':
          this.changeProjectAddress(data.fsPath);
          break;
        case 'switchBranch':
          this.switchRemoteBranch(data.fsPath);
          break;
        case 'readDir':
          this.readDirectory(data.fsPath, data.projectName, false, !!data.forceRefresh);
          break;
        case 'readFocusDir':
          this.readDirectory(data.fsPath, data.projectName, true, !!data.forceRefresh);
          break;
        case 'openFile':
          this.openFileReadOnly(data.fsPath, data.projectName || '未知项目');
          break;
        case 'editProjectName':
          this.editProjectName(data.fsPath);
          break;
        case 'copyToClipboard':
          vscode.env.clipboard.writeText(data.text);
          vscode.window.showInformationMessage(`已复制: ${data.text}`);
          break;
        case 'copyFile':
          this.copyFileEntity(data.fsPath);
          break;
        case 'createFile':
          this.createFileEntity(data.fsPath);
          break;
        case 'createFolder':
          this.createFolderEntity(data.fsPath);
          break;
        case 'openExternalLink':
          this.openExternalLink(data.fsPath, data.platform, data.customDomain);
          break;
        case 'openFileToSide':
          this.openFileReadOnly(data.fsPath, data.projectName || '未知项目', vscode.ViewColumn.Beside);
          break;
        case 'openFileInNewTab':
          this.openFileReadOnly(data.fsPath, data.projectName || '未知项目', vscode.ViewColumn.Active, false);
          break;
        case 'updateSingleBranch':
          this.updateSingleBranch(data.fsPath);
          break;
        case 'revealInExplorer':
          try {
            let uri: vscode.Uri;
            if (data.fsPath.startsWith('file://')) {
              uri = vscode.Uri.parse(data.fsPath);
            } else {
              uri = vscode.Uri.file(data.fsPath);
            }
            await vscode.commands.executeCommand('revealFileInOS', uri);
          } catch (e) {
            vscode.window.showErrorMessage(`在资源管理器中定位失败: ${e}`);
          }
          break;
        case 'selectForCompare':
          this.selectForCompare(data.fsPath, data.projectName);
          break;
        case 'compareWithSelected':
          this.compareWithSelected(data.fsPath, data.projectName);
          break;
        case 'searchInFolder':
          this.handleSearchInFolder(data.fsPath, data.query, data.isRemote, !!data.focusOnly);
          break;

        case 'previewWithVditor':
          this.openVditorPanel(data.fsPath, data.projectName || '未知项目', data.isActiveProject ? 'edit' : 'read');
          break;
        case 'previewWithExcel':
        case 'previewWithExcelToSide': {
          this.openExcelPanel(
            data.fsPath,
            data.projectName || '未知项目',
            data.type === 'previewWithExcelToSide' ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active
          );
          break;
        }
        case 'openImageNative':
        case 'openImageNativeToSide': {
          try {
            const uri = data.fsPath.includes('://') ? vscode.Uri.parse(data.fsPath) : vscode.Uri.file(data.fsPath);
            const viewColumn = data.type === 'openImageNativeToSide' ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active;
            await vscode.commands.executeCommand('vscode.open', uri, viewColumn);
          } catch (e) {
            vscode.window.showErrorMessage('无法预览该图像文件。');
          }
          break;
        }

        case 'openFileNormal':
        case 'openFileNormalToSide':
        case 'openFileNormalInNewTab': {
          try {
            const uri = data.fsPath.includes('://') ? vscode.Uri.parse(data.fsPath) : vscode.Uri.file(data.fsPath);
            const doc = await vscode.workspace.openTextDocument(uri);
            const viewColumn = data.type === 'openFileNormalToSide' ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active;
            const preview = data.type !== 'openFileNormalInNewTab';
            await vscode.window.showTextDocument(doc, { preview, viewColumn });
          } catch (e) {
            vscode.window.showErrorMessage('无法打开该文件。');
          }
          break;
        }

        case 'previewWithPdf':
        case 'previewWithPdfToSide': {
          this.openPdfPanel(
            data.fsPath,
            data.projectName || '未知项目',
            data.type === 'previewWithPdfToSide' ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active
          );
          break;
        }

        case 'searchFileName':
          this.handleSearchFileName(data.fsPath, data.query, data.isRemote, !!data.focusOnly);
          break;

        case 'openFileAtLine': {
          try {
            let fileUri: vscode.Uri;
            if (data.isActiveProject) {
              fileUri = data.fsPath.includes('://') ? vscode.Uri.parse(data.fsPath) : vscode.Uri.file(data.fsPath);
            } else {
              const projName = data.projectName || '搜索结果';
              fileUri = this.getReadOnlyUri(data.fsPath, projName);
            }

            const doc = await vscode.workspace.openTextDocument(fileUri);
            const editor = await vscode.window.showTextDocument(doc, { preview: true });

            const position = new vscode.Position(Math.max(0, data.line - 1), 0);
            editor.selection = new vscode.Selection(position, position);
            editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
          } catch (e) {
            vscode.window.showErrorMessage('打开文件失败，请检查文件是否存在。');
          }
          break;
        }
        case 'openWith': {
          this.handleOpenWith(data.fsPath, data.projectName || '未知项目');
          break;
        }
      }
    });
  }

  private async handleOpenWith(fsPath: string, projectName: string) {
    try {
      const uri = fsPath.includes('://') ? vscode.Uri.parse(fsPath) : vscode.Uri.file(fsPath);
      const ext = path.extname(uri.fsPath || fsPath).toLowerCase();
      const isSvg = ext === '.svg' || ext === '.svga';

      const textOption: vscode.QuickPickItem = {
        label: '$(code) 文本编辑器',
        description: '以纯文本代码形式打开'
      };
      const previewOption: vscode.QuickPickItem = {
        label: '$(preview) 解析编辑器',
        description: '渲染并预览页面 / 图像'
      };

      const items = isSvg ? [previewOption, textOption] : [textOption, previewOption];

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: `选择 ${path.basename(uri.path)} 的打开方式...`
      });

      if (!selected) return;

      await this.closeExistingPreviews(uri.fsPath);

      if (selected.label.includes('文本编辑器')) {
        try {
          const doc = await vscode.workspace.openTextDocument(uri);
          await vscode.window.showTextDocument(doc);
        } catch (err) {
          vscode.window.showErrorMessage(`无法以文本模式打开该文件：${(err as Error).message}`);
        }
      } else {
        this.openHtmlPreviewPanel(fsPath, projectName, vscode.ViewColumn.Active);
      }
    } catch (e) {
      vscode.window.showErrorMessage('操作中断，请重试。');
    }
  }

  private openHtmlPreviewPanel(fsPath: string, projectName: string, viewColumn: vscode.ViewColumn) {
    try {
      const uri = fsPath.includes('://') ? vscode.Uri.parse(fsPath) : vscode.Uri.file(fsPath);
      const fileName = path.basename(uri.path);

      const panel = vscode.window.createWebviewPanel(
        'htmlPreviewReact',
        `${projectName}: ${fileName}`,
        viewColumn,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [
            this.context.extensionUri,
            vscode.Uri.file(path.dirname(uri.fsPath))
          ]
        }
      );

      this.activePanels.set(uri.fsPath, panel);

      panel.onDidChangeViewState(({ webviewPanel }) => {
        if (webviewPanel.active) {
          this.setActivePath(fsPath);
        }
      });

      panel.onDidDispose(() => {
        if (this.activePanels.get(uri.fsPath) === panel) {
          this.activePanels.delete(uri.fsPath);
        }
      });

      panel.webview.onDidReceiveMessage(async (msg) => {
        if (msg.command === 'webviewLoaded') {
          panel.webview.postMessage({
            type: 'initHtmlPreviewPath',
            fsPath,
          });
        }

        if (msg.type === 'loadLocalHtmlFile') {
          const targetFsPath = msg.fsPath || fsPath;

          try {
            const targetUri = targetFsPath.includes('://') ? vscode.Uri.parse(targetFsPath) : vscode.Uri.file(targetFsPath);
            const contentBytes = await vscode.workspace.fs.readFile(targetUri);
            const content = Buffer.from(contentBytes).toString('utf8');

            panel.webview.postMessage({
              type: 'initHtmlData',
              fsPath: targetFsPath,
              content,
            });
          } catch (e: any) {
            panel.webview.postMessage({
              type: 'initLocalFileError',
              fsPath: targetFsPath,
              message: e?.message || 'HTML 文件读取失败',
            });
          }
        }

        if (msg.command === 'openExternal') {
          try {
            await vscode.env.openExternal(vscode.Uri.parse(msg.url));
          } catch (e) {
            vscode.window.showErrorMessage('无法打开该外部链接。');
          }
        }
      });

      panel.webview.html = getReactWebviewHtml(this.context.extensionUri, panel.webview, '/html-preview');
      panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'icons', 'html.svg');
    } catch (e) {
      vscode.window.showErrorMessage('无法打开 HTML 预览。');
    }
  }

  private async openExcelPanel(fsPath: string, projectName: string, viewColumn: vscode.ViewColumn) {
    try {
      const uri = fsPath.includes('://') ? vscode.Uri.parse(fsPath) : vscode.Uri.file(fsPath);
      const fileName = path.basename(uri.path);

      await this.closeExistingPreviews(uri.fsPath);

      const contentBytes = await vscode.workspace.fs.readFile(uri);
      const fileBase64 = Buffer.from(contentBytes).toString('base64');

      const panel = vscode.window.createWebviewPanel(
        'excelPreviewReact',
        `${projectName}: ${fileName}`,
        viewColumn,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [this.context.extensionUri]
        }
      );

      this.activePanels.set(uri.fsPath, panel);

      panel.onDidChangeViewState(({ webviewPanel }) => {
        if (webviewPanel.active) {
          this.setActivePath(fsPath);
        }
      });

      panel.onDidDispose(() => {
        if (this.activePanels.get(uri.fsPath) === panel) {
          this.activePanels.delete(uri.fsPath);
        }
      });

      panel.webview.onDidReceiveMessage(async (msg) => {
        if (msg.command === 'webviewLoaded') {
          panel.webview.postMessage({
            type: 'initExcelData',
            fsPath: fsPath,
            fileName: fileName,
            contentBase64: fileBase64
          });
        }
      });

      panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'icons', 'table.svg');
      panel.webview.html = getReactWebviewHtml(this.context.extensionUri, panel.webview, `/xls?type=read`);

    } catch (e) {
      vscode.window.showErrorMessage('无法读取文件进行 Excel 预览。');
    }
  }

  private async openPdfPanel(fsPath: string, projectName: string, viewColumn: vscode.ViewColumn) {
    try {
      const uri = fsPath.includes('://') ? vscode.Uri.parse(fsPath) : vscode.Uri.file(fsPath);
      const fileName = path.basename(uri.path);
      await this.closeExistingPreviews(uri.fsPath);

      const panel = vscode.window.createWebviewPanel(
        'pdfPreviewReact',
        `${projectName}: ${fileName}`,
        viewColumn,
        {
          enableScripts: true,
          localResourceRoots: [this.context.extensionUri]
        }
      );
      this.activePanels.set(uri.fsPath, panel);

      panel.onDidChangeViewState(({ webviewPanel }) => {
        if (webviewPanel.active) {
          this.setActivePath(fsPath);
        }
      });

      panel.onDidDispose(() => {
        if (this.activePanels.get(uri.fsPath) === panel) {
          this.activePanels.delete(uri.fsPath);
        }
      });

      panel.webview.onDidReceiveMessage(async (msg) => {
        if (msg.command === 'webviewLoaded') {
          try {
            const contentBytes = await vscode.workspace.fs.readFile(uri);
            const fileBase64 = Buffer.from(contentBytes).toString('base64');
            panel.webview.postMessage({
              type: 'initPdfData',
              contentBase64: fileBase64
            });
          } catch (e) {
            console.error('PDF 读取失败', e);
          }
        }
      });

      panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'icons', 'pdf.svg');
      panel.webview.html = getReactWebviewHtml(this.context.extensionUri, panel.webview, `/pdf?type=read`);

    } catch (e) {
      vscode.window.showErrorMessage('无法读取文件进行 PDF 预览。');
    }
  }

  private async openVditorPanel(fsPath: string, projectName: string, type: 'read' | 'edit') {
    try {
      const uri = fsPath.includes('://') ? vscode.Uri.parse(fsPath) : vscode.Uri.file(fsPath);
      const fileName = path.basename(uri.path);
      await this.closeExistingPreviews(uri.fsPath);

      const contentBytes = await vscode.workspace.fs.readFile(uri);
      const content = Buffer.from(contentBytes).toString('utf8');

      const mdDir = path.dirname(uri.fsPath);
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';

      const panel = vscode.window.createWebviewPanel(
        'vditorPreviewReact',
        `${projectName}: ${fileName}`,
        vscode.ViewColumn.Active,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [
            this.context.extensionUri,
            vscode.Uri.file(mdDir),
            ...(workspaceRoot ? [vscode.Uri.file(workspaceRoot)] : [])
          ]
        }
      );
      this.activePanels.set(uri.fsPath, panel);

      const markdownResult = await setupMarkdown({
        content,
        fsPath: uri.fsPath,
        workspaceRoot,
        webview: panel.webview,
      })
        .use(markdownImagePlugin)
        .end();

      this.markdownImageAssets.set(uri.fsPath, markdownResult.assets);

      panel.onDidChangeViewState(({ webviewPanel }) => {
        if (webviewPanel.active) {
          this.setActivePath(fsPath);
        }
      });

      panel.onDidDispose(() => {
        if (this.activePanels.get(uri.fsPath) === panel) {
          this.activePanels.delete(uri.fsPath);
        }

        this.markdownImageAssets.delete(uri.fsPath);
      });

      panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'icons', 'markdown.svg');

      panel.webview.onDidReceiveMessage(async (msg) => {
        if (msg.command === 'webviewLoaded') {
          panel.webview.postMessage({
            type: 'initVditorData',
            content: markdownResult.content,
            mode: type,
            fsPath: fsPath
          });
        } else if (msg.command === 'saveMarkdown' && type === 'edit') {
          const assets = this.markdownImageAssets.get(uri.fsPath) || {};
          const saveContent = restoreMarkdownImagePaths(msg.content || '', assets);

          await vscode.workspace.fs.writeFile(uri, Buffer.from(saveContent, 'utf8'));
          vscode.window.showInformationMessage('✅ Markdown 已保存');
        } else if (msg.command === 'openExternal') {
          try {
            await vscode.env.openExternal(vscode.Uri.parse(msg.url));
          } catch (e) {
            vscode.window.showErrorMessage('无法打开该外部链接。');
          }
        } else if (msg.command === 'copyToClipboard') {
          vscode.env.clipboard.writeText(msg.text);
          vscode.window.showInformationMessage(`🔗 链接已复制: ${msg.text}`);
        }
      });

      panel.webview.html = getReactWebviewHtml(this.context.extensionUri, panel.webview, `/Vditor?type=${type}`);

    } catch (e) {
      vscode.window.showErrorMessage('无法读取文件进行 Vditor 预览。');
    }
  }

  private async handleSearchFileName(fsPath: string, query: string, isRemote: boolean, focusOnly: boolean = false) {
    if (isRemote) {
      this._view?.webview.postMessage({ type: 'searchFileNameResult', results: [], error: '远程仓库暂不支持名称检索。' });
      return;
    }

    const uri = fsPath.includes('://') ? vscode.Uri.parse(fsPath) : vscode.Uri.file(fsPath);
    const nativePath = uri.fsPath;

    if (!query.trim()) {
      this._view?.webview.postMessage({ type: 'searchFileNameResult', results: [] });
      return;
    }

    try {
      await vscode.workspace.fs.stat(uri);
    } catch {
      this._view?.webview.postMessage({ type: 'searchFileNameResult', results: [] });
      return;
    }

    const results: any[] = [];
    const maxResults = 200;
    let currentResults = 0;

    const gitRoot = await this.getGitRoot(nativePath);
    const statusMap = gitRoot ? await this.getGitStatusMap(nativePath) : new Map<string, string>();

    const IGNORE_DIRS = new Set(['node_modules', 'dist', 'build', '.git', '.svn', '.vscode', '.idea']);

    const searchRecursive = async (dirUri: vscode.Uri, currentNativePath: string) => {
      if (currentResults >= maxResults) return;
      try {
        const entries = await vscode.workspace.fs.readDirectory(dirUri);
        for (const [name, type] of entries) {
          if (currentResults >= maxResults) break;
          if (IGNORE_DIRS.has(name) || name === '.DS_Store') continue;

          const isDir = (type & vscode.FileType.Directory) !== 0;
          const fullPath = path.join(currentNativePath, name);
          const fullUri = vscode.Uri.joinPath(dirUri, name);
          const relativePath = path.relative(nativePath, fullPath).replace(/\\/g, '/');
          const gitRelativePath = gitRoot ? path.relative(gitRoot, fullPath) : '';
          const status = gitRoot ? this.getChildGitStatus(gitRelativePath, isDir, statusMap) : undefined;

          if (focusOnly && !status) {
            continue;
          }

          if (name.toLowerCase().includes(query.toLowerCase())) {
            results.push({
              path: fullUri.toString(),
              name: relativePath,
              isFolder: isDir,
              status
            });
            currentResults++;
          }

          if (isDir) {
            await searchRecursive(fullUri, fullPath);
          }
        }
      } catch (e) { }
    };

    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Window,
      title: 'Quick Ops: 正在按名称检索...'
    }, async () => {
      await searchRecursive(uri, nativePath);
    });

    this._view?.webview.postMessage({ type: 'searchFileNameResult', results });
  }

  private async handleSearchInFolder(fsPath: string, query: string, isRemote: boolean, focusOnly: boolean = false) {
    if (isRemote) {
      this._view?.webview.postMessage({ type: 'searchFolderResult', results: [], error: '由于网络限制，远程仓库暂不支持全文代码检索，请在本地打开该项目后再尝试。' });
      return;
    }

    const uri = fsPath.includes('://') ? vscode.Uri.parse(fsPath) : vscode.Uri.file(fsPath);
    const nativePath = uri.fsPath;

    if (!query.trim()) {
      this._view?.webview.postMessage({ type: 'searchFolderResult', results: [] });
      return;
    }

    try {
      await vscode.workspace.fs.stat(uri);
    } catch {
      this._view?.webview.postMessage({ type: 'searchFolderResult', results: [] });
      return;
    }

    const results: any[] = [];
    const maxResults = 200;
    let currentResults = 0;

    const gitRoot = await this.getGitRoot(nativePath);
    const statusMap = gitRoot ? await this.getGitStatusMap(nativePath) : new Map<string, string>();

    const IGNORE_DIRS = new Set([
      'node_modules', 'bower_components', 'vendor',
      '.git', '.svn', '.hg', 'CVS', '.vscode', '.idea',
      'dist', 'build', 'out', 'coverage', '.next', '.nuxt', '.cache'
    ]);

    const BINARY_EXTS = new Set([
      '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.webp', '.bmp', '.tif', '.tiff',
      '.woff', '.woff2', '.ttf', '.eot', '.otf',
      '.mp4', '.mp3', '.wav', '.ogg', '.webm', '.mov', '.avi',
      '.pdf', '.zip', '.tar', '.gz', '.7z', '.rar', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
      '.exe', '.dll', '.so', '.dylib', '.class', '.jar', '.bin', '.DS_Store', 'Thumbs.db', '.pyc', '.o'
    ]);

    const searchRecursive = async (dirPath: string) => {
      if (currentResults >= maxResults) return;
      try {
        const dirUri = vscode.Uri.file(dirPath);
        let entries;
        try {
          entries = await vscode.workspace.fs.readDirectory(dirUri);
        } catch (e) { return; }

        for (const [name, type] of entries) {
          if (currentResults >= maxResults) break;

          if (IGNORE_DIRS.has(name) || name === '.DS_Store' || name === 'Thumbs.db') continue;

          const fullPath = path.join(dirPath, name);
          const isDir = (type & vscode.FileType.Directory) !== 0;
          const isFile = (type & vscode.FileType.File) !== 0;

          if (isDir) {
            await searchRecursive(fullPath);
          } else if (isFile) {
            const ext = path.extname(name).toLowerCase();
            if (BINARY_EXTS.has(ext)) continue;

            const fileUri = vscode.Uri.file(fullPath);
            try {
              const stat = await vscode.workspace.fs.stat(fileUri);
              if (stat.size > 2 * 1024 * 1024) continue;
            } catch (e) { continue; }

            const gitRelativePath = gitRoot ? path.relative(gitRoot, fullPath) : '';
            const status = gitRoot ? this.getChildGitStatus(gitRelativePath, false, statusMap) : undefined;

            if (focusOnly && !status) continue;

            const fileMatches = [];
            let lineNum = 1;

            try {
              const contentBytes = await vscode.workspace.fs.readFile(fileUri);
              const contentStr = Buffer.from(contentBytes).toString('utf8');
              const lines = contentStr.split(/\r?\n/);

              for (const line of lines) {
                if (line.toLowerCase().includes(query.toLowerCase())) {
                  fileMatches.push({
                    line: lineNum,
                    text: line.trim().substring(0, 300)
                  });
                  currentResults++;
                  if (currentResults >= maxResults) {
                    break;
                  }
                }
                lineNum++;
              }
            } catch (e) { }

            if (fileMatches.length > 0) {
              const relativePath = path.relative(nativePath, fullPath).replace(/\\/g, '/');
              results.push({
                file: relativePath,
                fullPath: fullPath,
                matches: fileMatches,
                status
              });
            }
          }
        }
      } catch (e) { }
    };

    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Window,
      title: 'Quick Ops: 正在检索文件夹内容...'
    }, async () => {
      await searchRecursive(nativePath);
    });

    this._view?.webview.postMessage({ type: 'searchFolderResult', results });
  }

  private getWritableLocalUri(fsPath: string) {
    const uri = fsPath.includes('://') ? vscode.Uri.parse(fsPath) : vscode.Uri.file(fsPath);

    if (uri.scheme !== 'file') {
      vscode.window.showWarningMessage('当前只支持在本地文件夹中新建文件或文件夹。');
      return null;
    }

    return uri;
  }

  private validateNewEntityName(name: string) {
    const value = name.trim();

    if (!value) {
      return '';
    }

    if (/[\\/]/.test(value)) {
      vscode.window.showWarningMessage('名称不能包含 / 或 \\。');
      return '';
    }

    return value;
  }

  private async createFileEntity(parentFsPath: string) {
    try {
      const parentUri = this.getWritableLocalUri(parentFsPath);
      if (!parentUri) return;

      const input = await vscode.window.showInputBox({
        title: '新建文件',
        prompt: '请输入新文件名',
        placeHolder: '例如：index.ts',
        ignoreFocusOut: true,
      });

      const fileName = this.validateNewEntityName(input || '');
      if (!fileName) return;

      const fileUri = vscode.Uri.joinPath(parentUri, fileName);

      try {
        await vscode.workspace.fs.stat(fileUri);
        vscode.window.showWarningMessage(`文件已存在: ${fileName}`);
        return;
      } catch {
        // 文件不存在时继续创建
      }

      await vscode.workspace.fs.writeFile(fileUri, new Uint8Array());
      this.invalidateDirCache(parentUri.toString());
      this.refresh(true);

      const doc = await vscode.workspace.openTextDocument(fileUri);
      await vscode.window.showTextDocument(doc, { preview: false });
      vscode.window.showInformationMessage(`已新建文件: ${fileName}`);
    } catch (e) {
      vscode.window.showErrorMessage(`新建文件失败，详情: ${e}`);
    }
  }

  private async createFolderEntity(parentFsPath: string) {
    try {
      const parentUri = this.getWritableLocalUri(parentFsPath);
      if (!parentUri) return;

      const input = await vscode.window.showInputBox({
        title: '新建文件夹',
        prompt: '请输入新文件夹名',
        placeHolder: '例如：components',
        ignoreFocusOut: true,
      });

      const folderName = this.validateNewEntityName(input || '');
      if (!folderName) return;

      const folderUri = vscode.Uri.joinPath(parentUri, folderName);

      try {
        await vscode.workspace.fs.stat(folderUri);
        vscode.window.showWarningMessage(`文件夹已存在: ${folderName}`);
        return;
      } catch {
        // 文件夹不存在时继续创建
      }

      await vscode.workspace.fs.createDirectory(folderUri);
      this.invalidateDirCache(parentUri.toString());
      this.refresh(true);
      vscode.window.showInformationMessage(`已新建文件夹: ${folderName}`);
    } catch (e) {
      vscode.window.showErrorMessage(`新建文件夹失败，详情: ${e}`);
    }
  }

  private async copyFileEntity(fsPath: string) {
    try {
      const uri = fsPath.includes('://') ? vscode.Uri.parse(fsPath) : vscode.Uri.file(fsPath);
      const parsedPath = path.posix.parse(uri.path);
      let newFileName = `${parsedPath.name}_copy${parsedPath.ext}`;
      let newUri = vscode.Uri.joinPath(uri, '..', newFileName);

      let counter = 1;
      while (true) {
        try {
          await vscode.workspace.fs.stat(newUri);
          counter++;
          newFileName = `${parsedPath.name}_copy${counter}${parsedPath.ext}`;
          newUri = vscode.Uri.joinPath(uri, '..', newFileName);
        } catch (error) {
          break;
        }
      }

      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: '正在复制文件...' },
        async () => {
          await vscode.workspace.fs.copy(uri, newUri);
        }
      );

      vscode.window.showInformationMessage(`📄 文件已复制为: ${newFileName}`);
    } catch (e) {
      vscode.window.showErrorMessage(`复制文件失败，详情: ${e}`);
    }
  }

  private parseRemoteUrlInput(input: string) {
    let targetUriStr = '';
    let repoFullName = '';
    let platform: 'github' | 'gitlab' = 'github';
    let customDomain = '';

    const trimmedInput = input.trim();
    const urlMatch = trimmedInput.match(/^(?:https?:\/\/|git@)([^/:]+)[:\/](.+?)(\.git)?$/);
    const simpleRepoMatch = trimmedInput.match(/^([^/]+\/[^/]+)$/);

    if (urlMatch) {
      customDomain = urlMatch[1];
      repoFullName = urlMatch[2];

      if (customDomain === 'github.com') {
        platform = 'github';
        targetUriStr = `vscode-vfs://github/${repoFullName}`;
        customDomain = '';
      } else if (customDomain === 'gitlab.com') {
        platform = 'gitlab';
        targetUriStr = `vscode-vfs://gitlab/${repoFullName}`;
        customDomain = '';
      } else {
        platform = customDomain.includes('gitlab') ? 'gitlab' : 'github';
        targetUriStr = trimmedInput.startsWith('http') ? trimmedInput.replace(/\.git$/, '') : `https://${customDomain}/${repoFullName}`;
      }
    } else if (simpleRepoMatch) {
      repoFullName = simpleRepoMatch[1];
      platform = 'github';
      targetUriStr = `vscode-vfs://github/${repoFullName}`;
    } else {
      try {
        const uri = vscode.Uri.parse(trimmedInput);
        if (!uri.scheme || uri.scheme === 'file') return null;
        targetUriStr = uri.toString();
        repoFullName = trimmedInput.split(/[/\\]/).pop() || 'Remote Project';
      } catch (e) {
        return null;
      }
    }
    return { targetUriStr, repoFullName, platform, customDomain };
  }

  private async changeProjectAddress(fsPath: string) {
    const projects = this.getRecentProjects();
    const index = projects.findIndex((p) => p.fsPath === fsPath);
    if (index === -1) return;

    const project = projects[index];
    const isRemote = project.fsPath.startsWith('vscode-vfs') || project.fsPath.startsWith('http');

    if (isRemote) {
      let displayValue = project.fsPath;
      if (project.fsPath.startsWith('vscode-vfs://github/')) {
        displayValue = project.fsPath.replace('vscode-vfs://github/', 'https://github.com/');
      } else if (project.fsPath.startsWith('vscode-vfs://gitlab/')) {
        displayValue = project.fsPath.replace('vscode-vfs://gitlab/', 'https://gitlab.com/');
      }

      const newAddress = await vscode.window.showInputBox({
        prompt: `请输入该项目 (${project.name}) 的新远程地址`,
        value: displayValue,
        ignoreFocusOut: true,
      });

      if (newAddress) {
        const parsed = this.parseRemoteUrlInput(newAddress);
        if (parsed) {
          project.fsPath = parsed.targetUriStr;
          project.platform = parsed.platform;
          project.customDomain = parsed.customDomain;
          project.branch = undefined;

          await this.context.globalState.update(this.stateKey, projects);
          this.updateWebview();
          vscode.window.showInformationMessage('远程地址已更新。');
        } else {
          vscode.window.showErrorMessage('无效的远程地址格式。');
        }
      }
    } else {
      const uri = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: '选择新的本地文件夹',
        defaultUri: vscode.Uri.parse(project.fsPath),
      });

      if (uri && uri[0]) {
        project.fsPath = uri[0].toString();
        await this.context.globalState.update(this.stateKey, projects);
        this.updateWebview();
        vscode.window.showInformationMessage('本地项目路径已更新。');
      }
    }
  }

  private async fetchDefaultBranch(platform: string, domain: string, repoFullName: string): Promise<string | undefined> {
    return new Promise((resolve) => {
      let options: any = {};
      const token = vscode.workspace.getConfiguration('quickOps.git').get('githubToken');
      const headers: any = { 'User-Agent': 'VSCode-QuickOps-Extension' };
      if (token && platform !== 'gitlab') {
        headers['Authorization'] = `token ${token}`;
      }
      if (platform === 'gitlab') {
        const apiHostname = domain || 'gitlab.com';
        const encodedProjectPath = encodeURIComponent(repoFullName);
        options = { hostname: apiHostname, path: `/api/v4/projects/${encodedProjectPath}`, headers: { 'User-Agent': 'VSCode-QuickOps-Extension' } };
      } else {
        const apiHostname = domain || 'api.github.com';
        options = { hostname: apiHostname, path: `/repos/${repoFullName}`, headers: { 'User-Agent': 'VSCode-QuickOps-Extension' } };
      }

      https
        .get(options, (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            if (res.statusCode === 200) {
              try {
                resolve(JSON.parse(data).default_branch);
              } catch (e) {
                resolve(undefined);
              }
            } else {
              resolve(undefined);
            }
          });
        })
        .on('error', () => resolve(undefined));
    });
  }

  private async refreshBranchesAsync() {
    let projects = this.getRecentProjects();
    let stateChanged = false;

    for (let i = 0; i < projects.length; i++) {
      const p = projects[i];
      let newBranch: string | undefined = undefined;

      if (p.fsPath.startsWith('vscode-vfs://') || p.fsPath.startsWith('http')) {
        const match = p.fsPath.match(/[?&]ref=([^&]+)/);
        if (match) {
          newBranch = match[1];
        } else {
          let repoFullName = '';
          if (p.fsPath.startsWith('vscode-vfs://')) {
            repoFullName = p.fsPath.split('?')[0].replace('vscode-vfs://github/', '').replace('vscode-vfs://gitlab/', '');
          } else if (p.fsPath.startsWith('http')) {
            try {
              const url = new URL(p.fsPath);
              repoFullName = url.pathname.replace(/^\//, '').replace(/\.git$/, '');
            } catch (e) { }
          }
          if (repoFullName) {
            newBranch = await this.fetchDefaultBranch(p.platform || 'github', p.customDomain || '', repoFullName);
          }
        }
      } else {
        try {
          const baseUri = p.fsPath.includes('://') ? vscode.Uri.parse(p.fsPath) : vscode.Uri.file(p.fsPath);
          let gitPath = vscode.Uri.joinPath(baseUri, '.git');

          const stat = await vscode.workspace.fs.stat(gitPath);

          if ((stat.type & vscode.FileType.File) !== 0) {
            const fileBytes = await vscode.workspace.fs.readFile(gitPath);
            const fileContent = Buffer.from(fileBytes).toString('utf8').trim();
            if (fileContent.startsWith('gitdir: ')) {
              const realGitDir = fileContent.replace('gitdir: ', '').trim();
              const realGitDirPath = path.isAbsolute(realGitDir)
                ? realGitDir
                : path.join(baseUri.fsPath, realGitDir);
              gitPath = vscode.Uri.file(realGitDirPath);
            }
          }

          const headUri = vscode.Uri.joinPath(gitPath, 'HEAD');
          const contentBytes = await vscode.workspace.fs.readFile(headUri);
          const content = Buffer.from(contentBytes).toString('utf8').trim();

          newBranch = content.startsWith('ref: ')
            ? content.replace(/^ref:\s*refs\/heads\//, '')
            : content.substring(0, 7);
        } catch (e) {
          newBranch = undefined;
        }
      }

      this._view?.webview.postMessage({ type: 'updateBranchTag', fsPath: p.fsPath, branch: newBranch });

      if (p.branch !== newBranch) {
        p.branch = newBranch;
        stateChanged = true;
      }

      await new Promise(resolve => setTimeout(resolve, 5));
    }

    if (stateChanged) {
      await this.context.globalState.update(this.stateKey, projects);
    }
  }

  public async updateSingleBranch(fsPath: string, silent: boolean = false) {
    let projects = this.getRecentProjects();
    const index = projects.findIndex((p) => p.fsPath === fsPath);

    let p: RecentProject;
    if (index > -1) {
      p = projects[index];
    } else {
      const folders = vscode.workspace.workspaceFolders;
      if (folders && folders[0].uri.toString() === fsPath) {
        let platform, customDomain;
        if (fsPath.startsWith('vscode-vfs://') || fsPath.startsWith('http')) {
          const parsed = this.parseRemoteUrlInput(fsPath);
          if (parsed) { platform = parsed.platform; customDomain = parsed.customDomain; }
        }
        p = { name: folders[0].name, fsPath: fsPath, timestamp: 0, platform, customDomain };
      } else {
        return;
      }
    }

    const displayName = p.customName || p.name;

    const fetchTask = async () => {
      let newBranch: string | undefined = undefined;

      if (p.fsPath.startsWith('vscode-vfs://') || p.fsPath.startsWith('http')) {
        const match = p.fsPath.match(/[?&]ref=([^&]+)/);
        if (match) {
          newBranch = match[1];
        } else {
          let repoFullName = '';
          if (p.fsPath.startsWith('vscode-vfs://')) {
            repoFullName = p.fsPath.split('?')[0].replace('vscode-vfs://github/', '').replace('vscode-vfs://gitlab/', '');
          } else if (p.fsPath.startsWith('http')) {
            try {
              const url = new URL(p.fsPath);
              repoFullName = url.pathname.replace(/^\//, '').replace(/\.git$/, '');
            } catch (e) { }
          }
          if (repoFullName) {
            newBranch = await this.fetchDefaultBranch(p.platform || 'github', p.customDomain || '', repoFullName);
          }
        }
      } else {
        try {
          const baseUri = p.fsPath.includes('://') ? vscode.Uri.parse(p.fsPath) : vscode.Uri.file(p.fsPath);
          let gitPath = vscode.Uri.joinPath(baseUri, '.git');

          const stat = await vscode.workspace.fs.stat(gitPath);

          if ((stat.type & vscode.FileType.File) !== 0) {
            const fileBytes = await vscode.workspace.fs.readFile(gitPath);
            const fileContent = Buffer.from(fileBytes).toString('utf8').trim();
            if (fileContent.startsWith('gitdir: ')) {
              const realGitDir = fileContent.replace('gitdir: ', '').trim();
              const realGitDirPath = path.isAbsolute(realGitDir)
                ? realGitDir
                : path.join(baseUri.fsPath, realGitDir);
              gitPath = vscode.Uri.file(realGitDirPath);
            }
          }

          const headUri = vscode.Uri.joinPath(gitPath, 'HEAD');
          const contentBytes = await vscode.workspace.fs.readFile(headUri);
          const content = Buffer.from(contentBytes).toString('utf8').trim();

          newBranch = content.startsWith('ref: ')
            ? content.replace(/^ref:\s*refs\/heads\//, '')
            : content.substring(0, 7);
        } catch (e) {
          newBranch = undefined;
        }
      }

      this._view?.webview.postMessage({ type: 'updateBranchTag', fsPath: p.fsPath, branch: newBranch });

      if (p.branch !== newBranch) {
        const currentProjects = this.getRecentProjects();
        const currentIndex = currentProjects.findIndex((cp) => cp.fsPath === fsPath);
        if (currentIndex > -1) {
          currentProjects[currentIndex].branch = newBranch;
          await this.context.globalState.update(this.stateKey, currentProjects);
        }
      }
    };

    if (silent) {
      fetchTask().catch(() => { });
    } else {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Window,
          title: `Quick Ops: 正在更新 [${displayName}] 的分支信息...`,
        },
        fetchTask
      );
      vscode.window.showInformationMessage(`🎉 项目 [${displayName}] 的分支更新成功！`);
    }
  }

  private async editProjectName(fsPath: string) {
    const projects = this.getRecentProjects();
    const index = projects.findIndex((p) => p.fsPath === fsPath);
    if (index === -1) return;

    const proj = projects[index];
    const newName = await vscode.window.showInputBox({
      prompt: '请输入新的项目名称 (留空则恢复默认名称)',
      value: proj.customName || proj.name,
    });

    if (newName !== undefined) {
      if (newName.trim() === '') {
        delete projects[index].customName;
      } else {
        projects[index].customName = newName.trim();
      }
      await this.context.globalState.update(this.stateKey, projects);
      this.updateWebview();
    }
  }

  private openExternalLink(fsPath: string, platform?: string, customDomain?: string) {
    try {
      let targetUrl = '';
      if (fsPath.startsWith('http')) {
        targetUrl = fsPath.split('?')[0];
      } else if (fsPath.startsWith('vscode-vfs://')) {
        const repoPath = fsPath.split('?')[0].replace(`vscode-vfs://${platform}/`, '');
        if (customDomain) {
          targetUrl = `https://${customDomain}/${repoPath}`;
        } else {
          const domain = platform === 'gitlab' ? 'gitlab.com' : 'github.com';
          targetUrl = `https://${domain}/${repoPath}`;
        }
      }
      if (targetUrl) {
        vscode.env.openExternal(vscode.Uri.parse(targetUrl));
      } else {
        vscode.window.showErrorMessage('无法解析该项目的网页链接。');
      }
    } catch (e) {
      vscode.window.showErrorMessage('打开链接失败。');
    }
  }

  private async openFileReadOnly(fsPath: string, projectName: string, viewColumn: vscode.ViewColumn = vscode.ViewColumn.Active, preview: boolean = true) {
    try {
      const roUri = this.getReadOnlyUri(fsPath, projectName);
      const doc = await vscode.workspace.openTextDocument(roUri);
      await vscode.window.showTextDocument(doc, { preview, viewColumn });
    } catch (e) {
      vscode.window.showErrorMessage('无法打开该文件预览。');
    }
  }

  public async switchRemoteBranch(fsPath: string) {
    const project = this.getRecentProjects().find((p) => p.fsPath === fsPath);
    if (!project) return;

    let platform = project.platform || 'github';
    let domain = project.customDomain || '';
    let repoFullName = '';

    if (fsPath.startsWith('vscode-vfs://')) {
      const parts = fsPath.split('?')[0].replace('vscode-vfs://github/', '').replace('vscode-vfs://gitlab/', '').split('/');
      repoFullName = parts.join('/');
    } else if (fsPath.startsWith('http')) {
      try {
        const url = new URL(fsPath);
        domain = url.hostname;
        repoFullName = url.pathname.replace(/^\//, '').replace(/\.git$/, '');
      } catch (e) { }
    }

    if (!repoFullName) return;

    try {
      await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `正在查询 ${repoFullName.split('/').pop()} 的远程分支...`, cancellable: false }, async () => {
        return new Promise<any[]>((resolve, reject) => {
          let options: any = {};
          const token = vscode.workspace.getConfiguration('quickOps.git').get('githubToken');
          const headers: any = { 'User-Agent': 'VSCode-QuickOps-Extension' };
          if (token && platform !== 'gitlab') {
            headers['Authorization'] = `token ${token}`;
          }
          if (platform === 'gitlab') {
            const apiHostname = domain || 'gitlab.com';
            const encodedProjectPath = encodeURIComponent(repoFullName);
            options = { hostname: apiHostname, path: `/api/v4/projects/${encodedProjectPath}/repository/branches`, headers: { 'User-Agent': 'VSCode-QuickOps-Extension' } };
          } else {
            const apiHostname = domain || 'api.github.com';
            options = { hostname: apiHostname, path: `/repos/${repoFullName}/branches`, headers: { 'User-Agent': 'VSCode-QuickOps-Extension' } };
          }

          https
            .get(options, (res) => {
              let data = '';
              res.on('data', (chunk) => (data += chunk));
              res.on('end', () => {
                if (res.statusCode === 200) {
                  try {
                    resolve(JSON.parse(data));
                  } catch (e) {
                    reject(e);
                  }
                } else {
                  reject(new Error(`API Error: ${res.statusCode}`));
                }
              });
            })
            .on('error', reject);
        }).then(async (branches: any[]) => {
          if (!branches || branches.length === 0) {
            vscode.window.showInformationMessage('未能查找到任何远程分支。');
            return;
          }

          const items = branches.map((b) => ({
            label: `$(git-branch) ${b.name}`,
            description: platform === 'gitlab' ? (domain ? `GitLab (${domain})` : 'GitLab 远程分支') : 'GitHub 远程分支',
            branch: b.name,
          }));

          const selected = await vscode.window.showQuickPick(items, { placeHolder: '请选择要切换的远程分支' });

          if (selected) {
            const choice = await vscode.window.showInformationMessage(`已选中分支 [ ${selected.branch} ]，请选择后续操作：`, { modal: true }, '在当前窗口打开', '在新窗口打开', '仅切换标签不打开');
            if (choice) {
              await this.updateProjectBranch(fsPath, selected.branch);
              if (choice !== '仅切换标签不打开') {
                this.executeOpen(fsPath, choice === '在新窗口打开', selected.branch);
              }
            }
          }
        });
      });
    } catch (e) {
      vscode.window.showErrorMessage('获取分支失败。如果是自建私有仓库，请确认网络连通性或是否具备免密接口访问权限。');
    }
  }

  private async updateProjectBranch(fsPath: string, branch: string) {
    let projects = this.getRecentProjects();
    const index = projects.findIndex((p) => p.fsPath === fsPath);
    if (index > -1) {
      projects[index].branch = branch;
      await this.context.globalState.update(this.stateKey, projects);
      this.updateWebview();
    }
  }

  private async readDirectory(
    fsPath: string,
    projectName: string,
    focusOnly: boolean = false,
    forceRefresh: boolean = false
  ) {
    try {
      const uri = fsPath.includes('://') ? vscode.Uri.parse(fsPath) : vscode.Uri.file(fsPath);
      const uriStr = uri.toString();
      const isRemote = uriStr.startsWith('vscode-vfs://') || uriStr.startsWith('http');

      const cacheKey = `${focusOnly ? 'focus:' : 'normal:'}${uriStr}`;
      const cached = this.dirCache.get(cacheKey);
      const now = Date.now();

      if (!forceRefresh && cached && now - cached.timestamp <= this.dirCacheTtl) {
        this._view?.webview.postMessage({
          type: 'readDirResult',
          fsPath: uriStr,
          children: cached.children,
          projectName,
          focusOnly
        });
        return;
      }

      const entries = await vscode.workspace.fs.readDirectory(uri);

      let gitRoot = '';
      let statusMap = new Map<string, string>();

      if (!isRemote && uri.scheme === 'file') {
        gitRoot = await this.getGitRoot(uri.fsPath);
        if (gitRoot) {
          statusMap = await this.getGitStatusMap(uri.fsPath);
        }
      }

      const children = entries
        .map(([name, type]) => {
          const isFolder = (type & vscode.FileType.Directory) !== 0;
          const childUri = vscode.Uri.joinPath(uri, name);
          const childUriStr = childUri.toString();
          let status: string | undefined;

          if (!isRemote && gitRoot && childUri.scheme === 'file') {
            const relativePath = path.relative(gitRoot, childUri.fsPath);
            status = this.getChildGitStatus(relativePath, isFolder, statusMap);
          }

          return { name, isFolder, path: childUriStr, status };
        })
        .filter((c) => c.name !== 'node_modules' && c.name !== '.git')
        .filter((c) => {
          if (!focusOnly) return true;
          return !!c.status;
        })
        .sort((a, b) => {
          if (a.isFolder === b.isFolder) return a.name.localeCompare(b.name);
          return a.isFolder ? -1 : 1;
        });

      this.dirCache.set(cacheKey, {
        children,
        timestamp: now
      });

      this._view?.webview.postMessage({ type: 'readDirResult', fsPath: uriStr, children, projectName, focusOnly });
    } catch (e) {
      vscode.window.showWarningMessage(`读取失败：可能是网络超时或触发了 GitHub API 限制，请稍后再试。`);
      this._view?.webview.postMessage({ type: 'readDirResult', fsPath, children: [], projectName, focusOnly });
    }
  }

  private updateWebview() {
    if (!this._view) return;
    const projects = this.getRecentProjects();

    let currentUriStr = '';
    let currentWorkspaceInfo = null;

    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 0) {
      currentUriStr = folders[0].uri.toString();
      const currentName = folders[0].name;

      let platform, customDomain;
      if (currentUriStr.startsWith('vscode-vfs://') || currentUriStr.startsWith('http')) {
        const parsed = this.parseRemoteUrlInput(currentUriStr);
        if (parsed) {
          platform = parsed.platform;
          customDomain = parsed.customDomain;
        }
      }

      currentWorkspaceInfo = {
        name: currentName,
        fsPath: currentUriStr,
        platform,
        customDomain
      };
    }

    const activeEditor = vscode.window.activeTextEditor;
    const activeFilePath = activeEditor ? activeEditor.document.uri.toString() : '';

    this._view.webview.postMessage({
      type: 'updateProjects',
      data: projects,
      currentUriStr: currentUriStr,
      currentWorkspace: currentWorkspaceInfo,
      lastOpenedPath: this.lastOpenedPath,
      activeFilePath: this.currentActivePath || activeFilePath
    });
  }

  private getRecentProjects(): RecentProject[] {
    return this.context.globalState.get<RecentProject[]>(this.stateKey) || [];
  }

  private async insertProjectToHistory(name: string, uriStr: string, platform?: 'github' | 'gitlab', customDomain?: string) {
    const allProjects = this.getRecentProjects();

    const existingProject = allProjects.find((p) => p.fsPath === uriStr);
    let projects = allProjects.filter((p) => p.fsPath !== uriStr);

    projects.unshift({
      name,
      fsPath: uriStr,
      timestamp: Date.now(),
      platform: platform || existingProject?.platform,
      customDomain: customDomain || existingProject?.customDomain,
      branch: existingProject?.branch,
      customName: existingProject?.customName
    });

    if (projects.length > 50) projects = projects.slice(0, 50);
    await this.context.globalState.update(this.stateKey, projects);
    this.updateWebview();
  }

  public async addLocalProject() {
    const uri = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: '添加到项目列表',
    });

    if (uri && uri[0]) {
      const uriStr = uri[0].toString();

      const projects = this.getRecentProjects();
      if (projects.some((p) => p.fsPath === uriStr)) {
        vscode.window.showWarningMessage('⚠️ 该本地项目已存在于列表中！');
        return;
      }

      const folderName = uri[0].path.split(/[\\/]/).pop() || '本地项目';
      await this.insertProjectToHistory(folderName, uriStr);
      vscode.window.showInformationMessage(`✅ 已添加本地项目: ${folderName}`);
    }
  }

  public async addRemoteProject() {
    const input = await vscode.window.showInputBox({
      prompt: '输入 GitHub/GitLab 仓库或完整 HTTP/SSH 远程地址 (如结尾带 .git)',
      ignoreFocusOut: true,
    });

    if (!input) return;

    const parsed = this.parseRemoteUrlInput(input);

    if (!parsed) {
      vscode.window.showErrorMessage('无效的远程地址格式，请提供规范的 Git 地址。');
      return;
    }

    const projects = this.getRecentProjects();
    if (projects.some((p) => p.fsPath === parsed.targetUriStr)) {
      vscode.window.showWarningMessage('⚠️ 该远程项目已存在于列表中！');
      return;
    }

    const projectName = await vscode.window.showInputBox({ value: parsed.repoFullName.split('/').pop() || parsed.repoFullName });

    if (projectName) {
      await this.insertProjectToHistory(projectName, parsed.targetUriStr, parsed.platform, parsed.customDomain);
      const choice = await vscode.window.showInformationMessage(`已添加远程项目 ${projectName}，要现在打开吗？`, '在当前窗口打开', '在新窗口打开');
      if (choice) this.executeOpen(parsed.targetUriStr, choice === '在新窗口打开');
    }
  }

  private async executeOpen(uriStr: string, forceNewWindow: boolean, branch?: string) {
    try {
      this.lastOpenedPath = uriStr;
      this.updateWebview();

      let finalUriStr = uriStr;

      if (branch && (uriStr.startsWith('vscode-vfs://') || uriStr.startsWith('http'))) {
        const baseUrl = uriStr.split('?')[0];
        finalUriStr = `${baseUrl}?ref=${branch}`;
      }

      const uri = vscode.Uri.parse(finalUriStr);
      await vscode.commands.executeCommand('workbench.view.explorer');
      await vscode.commands.executeCommand('vscode.openFolder', uri, forceNewWindow);
    } catch (e) {
      vscode.window.showErrorMessage('无法打开该仓库，请确保支持该协议。');
    }
  }

  public async openProject(fsPath: string) {
    const project = this.getRecentProjects().find((p) => p.fsPath === fsPath);
    const pName = project?.customName || project?.name || '该项目';

    const choice = await vscode.window.showInformationMessage(
      `准备打开项目 [ ${pName} ]，请选择打开方式：`,
      { modal: true },
      '在当前窗口打开 (覆盖当前)',
      '在新窗口打开'
    );

    if (choice === '在当前窗口打开 (覆盖当前)') {
      this.executeOpen(fsPath, false, project?.branch);
    } else if (choice === '在新窗口打开') {
      this.executeOpen(fsPath, true, project?.branch);
    }
  }

  public async removeProjectByPath(fsPath: string) {
    let projects = this.getRecentProjects().filter((p) => p.fsPath !== fsPath);
    await this.context.globalState.update(this.stateKey, projects);
    this.updateWebview();
  }

  public async clearAll() {
    await this.context.globalState.update(this.stateKey, []);
    this.updateWebview();
    const currentUriStr = vscode.workspace.workspaceFolders?.[0]?.uri.toString();
    if (currentUriStr) {
      this.updateSingleBranch(currentUriStr, true);
    }
  }
}