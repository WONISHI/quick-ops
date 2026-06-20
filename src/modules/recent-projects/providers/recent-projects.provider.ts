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
      await this.handleMessage(message);
    });

    setTimeout(() => {
      this.refresh(true);
      this.revealCurrentActive();
    }, 100);
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
    this.postMessage({
      type: 'recentProjects',
      projects: this.getRecentProjects(),
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

  private async handleMessage(message: RecentProjectsWebviewMessage): Promise<void> {
    switch (message.type) {
      case 'ready':
      case 'webviewLoaded':
      case 'refresh':
        this.refresh(message.refreshExpandedTree ?? true);
        break;

      case 'addLocalProject':
        await this.addLocalProject();
        break;

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
        if (message.fsPath) {
          await this.openProject(message.fsPath);
        }
        break;

      case 'readDir':
        if (message.fsPath) {
          await this.handleReadDir(message.fsPath, message.requestId);
        }
        break;

      case 'openFile':
        if (message.fsPath) {
          await this.openFile(message.fsPath);
        }
        break;

      case 'createFile':
        if (message.fsPath && message.name) {
          await this.createFile(message.fsPath, message.name);
        }
        break;

      case 'createFolder':
        if (message.fsPath && message.name) {
          await this.createFolder(message.fsPath, message.name);
        }
        break;

      case 'deletePath':
        if (message.fsPath) {
          await this.deletePath(message.fsPath);
        }
        break;

      case 'renamePath':
        if (message.oldPath && message.newPath) {
          await this.renamePath(message.oldPath, message.newPath);
        }
        break;

      case 'copyFileName':
        if (message.name) {
          await vscode.env.clipboard.writeText(message.name);
        }
        break;

      case 'openInExplorer':
        if (message.fsPath) {
          await this.openInExplorer(message.fsPath);
        }
        break;

      case 'selectForCompare':
        if (message.fsPath) {
          this.selectForCompare(message.fsPath);
        }
        break;

      case 'compareWithSelected':
        if (message.fsPath) {
          await this.compareWithSelected(message.fsPath);
        }
        break;

      case 'searchFileName':
        if (message.fsPath) {
          await this.handleSearchFileName(
            message.fsPath,
            message.query || '',
            Boolean(message.focusOnly),
            message.requestId,
          );
        }
        break;

      case 'searchFolder':
        if (message.fsPath) {
          await this.handleSearchInFolder(
            message.fsPath,
            message.query || '',
            Boolean(message.focusOnly),
            message.requestId,
          );
        }
        break;

      case 'focusRoot':
        if (message.fsPath) {
          this.focusRootPath = message.fsPath;
          this.refresh(true);
        }
        break;

      case 'exitFocusRoot':
        this.focusRootPath = '';
        this.refresh(true);
        break;
    }
  }

  private async addInputProject(inputValue: string): Promise<void> {
    const isRemote =
      /^(https?:\/\/|git@|vscode-vfs:\/\/)/i.test(inputValue) ||
      /^([^/]+\/[^/]+)$/.test(inputValue);

    if (isRemote) {
      const parsed = this.parseRemoteUrlInput(inputValue);

      if (!parsed) {
        vscode.window.showErrorMessage('❌ 无效的远程地址格式，请检查。');
        return;
      }

      const existed = this.getRecentProjects().some(project => {
        return project.fsPath === parsed.targetUriStr;
      });

      if (existed) {
        vscode.window.showWarningMessage('⚠️ 该远程项目已存在于列表中！');
        return;
      }

      const projectName = await vscode.window.showInputBox({
        prompt: '确认远程项目名称',
        value: parsed.repoFullName.split('/').pop() || parsed.repoFullName,
      });

      if (!projectName) return;

      await this.insertProjectToHistory(
        projectName,
        parsed.targetUriStr,
        parsed.platform,
        parsed.customDomain,
      );

      vscode.window.showInformationMessage(`✅ 已添加远程项目: ${projectName}`);

      return;
    }

    try {
      const localUri = vscode.Uri.file(inputValue);
      const stat = await vscode.workspace.fs.stat(localUri);

      if ((stat.type & vscode.FileType.Directory) === 0) {
        vscode.window.showErrorMessage('❌ 输入的路径是一个文件，请提供文件夹路径。');
        return;
      }

      const uriStr = localUri.toString();
      const existed = this.getRecentProjects().some(project => {
        return project.fsPath === uriStr;
      });

      if (existed) {
        vscode.window.showWarningMessage('⚠️ 该本地项目已存在于列表中！');
        return;
      }

      const folderName = path.basename(inputValue) || '本地项目';

      await this.insertProjectToHistory(folderName, uriStr, 'local');

      vscode.window.showInformationMessage(`✅ 已添加本地项目: ${folderName}`);
    } catch {
      vscode.window.showErrorMessage('❌ 找不到该本地路径，请检查拼写是否正确。');
    }
  }

  private async openProject(fsPath: string): Promise<void> {
    const uri = this.toUri(fsPath);

    if (!uri) return;

    await vscode.commands.executeCommand('vscode.openFolder', uri, false);
  }

  private async openFile(fsPath: string): Promise<void> {
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
      });

      this.setActivePath(uri.toString());
    } catch {
      vscode.window.showErrorMessage('文件打开失败');
    }
  }

  private async handleReadDir(
    fsPath: string,
    requestId?: number,
  ): Promise<void> {
    const uri = this.toUri(fsPath);

    if (!uri) return;

    try {
      const children = await this.readDirectoryChildren(uri);

      this.postMessage({
        type: 'readDirResult',
        requestId,
        fsPath,
        children,
      });
    } catch (error) {
      this.postMessage({
        type: 'readDirResult',
        requestId,
        fsPath,
        children: [],
        error: this.toErrorMessage(error),
      });
    }
  }

  private async readDirectoryChildren(
    uri: vscode.Uri,
  ): Promise<RecentProjectFileItem[]> {
    const entries = await vscode.workspace.fs.readDirectory(uri);

    const children = entries
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

    return children;
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

  private async createFolder(parentPath: string, folderName: string): Promise<void> {
    const parentUri = this.toWritableLocalFolderUri(parentPath);

    if (!parentUri) return;

    const name = this.normalizeEntityName(folderName);

    if (!name) return;

    const targetUri = vscode.Uri.joinPath(parentUri, ...this.toPathParts(name));

    try {
      await vscode.workspace.fs.createDirectory(targetUri);
      this.refresh(true);
    } catch (error) {
      vscode.window.showErrorMessage(`新建文件夹失败：${this.toErrorMessage(error)}`);
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

  private async renamePath(oldPath: string, newNameOrPath: string): Promise<void> {
    const oldUri = this.toUri(oldPath);

    if (!oldUri || oldUri.scheme !== 'file') {
      vscode.window.showWarningMessage('当前只支持重命名本地文件');
      return;
    }

    const nextUri = newNameOrPath.includes('://')
      ? this.toUri(newNameOrPath)
      : vscode.Uri.joinPath(vscode.Uri.joinPath(oldUri, '..'), newNameOrPath);

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
      });

      return;
    }

    const results: RecentProjectFileItem[] = [];
    const lowerQuery = query.trim().toLowerCase();
    const maxResults = 200;

    const walk = async (dirUri: vscode.Uri, rootUri: vscode.Uri): Promise<void> => {
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
      });

      return;
    }

    const lowerQuery = query.trim().toLowerCase();
    const results: any[] = [];
    const maxResults = 200;
    let matchCount = 0;

    const walk = async (dirUri: vscode.Uri, rootUri: vscode.Uri): Promise<void> => {
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
          // ignore unreadable files
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
      focusOnly,
    });
  }

  private getDiagnostics(uri: vscode.Uri): { errors: number; warnings: number } {
    const diagnostics = vscode.languages.getDiagnostics(uri);

    return {
      errors: diagnostics.filter(item => item.severity === vscode.DiagnosticSeverity.Error)
        .length,
      warnings: diagnostics.filter(
        item => item.severity === vscode.DiagnosticSeverity.Warning,
      ).length,
    };
  }

  private toUri(value: string): vscode.Uri | undefined {
    return this.recentProjectsService.toUri(value);
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
    return value
      .replace(/\\/g, '/')
      .split('/')
      .filter(Boolean);
  }

  private async ensureParentDirectory(fileUri: vscode.Uri): Promise<void> {
    const parentUri = vscode.Uri.joinPath(fileUri, '..');

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