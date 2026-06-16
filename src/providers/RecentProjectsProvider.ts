import * as vscode from 'vscode';
import * as https from 'https';
import * as path from 'path';
import { getReactWebviewHtml } from '../utils/WebviewHelper';
import { setupMarkdown } from '../plugins/markdown/setupMarkdown';
import markdownImagePlugin, { restoreMarkdownImagePaths } from '../plugins/markdown/markdownImagePlugin';
import { RecentProjectsGitStatusService } from '../services/gitStatusService';
import { RecentProjectsDirectoryService } from '../services/directoryService';
import GitService from '../services/GitService';

export interface RecentProject {
  name: string;
  customName?: string;
  fsPath: string;
  timestamp: number;
  branch?: string;
  platform?: 'github' | 'gitlab';
  customDomain?: string;
  status?: string;
  diagnostics?: DiagnosticSummary;
}

interface DiagnosticSummary {
  errors: number;
  warnings: number;
}

interface MetadataPatchItem {
  path: string;
  status?: string;
  diagnostics: DiagnosticSummary;
}

interface IndexedFileItem {
  name: string;
  fullPath: string;
  uriString: string;
  relativePath: string;
  isFolder: boolean;
  ext: string;
  uri: vscode.Uri;
}

class GitVirtualContentProvider implements vscode.TextDocumentContentProvider {
  private readonly changeEmitter = new vscode.EventEmitter<vscode.Uri>();
  public readonly onDidChange = this.changeEmitter.event;

  private readonly contentMap = new Map<string, string>();

  public provideTextDocumentContent(uri: vscode.Uri): string {
    const key = new URLSearchParams(uri.query).get('key') || '';

    return this.contentMap.get(key) || '';
  }

  public setContent(key: string, content: string): void {
    this.contentMap.set(key, content);
  }

  public deleteContent(key: string): void {
    this.contentMap.delete(key);
  }

  public dispose(): void {
    this.contentMap.clear();
    this.changeEmitter.dispose();
  }
}


