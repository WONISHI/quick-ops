import * as vscode from 'vscode';
import * as https from 'https';
import * as path from 'path';
import * as fs from 'fs';
import * as readline from 'readline';
import { getReactWebviewHtml } from '../utils/WebviewHelper';


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
  private dirCache = new Map<string, any[]>();

  private selectedForCompareUri?: vscode.Uri;
  private selectedForCompareName?: string;

  constructor(private context: vscode.ExtensionContext) {
    this.recordCurrentProject();
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

  public refresh() {
    this.updateWebview();
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
        case 'refresh':
          this.refresh();
          break;
        case 'openProject':
          this.openProject(data.fsPath);
          break;
        case 'openProjectCurrent': {
          const proj = this.getRecentProjects().find((p) => p.fsPath === data.fsPath);
          this.executeOpen(data.fsPath, false, proj?.branch);
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
          this.readDirectory(data.id, data.fsPath, data.projectName);
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
          this.handleSearchInFolder(data.fsPath, data.query, data.isRemote);
          break;

        case 'previewWithVditor':
          this.openVditorPanel(data.fsPath, data.isActiveProject ? 'edit' : 'read');
          break;

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

        case 'searchFileName':
          this.handleSearchFileName(data.fsPath, data.query, data.isRemote);
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
      }
    });
  }

  private async handleSearchFileName(fsPath: string, query: string, isRemote: boolean) {
    if (isRemote) {
      this._view?.webview.postMessage({ type: 'searchFileNameResult', results: [], error: '远程仓库暂不支持名称检索。' });
      return;
    }

    const uri = fsPath.includes('://') ? vscode.Uri.parse(fsPath) : vscode.Uri.file(fsPath);
    const nativePath = uri.fsPath;

    if (!query.trim() || !fs.existsSync(nativePath)) {
      this._view?.webview.postMessage({ type: 'searchFileNameResult', results: [] });
      return;
    }

    const results: any[] = [];
    const maxResults = 200; // 限制最大数量防止卡死
    let currentResults = 0;

    const IGNORE_DIRS = new Set(['node_modules', 'dist', 'build', '.git', '.svn', '.vscode', '.idea']);

    const searchRecursive = async (dir: string) => {
      if (currentResults >= maxResults) return;
      try {
        const entries = await fs.promises.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (currentResults >= maxResults) break;
          if (IGNORE_DIRS.has(entry.name) || entry.name === '.DS_Store') continue;

          const fullPath = path.join(dir, entry.name);
          const relativePath = path.relative(nativePath, fullPath).replace(/\\/g, '/');

          // 如果文件名/文件夹名包含关键字
          if (entry.name.toLowerCase().includes(query.toLowerCase())) {
            results.push({
              path: vscode.Uri.file(fullPath).toString(),
              name: relativePath, // 返回相对路径以便于前端清晰展示位置
              isFolder: entry.isDirectory()
            });
            currentResults++;
          }

          if (entry.isDirectory()) {
            await searchRecursive(fullPath);
          }
        }
      } catch (e) { }
    };

    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Window,
      title: 'Quick Ops: 正在按名称检索...'
    }, async () => {
      await searchRecursive(nativePath);
    });

    this._view?.webview.postMessage({ type: 'searchFileNameResult', results });
  }

  private async openVditorPanel(fsPath: string, type: 'read' | 'edit') {
    try {
      const uri = fsPath.includes('://') ? vscode.Uri.parse(fsPath) : vscode.Uri.file(fsPath);
      const fileName = path.basename(uri.path);

      const contentBytes = await vscode.workspace.fs.readFile(uri);
      const content = Buffer.from(contentBytes).toString('utf8');

      const mdDir = path.dirname(uri.fsPath);
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';

      const imageMap: Record<string, string> = {};

      const wikiRegex = /!\[\[(.*?)\]\]/g;
      const mdRegex = /!\[.*?\]\((.*?)\)/g;

      const foundNames = new Set<string>();
      let match;

      while ((match = wikiRegex.exec(content)) !== null) { foundNames.add(match[1].trim()); }
      while ((match = mdRegex.exec(content)) !== null) {
        const p = match[1].trim();
        if (p.includes('Pasted image')) {
          foundNames.add(p);
        }
      }

      for (const exactName of foundNames) {
        let decodedName = exactName;
        try {
          decodedName = decodeURIComponent(exactName);
        } catch (e) { }

        const searchDirs: string[] = [];

        searchDirs.push(
          path.join(mdDir, 'assets'),
          path.join(mdDir, 'img'),
          path.join(mdDir, 'images')
        );

        if (workspaceRoot) {
          searchDirs.push(
            path.join(workspaceRoot, 'assets'),
            path.join(workspaceRoot, 'img'),
            path.join(workspaceRoot, 'images')
          );
        }

        searchDirs.push(mdDir);
        if (workspaceRoot) {
          searchDirs.push(workspaceRoot);
        }

        const uniqueSearchDirs = Array.from(new Set(searchDirs));

        let foundPath = '';
        for (const dir of uniqueSearchDirs) {
          if (!fs.existsSync(dir)) continue;

          try {
            const files = fs.readdirSync(dir);
            const matchedFile = files.find(file => file === decodedName || file === exactName);

            if (matchedFile) {
              foundPath = path.join(dir, matchedFile);
              break;
            }
          } catch (e) { }
        }

        if (foundPath) {
          imageMap[exactName] = foundPath;
        }
      }

      const panel = vscode.window.createWebviewPanel(
        'vditorPreviewReact',
        `${fileName}`,
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

      panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'icons', 'markdown.svg');

      const finalImageMap: Record<string, string> = {};
      for (const [rawName, absPath] of Object.entries(imageMap)) {
        finalImageMap[rawName] = panel.webview.asWebviewUri(vscode.Uri.file(absPath)).toString();
      }

      panel.webview.onDidReceiveMessage(async (msg) => {
        if (msg.command === 'webviewLoaded') {
          panel.webview.postMessage({
            type: 'initVditorData',
            content: content,
            mode: type,
            fsPath: fsPath,
            imageMap: finalImageMap
          });
        } else if (msg.command === 'saveMarkdown' && type === 'edit') {
          await vscode.workspace.fs.writeFile(uri, Buffer.from(msg.content, 'utf8'));
          vscode.window.showInformationMessage('✅ Markdown 已保存');
        }
      });

      panel.webview.html = getReactWebviewHtml(this.context.extensionUri, panel.webview, `/Vditor?type=${type}`);

    } catch (e) {
      vscode.window.showErrorMessage('无法读取文件进行 Vditor 预览。');
    }
  }

  private async handleSearchInFolder(fsPath: string, query: string, isRemote: boolean) {
    if (isRemote) {
      this._view?.webview.postMessage({ type: 'searchFolderResult', results: [], error: '由于网络限制，远程仓库暂不支持全文代码检索，请在本地打开该项目后再尝试。' });
      return;
    }

    const uri = fsPath.includes('://') ? vscode.Uri.parse(fsPath) : vscode.Uri.file(fsPath);
    const nativePath = uri.fsPath;

    if (!query.trim() || !fs.existsSync(nativePath)) {
      this._view?.webview.postMessage({ type: 'searchFolderResult', results: [] });
      return;
    }

    const results: any[] = [];
    const maxResults = 200;
    let currentResults = 0;

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

    const searchRecursive = async (dir: string) => {
      if (currentResults >= maxResults) return;
      try {
        let entries;
        try {
          entries = await fs.promises.readdir(dir, { withFileTypes: true });
        } catch (e) { return; }

        for (const entry of entries) {
          if (currentResults >= maxResults) break;

          if (IGNORE_DIRS.has(entry.name) || entry.name === '.DS_Store' || entry.name === 'Thumbs.db') continue;

          const fullPath = path.join(dir, entry.name);

          if (entry.isDirectory()) {
            await searchRecursive(fullPath);
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            if (BINARY_EXTS.has(ext)) continue;

            try {
              const stat = await fs.promises.stat(fullPath);
              if (stat.size > 2 * 1024 * 1024) continue;
            } catch (e) { continue; }

            const fileMatches = [];
            let lineNum = 1;
            const fileStream = fs.createReadStream(fullPath, { encoding: 'utf8' });
            const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

            try {
              for await (const line of rl) {
                if (line.toLowerCase().includes(query.toLowerCase())) {
                  fileMatches.push({
                    line: lineNum,
                    text: line.trim().substring(0, 300)
                  });
                  currentResults++;
                  if (currentResults >= maxResults) {
                    rl.close();
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
                matches: fileMatches
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
      const token = vscode.workspace.getConfiguration('quick-ops.git').get('githubToken');
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

          if (stat.type === vscode.FileType.File) {
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
    if (index === -1) return;

    const p = projects[index];
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

          if (stat.type === vscode.FileType.File) {
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
          const token = vscode.workspace.getConfiguration('quick-ops.git').get('githubToken');
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

  private async readDirectory(id: string, fsPath: string, projectName: string) {
    try {
      const uri = fsPath.includes('://') ? vscode.Uri.parse(fsPath) : vscode.Uri.file(fsPath);
      const uriStr = uri.toString();

      if (this.dirCache.has(uriStr)) {
        this._view?.webview.postMessage({ type: 'readDirResult', id, children: this.dirCache.get(uriStr), projectName });
        return;
      }

      const entries = await vscode.workspace.fs.readDirectory(uri);

      const children = entries
        .map(([name, type]) => {
          const isFolder = (type & vscode.FileType.Directory) !== 0;
          const childUriStr = vscode.Uri.joinPath(uri, name).toString();
          return { name, isFolder, path: childUriStr };
        })
        .filter((c) => c.name !== 'node_modules' && c.name !== '.git')
        .sort((a, b) => {
          if (a.isFolder === b.isFolder) return a.name.localeCompare(b.name);
          return a.isFolder ? -1 : 1;
        });

      this.dirCache.set(uriStr, children);

      this._view?.webview.postMessage({ type: 'readDirResult', id, children, projectName });
    } catch (e) {
      vscode.window.showWarningMessage(`读取失败：可能是网络超时或触发了 GitHub API 限制，请稍后再试。`);
      this._view?.webview.postMessage({ type: 'readDirResult', id, children: [], projectName });
    }
  }

  private updateWebview() {
    if (!this._view) return;
    const projects = this.getRecentProjects();
    const currentUriStr = vscode.workspace.workspaceFolders?.[0]?.uri.toString() || '';

    this._view.webview.postMessage({
      type: 'updateProjects',
      data: projects,
      currentUriStr: currentUriStr,
      lastOpenedPath: this.lastOpenedPath
    });

  }

  private getRecentProjects(): RecentProject[] {
    return this.context.globalState.get<RecentProject[]>(this.stateKey) || [];
  }

  private async recordCurrentProject() {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return;

    const currentUriStr = folders[0].uri.toString();
    const currentBaseUri = currentUriStr.split('?')[0];

    const allProjects = this.getRecentProjects();
    const existingProject = allProjects.find((p) => p.fsPath.split('?')[0] === currentBaseUri);
    let projects = allProjects.filter((p) => p.fsPath.split('?')[0] !== currentBaseUri);

    const finalFsPath = existingProject ? existingProject.fsPath : currentUriStr;

    projects.unshift({
      name: folders[0].name,
      fsPath: finalFsPath,
      timestamp: Date.now(),
      branch: existingProject?.branch,
      customName: existingProject?.customName,
      platform: existingProject?.platform,
      customDomain: existingProject?.customDomain
    });

    if (projects.length > 50) projects = projects.slice(0, 50);

    await this.context.globalState.update(this.stateKey, projects);
    if (this._view) this.updateWebview();

    this.updateSingleBranch(finalFsPath, true);
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
      const folderName = uri[0].path.split(/[\\/]/).pop() || '本地项目';
      await this.insertProjectToHistory(folderName, uri[0].toString());
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
    const choice = await vscode.window.showInformationMessage('准备打开项目，请选择打开方式：', { modal: false }, '在当前窗口打开', '在新窗口打开');
    if (choice) this.executeOpen(fsPath, choice === '在新窗口打开', project?.branch);
  }

  public async removeProjectByPath(fsPath: string) {
    let projects = this.getRecentProjects().filter((p) => p.fsPath !== fsPath);
    await this.context.globalState.update(this.stateKey, projects);
    this.updateWebview();
  }

  public async clearAll() {
    await this.context.globalState.update(this.stateKey, []);
    this.updateWebview();
  }
}