export class RecentProjectsProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private stateKey = 'quickOps.recentProjectsHistory';
  private lastOpenedPath: string = '';
  private selectedForCompareUri?: vscode.Uri;
  private selectedForCompareName?: string;
  private readonly gitDiffTargetByUri = new Map<string, string>();
  private activePanels: Map<string, vscode.WebviewPanel> = new Map();

  private currentActivePath: string = '';
  private revealVisibleInWebview: boolean = true;
  private revealVisibleProjectPaths: string[] | undefined = undefined;
  private markdownImageAssets = new Map<string, Record<string, string>>();

  private readonly gitStatusService = new RecentProjectsGitStatusService();
  private readonly directoryService = new RecentProjectsDirectoryService(this.gitStatusService);
  private readonly gitService = new GitService();
  private readonly gitVirtualContentProvider = new GitVirtualContentProvider();

  private readonly loadedDirChildren = new Map<string, any[]>();
  private readonly knownVisibleDirs = new Set<string>();
  private statusSyncTimer: NodeJS.Timeout | undefined;

  private readonly localDirCache = new Map<string, { children: any[]; expiresAt: number }>();
  private readonly localDirInflight = new Map<string, Promise<any[]>>();

  private readonly fileIndexCache = new Map<string, { items: IndexedFileItem[]; expiresAt: number }>();
  private readonly fileIndexInflight = new Map<string, Promise<IndexedFileItem[]>>();

  private activeSearchRunId = 0;

  private readonly localDirCacheTtl = 3000;
  private readonly fileIndexCacheTtl = 15000;

  constructor(private context: vscode.ExtensionContext) {
    this.context.subscriptions.push(
      vscode.workspace.registerTextDocumentContentProvider('quickops-git-virtual', this.gitVirtualContentProvider),
      this.gitVirtualContentProvider
    );

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

  private getGitDiffTargetKey(fsPath: string): string {
    return this.normalizeComparePath(fsPath);
  }

  private trackGitDiffUri(uri: vscode.Uri, targetFsPath: string): void {
    const uriKey = uri.toString();
    const targetKey = this.getGitDiffTargetKey(targetFsPath);

    if (!uriKey || !targetKey) {
      return;
    }

    this.gitDiffTargetByUri.set(uriKey, targetKey);
  }

  private isGitDiffUriMatchedTarget(uri: any, targetKey: string): boolean {
    if (!uri || !targetKey) {
      return false;
    }

    const uriString = typeof uri.toString === 'function' ? uri.toString() : '';
    const mappedTarget = uriString ? this.gitDiffTargetByUri.get(uriString) : undefined;

    if (mappedTarget && mappedTarget === targetKey) {
      return true;
    }

    if (uri.scheme === 'file' && uri.fsPath) {
      return this.getGitDiffTargetKey(uri.fsPath) === targetKey;
    }

    return false;
  }

  private isQuickOpsGitDiffUri(uri: any): boolean {
    if (!uri) {
      return false;
    }

    const uriString = typeof uri.toString === 'function' ? uri.toString() : '';

    return uri.scheme === 'quickops-git-virtual' || (uriString ? this.gitDiffTargetByUri.has(uriString) : false);
  }

  private async closeExistingGitDiffTabs(fsPath: string): Promise<void> {
    if (!vscode.window.tabGroups) {
      return;
    }

    const targetKey = this.getGitDiffTargetKey(fsPath);

    if (!targetKey) {
      return;
    }

    const tabsToClose: vscode.Tab[] = [];

    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const input = tab.input as any;
        const originalUri = input?.original;
        const modifiedUri = input?.modified;

        if (!originalUri || !modifiedUri) {
          continue;
        }

        const isTargetDiff =
          this.isGitDiffUriMatchedTarget(originalUri, targetKey) ||
          this.isGitDiffUriMatchedTarget(modifiedUri, targetKey);

        if (!isTargetDiff) {
          continue;
        }

        const isQuickOpsDiff =
          this.isQuickOpsGitDiffUri(originalUri) ||
          this.isQuickOpsGitDiffUri(modifiedUri) ||
          String(tab.label || '').includes('旧代码');

        if (isQuickOpsDiff) {
          tabsToClose.push(tab);
        }
      }
    }

    if (tabsToClose.length > 0) {
      await vscode.window.tabGroups.close(tabsToClose);
    }
  }


  private getGitRoot(nativePath: string): Promise<string> {
    return this.gitStatusService.getGitRoot(nativePath);
  }

  private getGitStatusMap(nativePath: string): Promise<Map<string, string>> {
    return this.gitStatusService.getGitStatusMap(nativePath);
  }

  private getChildGitStatus(
    childRelativePath: string,
    isFolder: boolean,
    statusMap: Map<string, string>
  ) {
    return this.gitStatusService.getChildGitStatus(childRelativePath, isFolder, statusMap);
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

  private isRemoteFsPath(fsPath: string): boolean {
    return fsPath.startsWith('vscode-vfs://') || fsPath.startsWith('http://') || fsPath.startsWith('https://');
  }

  private getSearchRunId(): number {
    this.activeSearchRunId += 1;
    return this.activeSearchRunId;
  }

  private isSearchCancelled(runId: number): boolean {
    return runId !== this.activeSearchRunId;
  }

  private toResourceUri(fsPath: string): vscode.Uri {
    return fsPath.includes('://') ? vscode.Uri.parse(fsPath) : vscode.Uri.file(fsPath);
  }

  private normalizeNativePath(fsPath: string): string {
    return this.toResourceUri(fsPath).fsPath;
  }

  private decodeFileContent(contentBytes: Uint8Array): string {
    return Buffer.from(contentBytes).toString('utf8');
  }

  private getRelativePathByUri(rootUri: vscode.Uri, childUri: vscode.Uri): string {
    if (rootUri.scheme === 'file' && childUri.scheme === 'file') {
      return path.relative(rootUri.fsPath, childUri.fsPath).replace(/\\/g, '/');
    }

    const rootPath = rootUri.path.replace(/\/+$/, '');
    const childPath = childUri.path;

    if (childPath === rootPath) {
      return '';
    }

    if (childPath.startsWith(`${rootPath}/`)) {
      return decodeURIComponent(childPath.slice(rootPath.length + 1));
    }

    return decodeURIComponent(childPath.split('/').pop() || childPath);
  }

  private async readLocalDirectoryChildrenFast(fsPath: string, forceRefresh: boolean = false): Promise<any[]> {
    const uri = this.toResourceUri(fsPath);
    const cacheKey = uri.toString();

    if (!forceRefresh) {
      const cached = this.localDirCache.get(cacheKey);

      if (cached && cached.expiresAt > Date.now()) {
        return cached.children;
      }

      const inflight = this.localDirInflight.get(cacheKey);

      if (inflight) {
        return inflight;
      }
    }

    const task = vscode.workspace.fs
      .readDirectory(uri)
      .then((entries) => {
        const children = entries
          .filter(([name]) => name !== '.DS_Store' && name !== 'Thumbs.db')
          .map(([name, type]) => {
            const childUri = vscode.Uri.joinPath(uri, name);
            const isFolder = (type & vscode.FileType.Directory) !== 0;

            return {
              path: childUri.toString(),
              name,
              isFolder,
              status: undefined,
              diagnostics: {
                errors: 0,
                warnings: 0,
              },
            };
          })
          .sort((a, b) => {
            if (a.isFolder !== b.isFolder) {
              return a.isFolder ? -1 : 1;
            }

            return a.name.localeCompare(b.name);
          });

        this.localDirCache.set(cacheKey, {
          children,
          expiresAt: Date.now() + this.localDirCacheTtl,
        });

        return children;
      })
      .finally(() => {
        this.localDirInflight.delete(cacheKey);
      });

    this.localDirInflight.set(cacheKey, task);

    return task;
  }

  private postMetadataPatch(items: any[]): void {
    const patch = items
      .map((item) => {
        const itemPath = item?.path || item?.fullPath || item?.fsPath;

        if (!itemPath) {
          return undefined;
        }

        return {
          path: itemPath,
          status: item.status,
          diagnostics: item.diagnostics || {
            errors: 0,
            warnings: 0,
          },
        };
      })
      .filter(Boolean);

    if (patch.length === 0) {
      return;
    }

    this._view?.webview.postMessage({
      type: 'metadataPatch',
      items: patch,
    });
  }

  private async enrichAndPatchChildren(children: any[], rootPath: string): Promise<void> {
    try {
      const enrichedChildren = await this.enrichChildren(children, rootPath);

      this.loadedDirChildren.set(rootPath, enrichedChildren);
      this.postMetadataPatch(enrichedChildren);
    } catch {
      // Git 状态 / 诊断信息失败时，不影响目录展示
    }
  }

  private async getFileIndex(rootFsPath: string, forceRefresh: boolean = false): Promise<IndexedFileItem[]> {
    const rootUri = this.toResourceUri(rootFsPath);
    const cacheKey = rootUri.toString();

    if (!forceRefresh) {
      const cached = this.fileIndexCache.get(cacheKey);

      if (cached && cached.expiresAt > Date.now()) {
        return cached.items;
      }

      const inflight = this.fileIndexInflight.get(cacheKey);

      if (inflight) {
        return inflight;
      }
    }

    const ignoreDirs = new Set([
      'node_modules',
      'bower_components',
      'vendor',
      '.git',
      '.svn',
      '.hg',
      'CVS',
      '.vscode',
      '.idea',
      'dist',
      'build',
      'out',
      'coverage',
      '.next',
      '.nuxt',
      '.cache',
      '.turbo',
    ]);

    const items: IndexedFileItem[] = [];

    const walk = async (dirUri: vscode.Uri): Promise<void> => {
      let entries: [string, vscode.FileType][];

      try {
        entries = await vscode.workspace.fs.readDirectory(dirUri);
      } catch {
        return;
      }

      const childDirs: vscode.Uri[] = [];

      for (const [name, type] of entries) {
        if (name === '.DS_Store' || name === 'Thumbs.db') {
          continue;
        }

        const isFolder = (type & vscode.FileType.Directory) !== 0;

        if (isFolder && ignoreDirs.has(name)) {
          continue;
        }

        const childUri = vscode.Uri.joinPath(dirUri, name);
        const relativePath = this.getRelativePathByUri(rootUri, childUri).replace(/\\/g, '/');
        const ext = path.extname(name).toLowerCase();

        items.push({
          name,
          fullPath: childUri.fsPath || childUri.toString(),
          uriString: childUri.toString(),
          relativePath,
          isFolder,
          ext,
          uri: childUri,
        });

        if (isFolder) {
          childDirs.push(childUri);
        }
      }

      await this.runWithConcurrency(childDirs, 8, (childUri) => walk(childUri));
    };

    const task = walk(rootUri)
      .then(() => {
        const sorted = items.sort((a, b) => {
          if (a.isFolder !== b.isFolder) {
            return a.isFolder ? -1 : 1;
          }

          return a.relativePath.localeCompare(b.relativePath);
        });

        this.fileIndexCache.set(cacheKey, {
          items: sorted,
          expiresAt: Date.now() + this.fileIndexCacheTtl,
        });

        return sorted;
      })
      .finally(() => {
        this.fileIndexInflight.delete(cacheKey);
      });

    this.fileIndexInflight.set(cacheKey, task);

    return task;
  }

  private async runWithConcurrency<T>(
    items: T[],
    concurrency: number,
    worker: (item: T) => Promise<void>
  ): Promise<void> {
    let index = 0;

    const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (index < items.length) {
        const current = items[index];

        index += 1;

        await worker(current);
      }
    });

    await Promise.all(runners);
  }

  private normalizeSearchText(value: string): string {
    return String(value || '')
      .replace(/\\/g, '/')
      .replace(/\/+/g, '/')
      .toLowerCase()
      .trim();
  }

  private compactSearchText(value: string): string {
    return this.normalizeSearchText(value).replace(/[\s/_.@#:$+~\-]+/g, '');
  }

  private getSequentialFuzzyScore(target: string, input: string): number | null {
    if (!target || !input) {
      return null;
    }

    let targetIndex = 0;
    let firstIndex = -1;
    let lastIndex = -1;
    let gapScore = 0;

    for (let i = 0; i < input.length; i++) {
      const char = input[i];
      const foundIndex = target.indexOf(char, targetIndex);

      if (foundIndex === -1) {
        return null;
      }

      if (firstIndex === -1) {
        firstIndex = foundIndex;
      }

      if (lastIndex !== -1) {
        gapScore += Math.max(0, foundIndex - lastIndex - 1);
      }

      lastIndex = foundIndex;
      targetIndex = foundIndex + 1;
    }

    return firstIndex + gapScore + Math.max(0, target.length - input.length) * 0.01;
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
    this.directoryService.invalidateDirCache(fsPath);

    if (!fsPath) {
      this.localDirCache.clear();
      this.localDirInflight.clear();
      this.fileIndexCache.clear();
      this.fileIndexInflight.clear();
      return;
    }

    const targetKey = this.toResourceUri(fsPath).toString();

    this.localDirCache.delete(targetKey);
    this.localDirInflight.delete(targetKey);
    this.fileIndexCache.delete(targetKey);
    this.fileIndexInflight.delete(targetKey);

    Array.from(this.localDirCache.keys()).forEach((key) => {
      if (key.startsWith(targetKey)) {
        this.localDirCache.delete(key);
      }
    });

    Array.from(this.fileIndexCache.keys()).forEach((key) => {
      if (key.startsWith(targetKey)) {
        this.fileIndexCache.delete(key);
      }
    });
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
          await this.createFileEntity(data.fsPath, data.name);
          break;
        case 'createFolder':
          await this.createFolderEntity(data.fsPath, data.name);
          break;
        case 'moveFileEntity':
          await this.moveFileEntity(data.sourceFsPath, data.targetFolderFsPath, !!data.isFolder);
          break;
        case 'deleteFileEntity':
          await this.deleteFileEntity(data.fsPath, !!data.isFolder);
          break;
        case 'discardFileChanges':
          await this.discardFileChanges(data.fsPath, data.status);
          break;
        case 'compareWithOldCode':
          await this.compareWithOldCode(data.fsPath, data.projectName || '当前项目', data.status);
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
          this.handleSearchInFolder(data.fsPath, data.query, data.isRemote, !!data.focusOnly, data.requestId);
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

        case 'previewWithDoc':
        case 'previewWithDocToSide': {
          this.openDocPanel(
            data.fsPath,
            data.projectName || '未知项目',
            data.type === 'previewWithDocToSide' ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active
          );
          break;
        }

        case 'searchFileName':
          this.handleSearchFileName(data.fsPath, data.query, data.isRemote, !!data.focusOnly, data.requestId);
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


  private normalizeGitStatusKey(status?: string): string {
    const raw = String(status || '').trim();

    if (!raw) return '';

    const cleanStatus = raw
      .replace(/[\[\]]/g, '')
      .replace(/^\s*[·•-]?\s*/, '')
      .trim();

    const tokens = cleanStatus
      .split(/[\s,|/]+/)
      .map((item) => item.trim())
      .filter(Boolean);

    const matchedToken = tokens.find((item) => {
      const key = item[0]?.toUpperCase();

      return !!key && ['U', '?', 'M', 'A', 'D', 'R', 'C', 'I', '!', 'X', 'T'].includes(key);
    });

    if (matchedToken) {
      return matchedToken[0].toUpperCase();
    }

    const compactStatus = cleanStatus.replace(/\s+/g, '');
    const matchedKey = ['U', '?', 'M', 'A', 'D', 'R', 'C', 'I', '!', 'X', 'T'].find((key) => {
      return key === '?' ? compactStatus.includes('?') : compactStatus.toUpperCase().includes(key);
    });

    return matchedKey || cleanStatus[0]?.toUpperCase() || '';
  }

  private parseFileUri(fsPath: string): vscode.Uri {
    if (/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(fsPath)) {
      return vscode.Uri.parse(fsPath);
    }

    return vscode.Uri.file(fsPath);
  }

  private isLocalFilePath(fsPath: string): boolean {
    if (!fsPath) return false;

    return !fsPath.startsWith('vscode-vfs://') && !/^https?:\/\//i.test(fsPath);
  }

  private async statFileSafe(uri: vscode.Uri): Promise<vscode.FileStat | undefined> {
    try {
      return await vscode.workspace.fs.stat(uri);
    } catch {
      return undefined;
    }
  }

  private async getGitFileLocation(fsPath: string): Promise<{
    uri: vscode.Uri;
    nativePath: string;
    gitRoot: string;
    relativePath: string;
  } | null> {
    if (!this.isLocalFilePath(fsPath)) {
      return null;
    }

    const uri = this.parseFileUri(fsPath);
    const nativePath = uri.fsPath;

    if (!nativePath) {
      return null;
    }

    /**
     * 注意：Git root 不能直接用文件路径查。
     *
     * 之前这里把 /xxx/src/preload/index.d.ts 直接传给 getGitRoot，
     * 部分 Git 查询会把它当成 cwd，导致 checkIsRepo / rev-parse 失败，
     * 最终误判成“该文件不在本地 Git 仓库中”。
     *
     * VS Code 原生资源管理器也是按文件所属目录向上查找 Git 仓库，
     * 所以这里：
     * - 文件存在：用文件所在目录查 Git root；
     * - 文件已删除：stat 会失败，也用父目录查 Git root；
     * - 如果传入本身就是目录：用该目录查 Git root。
     */
    const stat = await this.statFileSafe(uri);
    const gitSearchPath =
      stat && (stat.type & vscode.FileType.Directory) !== 0
        ? nativePath
        : path.dirname(nativePath);

    const gitRoot = await this.getGitRoot(gitSearchPath).catch(() => '');

    if (!gitRoot) {
      return null;
    }

    const relativePath = path.relative(gitRoot, nativePath).replace(/\\/g, '/');

    if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      return null;
    }

    return {
      uri,
      nativePath,
      gitRoot,
      relativePath,
    };
  }

  private async readWorkingFileContent(fileUri: vscode.Uri): Promise<string> {
    try {
      const contentBytes = await vscode.workspace.fs.readFile(fileUri);

      return Buffer.from(contentBytes).toString('utf8');
    } catch {
      return '';
    }
  }

  private createGitVirtualUri(label: string, fileName: string, key: string): vscode.Uri {
    return vscode.Uri.from({
      scheme: 'quickops-git-virtual',
      path: `/${label}/${fileName}`,
      query: `key=${encodeURIComponent(key)}`,
    });
  }

  private async compareWithOldCode(fsPath: string, _projectName: string, status?: string): Promise<void> {
    const location = await this.getGitFileLocation(fsPath);

    if (!location) {
      vscode.window.showWarningMessage('该文件不在本地 Git 仓库中，无法与旧代码对比。');
      return;
    }

    const statusKey = this.normalizeGitStatusKey(status);
    const isNewFile = statusKey === 'U' || statusKey === '?' || statusKey === 'A';
    const isDeletedFile = statusKey === 'D';

    const oldContent = isNewFile
      ? ''
      : await this.gitService.getFileContent(location.gitRoot, 'HEAD', location.relativePath);

    const timestamp = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const fileName = path.basename(location.nativePath);
    const oldKey = `old_${timestamp}`;

    this.gitVirtualContentProvider.setContent(oldKey, oldContent);

    const oldUri = this.createGitVirtualUri('旧代码', fileName, oldKey);
    this.trackGitDiffUri(oldUri, location.nativePath);

    let workingUri: vscode.Uri;

    /**
     * 右侧必须使用真实文件 URI，不能使用虚拟快照。
     *
     * 这样 VS Code diff 的右侧就是当前工作区文件，用户可以直接编辑保存；
     * 左侧仍然是 HEAD/空内容快照，只读，用来代表“旧代码”。
     *
     * 删除状态的文件在工作区已经不存在，右侧只能显示空快照。
     */
    if (isDeletedFile) {
      const emptyKey = `working_empty_${timestamp}`;
      this.gitVirtualContentProvider.setContent(emptyKey, '');
      workingUri = this.createGitVirtualUri('当前代码', fileName, emptyKey);
    } else {
      workingUri = location.uri;
    }

    this.trackGitDiffUri(workingUri, location.nativePath);

    const title = `${fileName} · 旧代码 ↔ 当前代码`;

    await vscode.commands.executeCommand('vscode.diff', oldUri, workingUri, title, {
      preview: true,
      viewColumn: vscode.ViewColumn.Active,
    });
  }

  private async discardFileChanges(fsPath: string, status?: string): Promise<void> {
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
      {
        modal: true,
      },
      confirmText
    );

    if (picked !== confirmText) {
      return;
    }

    try {
      /**
       * 这里只关闭 quick-ops 打开的 diff tab，不关闭真实文件 tab。
       *
       * 之前这里还调用了 closeExistingPreviews(location.nativePath)，
       * 该方法会把和当前文件 URI 相同的普通文本 tab 一起关掉。
       * 取消变更时用户只希望关闭“旧代码 ↔ 当前代码”的对比页，
       * 不应该把用户正在看的普通 .npmrc / .ts 文件页也关闭。
       */
      await this.closeExistingGitDiffTabs(location.nativePath);
      await this.gitService.discardRecentProjectFile(location.gitRoot, location.relativePath, statusKey || status || 'M');

      this.invalidateDirCache(location.gitRoot);
      this.invalidateDirCache(path.dirname(location.nativePath));
      this.requestVisibleMetadataSync();
      this.refresh(true);

      vscode.window.showInformationMessage(`已取消变更: ${fileName}`);
    } catch (error: any) {
      vscode.window.showErrorMessage(`取消变更失败: ${error?.message || String(error)}`);
    }
  }

  private async handleOpenWith(fsPath: string, projectName: string) {
    try {
      const uri = fsPath.includes('://') ? vscode.Uri.parse(fsPath) : vscode.Uri.file(fsPath);
      const ext = path.extname(uri.fsPath || fsPath).toLowerCase();
      const isSvg = ext === '.svg' || ext === '.svga';
      const isDoc = ext === '.docx' || ext === '.doc';

      const textOption: vscode.QuickPickItem = {
        label: '$(code) 文本编辑器',
        description: '以纯文本代码形式打开'
      };
      const previewOption: vscode.QuickPickItem = {
        label: '$(preview) 解析编辑器',
        description: isDoc ? '预览 Word 文档' : '渲染并预览页面 / 图像'
      };

      const items = isSvg || isDoc ? [previewOption, textOption] : [textOption, previewOption];

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
        if (isDoc) {
          await this.openDocPanel(fsPath, projectName, vscode.ViewColumn.Active);
          return;
        }

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

  private async openDocPanel(fsPath: string, projectName: string, viewColumn: vscode.ViewColumn) {
    try {
      const uri = fsPath.includes('://') ? vscode.Uri.parse(fsPath) : vscode.Uri.file(fsPath);
      const fileName = path.basename(uri.path);
      const ext = path.extname(uri.fsPath || uri.path || fsPath).toLowerCase();

      await this.closeExistingPreviews(uri.fsPath);

      const panel = vscode.window.createWebviewPanel(
        'docPreviewReact',
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
          try {
            if (ext === '.doc') {
              panel.webview.postMessage({
                type: 'initDocError',
                message: '当前预览器暂不支持旧版 .doc 格式，请转换为 .docx 后再预览。'
              });
              return;
            }

            const contentBytes = await vscode.workspace.fs.readFile(uri);
            const fileBase64 = Buffer.from(contentBytes).toString('base64');

            panel.webview.postMessage({
              type: 'initDocData',
              fsPath,
              fileName,
              extension: ext,
              contentBase64: fileBase64,
            });
          } catch (e: any) {
            panel.webview.postMessage({
              type: 'initDocError',
              message: e?.message || 'Word 文件读取失败',
            });
          }
        }
      });

      panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'icons', 'word.svg');
      panel.webview.html = getReactWebviewHtml(this.context.extensionUri, panel.webview, `/doc?type=read`);
    } catch (e) {
      vscode.window.showErrorMessage('无法读取文件进行 Word 预览。');
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

  private normalizePathForCompare(value: string): string {
    if (!value) return '';

    try {
      if (value.includes('://')) {
        const uri = vscode.Uri.parse(value);

        if (uri.scheme === 'file') {
          return uri.fsPath.replace(/\\/g, '/').replace(/\/+$/, '');
        }

        return decodeURIComponent(uri.path || value).replace(/\\/g, '/').replace(/\/+$/, '');
      }
    } catch { }

    return value.replace(/^file:\/\//, '').replace(/\\/g, '/').replace(/\/+$/, '');
  }

  private toLocalUri(value: string): vscode.Uri | undefined {
    if (!value) return undefined;

    try {
      if (value.includes('://')) {
        const uri = vscode.Uri.parse(value);
        return uri.scheme === 'file' ? uri : undefined;
      }

      return vscode.Uri.file(value);
    } catch {
      return undefined;
    }
  }

  private getDiagnosticsSummary(targetPath: string, isFolder: boolean): DiagnosticSummary {
    const targetUri = this.toLocalUri(targetPath);

    if (!targetUri) {
      return { errors: 0, warnings: 0 };
    }

    const target = this.normalizePathForCompare(targetUri.toString());
    const targetPrefix = target.endsWith('/') ? target : `${target}/`;
    let errors = 0;
    let warnings = 0;

    for (const [uri, diagnostics] of vscode.languages.getDiagnostics()) {
      if (uri.scheme !== 'file') continue;

      const diagnosticPath = this.normalizePathForCompare(uri.toString());
      const matched = isFolder ? diagnosticPath === target || diagnosticPath.startsWith(targetPrefix) : diagnosticPath === target;

      if (!matched) continue;

      diagnostics.forEach((diagnostic) => {
        if (diagnostic.severity === vscode.DiagnosticSeverity.Error) {
          errors++;
        } else if (diagnostic.severity === vscode.DiagnosticSeverity.Warning) {
          warnings++;
        }
      });
    }

    return { errors, warnings };
  }

  private getAggregatedGitStatus(
    relativePath: string,
    isFolder: boolean,
    statusMap: Map<string, string>,
    fallback?: string
  ): string | undefined {
    const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');

    if (!normalized && !isFolder) {
      return fallback;
    }

    const directStatus = normalized ? statusMap.get(normalized) || statusMap.get(`${normalized}/`) || fallback : fallback;

    if (!isFolder) {
      return directStatus;
    }

    const prefix = normalized ? `${normalized}/` : '';
    const priority = ['UU', 'AA', 'DD', 'UD', 'DU', 'U', '?', 'A', 'D', 'R', 'C', 'M'];
    const foundStatuses = new Set<string>();

    if (directStatus) {
      foundStatuses.add(directStatus);
    }

    statusMap.forEach((status, filePath) => {
      const key = filePath.replace(/\\/g, '/').replace(/^\/+/, '');

      if (!normalized || key === normalized || key.startsWith(prefix)) {
        foundStatuses.add(status);
      }
    });

    for (const item of priority) {
      if (foundStatuses.has(item)) {
        return item;
      }
    }

    return foundStatuses.values().next().value || directStatus;
  }

  private async createMetadataContext(rootPath: string) {
    const uri = this.toLocalUri(rootPath);

    if (!uri) {
      return {
        gitRoot: '',
        statusMap: new Map<string, string>(),
      };
    }

    const nativePath = uri.fsPath;
    const gitRoot = await this.getGitRoot(nativePath).catch(() => '');
    const statusMap = gitRoot ? await this.getGitStatusMap(nativePath).catch(() => new Map<string, string>()) : new Map<string, string>();

    return {
      gitRoot,
      statusMap,
    };
  }

  private async enrichFileItem<T extends { path?: string; fullPath?: string; fsPath?: string; isFolder?: boolean; status?: string; diagnostics?: DiagnosticSummary }>(
    item: T,
    context: { gitRoot: string; statusMap: Map<string, string> }
  ): Promise<T> {
    const targetPath = item.path || item.fullPath || item.fsPath || '';
    const uri = this.toLocalUri(targetPath);

    if (!uri) {
      return item;
    }

    const nativePath = uri.fsPath;
    const isFolder = !!item.isFolder;
    const gitRelativePath = context.gitRoot ? path.relative(context.gitRoot, nativePath).replace(/\\/g, '/') : '';
    const status = context.gitRoot
      ? this.getAggregatedGitStatus(gitRelativePath, isFolder, context.statusMap, item.status)
      : item.status;

    return {
      ...item,
      status,
      diagnostics: this.getDiagnosticsSummary(uri.toString(), isFolder),
    };
  }

  private async enrichChildren(children: any[], rootPath: string): Promise<any[]> {
    const context = await this.createMetadataContext(rootPath);

    return Promise.all(children.map((child) => this.enrichFileItem(child, context)));
  }

  private async enrichProject(project: RecentProject): Promise<RecentProject> {
    const context = await this.createMetadataContext(project.fsPath);
    const uri = this.toLocalUri(project.fsPath);

    if (!uri) return project;

    return {
      ...project,
      status: context.gitRoot ? this.getAggregatedGitStatus('', true, context.statusMap, project.status) : project.status,
      diagnostics: this.getDiagnosticsSummary(uri.toString(), true),
    };
  }

  private scheduleStatusSync(delay = 160): void {
    if (this.statusSyncTimer) {
      clearTimeout(this.statusSyncTimer);
    }

    this.statusSyncTimer = setTimeout(() => {
      this.statusSyncTimer = undefined;
      void this.syncVisibleMetadata();
    }, delay);
  }

  public requestVisibleMetadataSync(): void {
    this.scheduleStatusSync(80);
  }

  public async syncVisibleMetadata(): Promise<void> {
    if (!this._view) return;

    const patch: MetadataPatchItem[] = [];
    const pushPatch = (item: any) => {
      const itemPath = item?.path || item?.fullPath || item?.fsPath;

      if (!itemPath) return;

      patch.push({
        path: itemPath,
        status: item.status,
        diagnostics: item.diagnostics || { errors: 0, warnings: 0 },
      });
    };

    const enrichedProjects = await Promise.all([
      ...this.getRecentProjects(),
      ...(vscode.workspace.workspaceFolders?.map((folder) => ({
        name: folder.name,
        fsPath: folder.uri.toString(),
        timestamp: Date.now(),
      } as RecentProject)) || []),
    ].map((project) => this.enrichProject(project)));

    enrichedProjects.forEach(pushPatch);

    for (const [dirPath, children] of this.loadedDirChildren.entries()) {
      const enrichedChildren = await this.enrichChildren(children, dirPath);
      this.loadedDirChildren.set(dirPath, enrichedChildren);
      enrichedChildren.forEach(pushPatch);
    }

    this._view.webview.postMessage({
      type: 'metadataPatch',
      items: patch,
    });
  }

  private async handleSearchFileName(
    fsPath: string,
    query: string,
    isRemote: boolean,
    focusOnly: boolean = false,
    requestId?: number
  ) {
    if (isRemote) {
      this._view?.webview.postMessage({
        type: 'searchFileNameResult',
        requestId,
        results: [],
        error: '远程仓库暂不支持名称检索。',
      });
      return;
    }

    const searchValue = query.trim();

    if (!searchValue) {
      this._view?.webview.postMessage({
        type: 'searchFileNameResult',
        requestId,
        results: [],
      });
      return;
    }

    const runId = this.getSearchRunId();

    try {
      const rootUri = this.toResourceUri(fsPath);

      await vscode.workspace.fs.stat(rootUri);

      const rootNativePath = this.normalizeNativePath(fsPath);
      const indexedItems = await this.getFileIndex(fsPath);

      if (this.isSearchCancelled(runId)) {
        return;
      }

      const normalizedQuery = this.normalizeSearchText(searchValue);
      const compactQuery = this.compactSearchText(searchValue);
      const queryParts = normalizedQuery
        .split(/[\s/]+/)
        .map((item) => item.trim())
        .filter(Boolean);

      /**
       * 普通搜索 index 时，只匹配文件名 / 文件夹名。
       * 用户输入 src/index 或 src index 这种带路径特征的内容时，才允许 relativePath 参与匹配。
       */
      const allowPathLevelMatch = normalizedQuery.includes('/') || queryParts.length > 1;

      const shouldIncludeHiddenEntries =
        normalizedQuery.startsWith('.') ||
        normalizedQuery.includes('/.') ||
        queryParts.some((part) => part.startsWith('.'));

      const shouldSkipHiddenSearchEntry = (relativePath: string) => {
        if (shouldIncludeHiddenEntries) {
          return false;
        }

        return this.normalizeSearchText(relativePath)
          .split('/')
          .some((segment) => segment.startsWith('.') && segment !== '.' && segment !== '..');
      };

      const getSearchScore = (item: IndexedFileItem): number | null => {
        const normalizedName = this.normalizeSearchText(item.name);
        const normalizedPath = this.normalizeSearchText(item.relativePath);
        const compactName = this.compactSearchText(item.name);
        const compactPath = this.compactSearchText(item.relativePath);

        let score: number | null = null;

        const updateScore = (nextScore: number | null) => {
          if (nextScore === null || Number.isNaN(nextScore)) {
            return;
          }

          score = score === null ? nextScore : Math.min(score, nextScore);
        };

        if (normalizedName === normalizedQuery) {
          updateScore(0);
        }

        if (normalizedName.startsWith(normalizedQuery)) {
          updateScore(10);
        }

        const nameIndex = normalizedName.indexOf(normalizedQuery);

        if (nameIndex !== -1) {
          updateScore(20 + nameIndex);
        }

        if (compactQuery) {
          const compactNameIndex = compactName.indexOf(compactQuery);

          if (compactNameIndex !== -1) {
            updateScore(30 + compactNameIndex);
          }
        }

        if (allowPathLevelMatch) {
          if (normalizedPath === normalizedQuery) {
            updateScore(40);
          }

          const pathIndex = normalizedPath.indexOf(normalizedQuery);

          if (pathIndex !== -1) {
            updateScore(60 + pathIndex);
          }

          if (compactQuery) {
            const compactPathIndex = compactPath.indexOf(compactQuery);

            if (compactPathIndex !== -1) {
              updateScore(70 + compactPathIndex);
            }
          }

          const orderedMatched = queryParts.every((part) => {
            return normalizedPath.includes(part) || compactPath.includes(this.compactSearchText(part));
          });

          if (orderedMatched) {
            updateScore(90);
          }
        }

        return score;
      };

      let gitRoot = '';
      let statusMap = new Map<string, string>();

      if (focusOnly) {
        gitRoot = await this.getGitRoot(rootNativePath);
        statusMap = gitRoot ? await this.getGitStatusMap(rootNativePath) : new Map<string, string>();
      }

      const indexedItemByRelativePath = new Map<string, IndexedFileItem>();

      indexedItems.forEach((item) => {
        indexedItemByRelativePath.set(item.relativePath, item);
      });

      type ScoredSearchResult = {
        item: any;
        source: IndexedFileItem;
        score: number;
        depth: number;
        order: number;
        groupKey: string;
      };

      const rawScoredResults = indexedItems
        .filter((item) => !shouldSkipHiddenSearchEntry(item.relativePath))
        .map((item, order) => {
          if (focusOnly) {
            const gitRelativePath = gitRoot ? path.relative(gitRoot, item.fullPath) : '';
            const status = gitRoot ? this.getChildGitStatus(gitRelativePath, item.isFolder, statusMap) : undefined;

            if (!status) {
              return undefined;
            }
          }

          const score = getSearchScore(item);

          if (score === null) {
            return undefined;
          }

          return {
            item: {
              path: item.uriString,
              name: item.name,
              relativePath: item.relativePath,
              isFolder: item.isFolder,
              status: undefined,
              diagnostics: {
                errors: 0,
                warnings: 0,
              },
            },
            source: item,
            score,
            depth: item.relativePath.split('/').length,
            order,
            groupKey: '',
          };
        })
        .filter(Boolean) as ScoredSearchResult[];

      if (this.isSearchCancelled(runId)) {
        return;
      }

      const matchedFolderPathSet = new Set(
        rawScoredResults
          .filter((item) => item.source.isFolder)
          .map((item) => item.source.relativePath)
      );

      const getFirstPathSegment = (relativePath: string) => {
        return relativePath.split('/').filter(Boolean)[0] || relativePath;
      };

      const isRelativePathInside = (childPath: string, parentPath: string) => {
        if (!childPath || !parentPath) return false;

        const child = childPath.replace(/\\/g, '/').replace(/\/+$/, '');
        const parent = parentPath.replace(/\\/g, '/').replace(/\/+$/, '');
        const parentWithSlash = parent.endsWith('/') ? parent : `${parent}/`;

        return child === parent || child.startsWith(parentWithSlash);
      };

      const getMatchedFolderGroupKey = (item: IndexedFileItem) => {
        const segments = item.relativePath.split('/').filter(Boolean);
        let currentPath = '';

        for (const segment of segments) {
          currentPath = currentPath ? `${currentPath}/${segment}` : segment;

          const currentItem = indexedItemByRelativePath.get(currentPath);

          if (currentItem?.isFolder && matchedFolderPathSet.has(currentPath)) {
            return currentPath;
          }
        }

        return getFirstPathSegment(item.relativePath);
      };

      const scoredResults = rawScoredResults.map((item) => ({
        ...item,
        groupKey: getMatchedFolderGroupKey(item.source),
      }));

      const compareGroupKey = (a: ScoredSearchResult, b: ScoredSearchResult) => {
        if (a.groupKey === b.groupKey) {
          return 0;
        }

        const aRoot = getFirstPathSegment(a.groupKey);
        const bRoot = getFirstPathSegment(b.groupKey);

        if (aRoot !== bRoot) {
          const aRootItem = indexedItemByRelativePath.get(aRoot);
          const bRootItem = indexedItemByRelativePath.get(bRoot);

          if (!!aRootItem?.isFolder !== !!bRootItem?.isFolder) {
            return aRootItem?.isFolder ? -1 : 1;
          }

          return aRoot.localeCompare(bRoot);
        }

        if (isRelativePathInside(a.groupKey, b.groupKey)) {
          return -1;
        }

        if (isRelativePathInside(b.groupKey, a.groupKey)) {
          return 1;
        }

        return a.groupKey.localeCompare(b.groupKey);
      };

      const results = scoredResults
        .sort((a, b) => {
          const groupCompare = compareGroupKey(a, b);

          if (groupCompare !== 0) {
            return groupCompare;
          }

          const aIsGroupRoot = a.source.relativePath === a.groupKey;
          const bIsGroupRoot = b.source.relativePath === b.groupKey;

          if (aIsGroupRoot !== bIsGroupRoot) {
            return aIsGroupRoot ? -1 : 1;
          }

          if (a.score !== b.score) {
            return a.score - b.score;
          }

          if (a.depth !== b.depth) {
            return a.depth - b.depth;
          }

          if (a.source.isFolder !== b.source.isFolder) {
            return a.source.isFolder ? -1 : 1;
          }

          return a.order - b.order;
        })
        .slice(0, 200)
        .map((item) => item.item);

      this._view?.webview.postMessage({
        type: 'searchFileNameResult',
        requestId,
        results,
      });

      void this.enrichAndPatchChildren(results, fsPath);
    } catch (error: any) {
      if (this.isSearchCancelled(runId)) {
        return;
      }

      this._view?.webview.postMessage({
        type: 'searchFileNameResult',
        requestId,
        results: [],
        error: error?.message || '文件名检索失败。',
      });
    }
  }

  private async handleSearchInFolder(
    fsPath: string,
    query: string,
    isRemote: boolean,
    focusOnly: boolean = false,
    requestId?: number
  ) {
    if (isRemote) {
      this._view?.webview.postMessage({
        type: 'searchFolderResult',
        requestId,
        results: [],
        error: '由于网络限制，远程仓库暂不支持全文代码检索，请在本地打开该项目后再尝试。',
      });
      return;
    }

    const searchValue = query.trim();

    if (!searchValue) {
      this._view?.webview.postMessage({
        type: 'searchFolderResult',
        requestId,
        results: [],
      });
      return;
    }

    const runId = this.getSearchRunId();

    const binaryExts = new Set([
      '.png',
      '.jpg',
      '.jpeg',
      '.gif',
      '.ico',
      '.svg',
      '.webp',
      '.bmp',
      '.tif',
      '.tiff',
      '.woff',
      '.woff2',
      '.ttf',
      '.eot',
      '.otf',
      '.mp4',
      '.mp3',
      '.wav',
      '.ogg',
      '.webm',
      '.mov',
      '.avi',
      '.pdf',
      '.zip',
      '.tar',
      '.gz',
      '.7z',
      '.rar',
      '.doc',
      '.docx',
      '.xls',
      '.xlsx',
      '.ppt',
      '.pptx',
      '.exe',
      '.dll',
      '.so',
      '.dylib',
      '.class',
      '.jar',
      '.bin',
      '.pyc',
      '.o',
    ]);

    const maxMatches = 200;
    const maxFileSize = 2 * 1024 * 1024;
    const lowerQuery = searchValue.toLowerCase();

    try {
      const rootUri = this.toResourceUri(fsPath);

      await vscode.workspace.fs.stat(rootUri);

      const rootNativePath = this.normalizeNativePath(fsPath);
      const indexedItems = await this.getFileIndex(fsPath);

      if (this.isSearchCancelled(runId)) {
        return;
      }

      let gitRoot = '';
      let statusMap = new Map<string, string>();

      if (focusOnly) {
        gitRoot = await this.getGitRoot(rootNativePath);
        statusMap = gitRoot ? await this.getGitStatusMap(rootNativePath) : new Map<string, string>();
      }

      const candidateFiles = indexedItems.filter((item) => {
        if (item.isFolder) {
          return false;
        }

        if (binaryExts.has(item.ext)) {
          return false;
        }

        if (!focusOnly) {
          return true;
        }

        const gitRelativePath = gitRoot ? path.relative(gitRoot, item.fullPath) : '';
        const status = gitRoot ? this.getChildGitStatus(gitRelativePath, false, statusMap) : undefined;

        return !!status;
      });

      const results: any[] = [];
      let matchCount = 0;

      await this.runWithConcurrency(candidateFiles, 16, async (item) => {
        if (this.isSearchCancelled(runId) || matchCount >= maxMatches) {
          return;
        }

        let stat: vscode.FileStat;

        try {
          stat = await vscode.workspace.fs.stat(item.uri);
        } catch {
          return;
        }

        if (stat.size > maxFileSize) {
          return;
        }

        let content = '';

        try {
          const contentBytes = await vscode.workspace.fs.readFile(item.uri);

          content = this.decodeFileContent(contentBytes);
        } catch {
          return;
        }

        if (this.isSearchCancelled(runId) || matchCount >= maxMatches) {
          return;
        }

        const lowerContent = content.toLowerCase();

        if (!lowerContent.includes(lowerQuery)) {
          return;
        }

        const lines = content.split(/\r?\n/);
        const fileMatches: Array<{ line: number; text: string }> = [];

        for (let i = 0; i < lines.length; i++) {
          if (matchCount >= maxMatches) {
            break;
          }

          const line = lines[i];

          if (line.toLowerCase().includes(lowerQuery)) {
            fileMatches.push({
              line: i + 1,
              text: line.trim().substring(0, 300),
            });

            matchCount += 1;
          }
        }

        if (fileMatches.length === 0) {
          return;
        }

        results.push({
          file: item.relativePath,
          fullPath: item.fullPath,
          path: item.uriString,
          matches: fileMatches,
          status: undefined,
          diagnostics: {
            errors: 0,
            warnings: 0,
          },
        });
      });

      if (this.isSearchCancelled(runId)) {
        return;
      }

      const sortedResults = results
        .sort((a, b) => String(a.file || '').localeCompare(String(b.file || '')))
        .slice(0, maxMatches);

      this._view?.webview.postMessage({
        type: 'searchFolderResult',
        requestId,
        results: sortedResults,
      });

      void this.enrichAndPatchChildren(
        sortedResults.map((item) => ({
          ...item,
          isFolder: false,
          name: path.basename(item.fullPath),
        })),
        fsPath
      );
    } catch (error: any) {
      if (this.isSearchCancelled(runId)) {
        return;
      }

      this._view?.webview.postMessage({
        type: 'searchFolderResult',
        requestId,
        results: [],
        error: error?.message || '全文检索失败。',
      });
    }
  }

  private parseLocalFileUri(fsPath: string): vscode.Uri | undefined {
    if (!fsPath) return undefined;

    try {
      if (fsPath.includes('://')) {
        const uri = vscode.Uri.parse(fsPath);
        return uri.scheme === 'file' ? uri : undefined;
      }

      return vscode.Uri.file(fsPath);
    } catch {
      return undefined;
    }
  }

  private getCurrentWorkspaceUri(): vscode.Uri | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri;
  }

  private isCurrentWorkspaceFileUri(uri: vscode.Uri): boolean {
    const currentWorkspaceUri = this.getCurrentWorkspaceUri();

    if (!currentWorkspaceUri || uri.scheme !== 'file') {
      return false;
    }

    return this.isInsidePath(uri.toString(), currentWorkspaceUri.toString());
  }

  private async getWritableLocalFolderUri(fsPath: string) {
    const uri = this.parseLocalFileUri(fsPath);

    if (!uri) {
      vscode.window.showWarningMessage('当前只支持在本地文件夹中新建文件或文件夹。');
      return null;
    }

    if (!this.isCurrentWorkspaceFileUri(uri)) {
      vscode.window.showWarningMessage('只能在当前运行项目中新建文件或文件夹。');
      return null;
    }

    try {
      const stat = await vscode.workspace.fs.stat(uri);

      if ((stat.type & vscode.FileType.Directory) !== 0) {
        return uri;
      }

      return vscode.Uri.joinPath(uri, '..');
    } catch {
      vscode.window.showWarningMessage('目标文件夹不存在，无法新建文件或文件夹。');
      return null;
    }
  }

  private validateNewEntityName(name: string, entityType: 'file' | 'folder') {
    const value = name.trim().replace(/\\/g, '/');

    if (!value) {
      return [] as string[];
    }

    if (value.startsWith('/') || value.endsWith('/')) {
      vscode.window.showWarningMessage('名称不能以 / 开头或结尾。');
      return [] as string[];
    }

    const parts = value.split('/').map((item) => item.trim());

    if (parts.some((item) => !item || item === '.' || item === '..')) {
      vscode.window.showWarningMessage('名称中不能包含空路径、. 或 ..。');
      return [] as string[];
    }

    const invalidPart = parts.find((item) => /[<>:"|?*]/.test(item));

    if (invalidPart) {
      vscode.window.showWarningMessage(`名称包含非法字符: ${invalidPart}`);
      return [] as string[];
    }

    if (entityType === 'file' && parts[parts.length - 1].endsWith('.')) {
      vscode.window.showWarningMessage('文件名不能以 . 结尾。');
      return [] as string[];
    }

    return parts;
  }

  private async createFileEntity(parentFsPath: string, name?: string) {
    try {
      const parentUri = await this.getWritableLocalFolderUri(parentFsPath);
      if (!parentUri) return;

      const input = typeof name === 'string'
        ? name
        : await vscode.window.showInputBox({
          title: '新建文件',
          prompt: '请输入新文件名',
          placeHolder: '例如：index.ts',
          ignoreFocusOut: true,
        });

      const filePathParts = this.validateNewEntityName(input || '', 'file');
      if (filePathParts.length === 0) return;

      const fileName = filePathParts[filePathParts.length - 1];
      const folderParts = filePathParts.slice(0, -1);
      const targetFolderUri = folderParts.length > 0 ? vscode.Uri.joinPath(parentUri, ...folderParts) : parentUri;
      const fileUri = vscode.Uri.joinPath(targetFolderUri, fileName);

      try {
        await vscode.workspace.fs.stat(fileUri);
        vscode.window.showWarningMessage(`文件已存在: ${filePathParts.join('/')}`);
        return;
      } catch {
        // 文件不存在时继续创建
      }

      if (folderParts.length > 0) {
        await vscode.workspace.fs.createDirectory(targetFolderUri);
      }

      await vscode.workspace.fs.writeFile(fileUri, new Uint8Array());

      this.invalidateDirCache(parentUri.toString());
      this.invalidateDirCache(targetFolderUri.toString());
      this.refresh(true);

      this._view?.webview.postMessage({
        type: 'createFileEntityResult',
        fsPath: fileUri.toString(),
        parentPath: targetFolderUri.toString(),
      });

      const doc = await vscode.workspace.openTextDocument(fileUri);
      await vscode.window.showTextDocument(doc, { preview: false });
      vscode.window.showInformationMessage(`已新建文件: ${filePathParts.join('/')}`);
    } catch (e) {
      vscode.window.showErrorMessage(`新建文件失败，详情: ${e}`);
    }
  }

  private async createFolderEntity(parentFsPath: string, name?: string) {
    try {
      const parentUri = await this.getWritableLocalFolderUri(parentFsPath);
      if (!parentUri) return;

      const input = typeof name === 'string'
        ? name
        : await vscode.window.showInputBox({
          title: '新建文件夹',
          prompt: '请输入新文件夹名',
          placeHolder: '例如：components',
          ignoreFocusOut: true,
        });

      const folderPathParts = this.validateNewEntityName(input || '', 'folder');
      if (folderPathParts.length === 0) return;

      const folderUri = vscode.Uri.joinPath(parentUri, ...folderPathParts);

      try {
        await vscode.workspace.fs.stat(folderUri);
        vscode.window.showWarningMessage(`文件夹已存在: ${folderPathParts.join('/')}`);
        return;
      } catch {
        // 文件夹不存在时继续创建
      }

      await vscode.workspace.fs.createDirectory(folderUri);

      this.invalidateDirCache(parentUri.toString());
      this.invalidateDirCache(folderUri.toString());
      this.refresh(true);

      this._view?.webview.postMessage({
        type: 'createFolderEntityResult',
        fsPath: folderUri.toString(),
        parentPath: parentUri.toString(),
      });

      vscode.window.showInformationMessage(`已新建文件夹: ${folderPathParts.join('/')}`);
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

  private async moveFileEntity(sourceFsPath: string, targetFolderFsPath: string, isFolder: boolean) {
    try {
      const sourceUri = this.parseLocalFileUri(sourceFsPath);
      const targetFolderUri = this.parseLocalFileUri(targetFolderFsPath);

      if (!sourceUri || !targetFolderUri) {
        vscode.window.showWarningMessage('当前只支持拖拽移动本地文件或文件夹。');
        return;
      }

      const currentWorkspaceUri = this.getCurrentWorkspaceUri();

      if (!currentWorkspaceUri) {
        vscode.window.showWarningMessage('没有检测到当前运行项目，无法移动文件或文件夹。');
        return;
      }

      if (!this.isInsidePath(sourceUri.toString(), currentWorkspaceUri.toString()) || !this.isInsidePath(targetFolderUri.toString(), currentWorkspaceUri.toString())) {
        vscode.window.showWarningMessage('只能在当前运行项目内部拖拽文件或文件夹。');
        return;
      }

      if (this.normalizeComparePath(sourceUri.toString()) === this.normalizeComparePath(currentWorkspaceUri.toString())) {
        vscode.window.showWarningMessage('不能移动当前运行项目根目录。');
        return;
      }

      const targetStat = await this.statFileSafe(targetFolderUri);

      if (!targetStat || (targetStat.type & vscode.FileType.Directory) === 0) {
        vscode.window.showWarningMessage('只能拖拽到文件夹中。');
        return;
      }

      if (isFolder && this.isInsidePath(targetFolderUri.toString(), sourceUri.toString())) {
        vscode.window.showWarningMessage('不能把文件夹移动到自身或自身的子文件夹中。');
        return;
      }

      const sourceName = path.basename(sourceUri.fsPath || sourceUri.path);
      const sourceParentUri = vscode.Uri.joinPath(sourceUri, '..');
      const targetUri = vscode.Uri.joinPath(targetFolderUri, sourceName);

      if (this.normalizeComparePath(sourceParentUri.toString()) === this.normalizeComparePath(targetFolderUri.toString())) {
        return;
      }

      try {
        await vscode.workspace.fs.stat(targetUri);
        vscode.window.showWarningMessage(`目标文件夹中已存在同名${isFolder ? '文件夹' : '文件'}: ${sourceName}`);
        return;
      } catch {
        // 目标不存在时继续移动
      }

      await vscode.workspace.fs.rename(sourceUri, targetUri, { overwrite: false });

      this.invalidateDirCache(sourceParentUri.toString());
      this.invalidateDirCache(targetFolderUri.toString());
      this.invalidateDirCache(sourceUri.toString());
      this.invalidateDirCache(targetUri.toString());
      this.refresh(true);

      this._view?.webview.postMessage({
        type: 'moveFileEntityResult',
        sourcePath: sourceUri.toString(),
        targetPath: targetUri.toString(),
        oldParentPath: sourceParentUri.toString(),
        targetParentPath: targetFolderUri.toString(),
        isFolder,
      });

      vscode.window.showInformationMessage(`已移动${isFolder ? '文件夹' : '文件'}: ${sourceName}`);
    } catch (e: any) {
      vscode.window.showErrorMessage(`移动失败，详情: ${e?.message || String(e)}`);
    }
  }

  private async deleteFileEntity(fsPath: string, isFolder: boolean) {
    try {
      const uri = fsPath.includes('://') ? vscode.Uri.parse(fsPath) : vscode.Uri.file(fsPath);

      if (uri.scheme !== 'file') {
        vscode.window.showWarningMessage('当前只支持删除本地文件或文件夹。');
        return;
      }

      const currentWorkspaceUri = vscode.workspace.workspaceFolders?.[0]?.uri;

      if (!currentWorkspaceUri || !this.isInsidePath(uri.toString(), currentWorkspaceUri.toString())) {
        vscode.window.showWarningMessage('只能删除当前运行项目中的文件或文件夹。');
        return;
      }

      const entityName = path.basename(uri.fsPath || uri.path);
      const entityType = isFolder ? '文件夹' : '文件';

      const confirm = await vscode.window.showWarningMessage(
        `确定要删除${entityType} “${entityName}” 吗？${isFolder ? ' 文件夹内的所有内容也会被删除。' : ''}`,
        { modal: true },
        '确认删除'
      );

      if (confirm !== '确认删除') {
        return;
      }

      await vscode.workspace.fs.delete(uri, {
        recursive: isFolder,
        useTrash: true,
      });

      const parentUri = vscode.Uri.joinPath(uri, '..');

      this._view?.webview.postMessage({
        type: 'deleteFileEntityResult',
        fsPath: uri.toString(),
        parentPath: parentUri.toString(),
      });

      this.invalidateDirCache(parentUri.toString());
      this.invalidateDirCache(uri.toString());

      this.refresh(false);

      vscode.window.showInformationMessage(`已删除${entityType}: ${entityName}`);
    } catch (e) {
      vscode.window.showErrorMessage(`删除失败，详情: ${e}`);
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

  private getFileExt(fsPath: string) {
    try {
      const uri = fsPath.includes('://') ? vscode.Uri.parse(fsPath) : vscode.Uri.file(fsPath);
      return path.extname(uri.fsPath || uri.path || fsPath).toLowerCase();
    } catch {
      return path.extname(fsPath).toLowerCase();
    }
  }

  private isDocFile(fsPath: string) {
    const ext = this.getFileExt(fsPath);

    return ext === '.docx' || ext === '.doc';
  }

  private async openFileReadOnly(fsPath: string, projectName: string, viewColumn: vscode.ViewColumn = vscode.ViewColumn.Active, preview: boolean = true) {
    if (this.isDocFile(fsPath)) {
      await this.openDocPanel(fsPath, projectName, viewColumn);
      return;
    }

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
    this.knownVisibleDirs.add(fsPath);

    if (this.isRemoteFsPath(fsPath)) {
      await this.directoryService.readDirectory({
        fsPath,
        projectName,
        focusOnly,
        forceRefresh,
        postMessage: async (message) => {
          if (message?.type === 'readDirResult') {
            const pathKey = String(message.fsPath || fsPath);
            const children = Array.isArray(message.children) ? message.children : [];
            const enrichedChildren = await this.enrichChildren(children, pathKey);

            this.loadedDirChildren.set(pathKey, enrichedChildren);
            this.knownVisibleDirs.add(pathKey);

            enrichedChildren.forEach((child) => {
              if (child?.isFolder && child.path) {
                this.knownVisibleDirs.add(child.path);
              }
            });

            this._view?.webview.postMessage({
              ...message,
              children: enrichedChildren,
            });

            this.scheduleStatusSync(120);
            return;
          }

          this._view?.webview.postMessage(message);
        },
      });

      return;
    }

    try {
      const children = await this.readLocalDirectoryChildrenFast(fsPath, forceRefresh);

      this.loadedDirChildren.set(fsPath, children);
      this.knownVisibleDirs.add(fsPath);

      children.forEach((child) => {
        if (child?.isFolder && child.path) {
          this.knownVisibleDirs.add(child.path);
        }
      });

      this._view?.webview.postMessage({
        type: 'readDirResult',
        fsPath,
        projectName,
        focusOnly,
        children,
      });

      void this.enrichAndPatchChildren(children, fsPath);
    } catch {
      this._view?.webview.postMessage({
        type: 'readDirResult',
        fsPath,
        projectName,
        focusOnly,
        children: [],
      });
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

    this.scheduleStatusSync(120);
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