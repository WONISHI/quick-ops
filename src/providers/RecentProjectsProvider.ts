// src/providers/RecentProjectsProvider.ts
import * as vscode from 'vscode';
import * as https from 'https';
import { getRecentProjectsHtml } from '../views/RecentProjectsWebview'; // 🌟 导入拆分的渲染函数

export class ReadOnlyContentProvider implements vscode.TextDocumentContentProvider {
  public onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
  public onDidChange = this.onDidChangeEmitter.event;

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    try {
      const targetQuery = uri.query.replace('target=', '');
      const targetUriStr = decodeURIComponent(targetQuery);
      const targetUri = vscode.Uri.parse(targetUriStr);
      const contentBytes = await vscode.workspace.fs.readFile(targetUri);
      return Buffer.from(contentBytes).toString('utf8');
    } catch (e) {
      return `/* 无法读取该文件内容: ${e} */`;
    }
  }
}

export class ReadOnlyDecorationProvider implements vscode.FileDecorationProvider {
  provideFileDecoration(uri: vscode.Uri): vscode.ProviderResult<vscode.FileDecoration> {
    if (uri.scheme === 'quickops-ro') {
      return {
        badge: '🔒',
        tooltip: '该文件处于只读预览模式',
        color: new vscode.ThemeColor('gitDecoration.ignoredResourceForeground'),
      };
    }
    return undefined;
  }
}

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

  constructor(private context: vscode.ExtensionContext) {
    this.recordCurrentProject();
  }

  public resolveWebviewView(webviewView: vscode.WebviewView, context: vscode.WebviewViewResolveContext, _token: vscode.CancellationToken) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };

    webviewView.webview.onDidReceiveMessage(async (data) => {
      switch (data.type) {
        case 'openProject':
          this.openProject(data.fsPath);
          break;
        case 'openProjectCurrent':
          const proj = this.getRecentProjects().find((p) => p.fsPath === data.fsPath);
          this.executeOpen(data.fsPath, false, proj?.branch);
          break;
        case 'removeProject':
          this.removeProjectByPath(data.fsPath);
          break;
        case 'addLocal':
          this.addLocalProject();
          break;
        case 'addRemote':
          this.addRemoteProject();
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
        case 'openExternalLink':
          this.openExternalLink(data.fsPath, data.platform, data.customDomain);
          break;
      }
    });

    this.updateWebview();
  }

  private async fetchDefaultBranch(platform: string, domain: string, repoFullName: string): Promise<string | undefined> {
    return new Promise((resolve) => {
      let options: any = {};
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

    await Promise.all(
      projects.map(async (p) => {
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
              } catch (e) {}
            }
            if (repoFullName) {
              newBranch = await this.fetchDefaultBranch(p.platform || 'github', p.customDomain || '', repoFullName);
            }
          }
        } else {
          try {
            const headUri = vscode.Uri.joinPath(vscode.Uri.file(p.fsPath), '.git', 'HEAD');
            const contentBytes = await vscode.workspace.fs.readFile(headUri);
            const content = Buffer.from(contentBytes).toString('utf8').trim();
            newBranch = content.startsWith('ref: ') ? content.split('/').pop() : content.substring(0, 7);
          } catch (e) {
            newBranch = undefined;
          }
        }

        if (newBranch && p.branch !== newBranch) {
          p.branch = newBranch;
          stateChanged = true;
          this._view?.webview.postMessage({ type: 'updateBranchTag', fsPath: p.fsPath, branch: newBranch });
        }
      }),
    );

    if (stateChanged) {
      await this.context.globalState.update(this.stateKey, projects);
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

  private async openFileReadOnly(fsPath: string, projectName: string) {
    try {
      const originalUri = fsPath.includes('://') ? vscode.Uri.parse(fsPath) : vscode.Uri.file(fsPath);
      const fileName = originalUri.path.split(/[\\/]/).pop() || 'unknown';
      const virtualPath = `/🔒 ${projectName}: ${fileName}`;

      const roUri = vscode.Uri.from({
        scheme: 'quickops-ro',
        path: virtualPath,
        query: `target=${encodeURIComponent(originalUri.toString())}`,
      });

      const doc = await vscode.workspace.openTextDocument(roUri);
      await vscode.window.showTextDocument(doc, { preview: true });
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
      } catch (e) {}
    }

    if (!repoFullName) return;

    try {
      await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `正在查询 ${repoFullName.split('/').pop()} 的远程分支...`, cancellable: false }, async () => {
        return new Promise<any[]>((resolve, reject) => {
          let options: any = {};
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

      this._view?.webview.postMessage({ type: 'readDirResult', id, children, projectName });
    } catch (e) {
      this._view?.webview.postMessage({ type: 'readDirResult', id, children: [], projectName });
    }
  }

  private updateWebview() {
    if (!this._view) return;
    const projects = this.getRecentProjects();
    const currentUriStr = vscode.workspace.workspaceFolders?.[0]?.uri.toString() || '';

    // 🌟 核心：使用引入的模板函数，一句话渲染
    this._view.webview.html = getRecentProjectsHtml(this._view.webview, projects, currentUriStr, this.lastOpenedPath);

    this.refreshBranchesAsync();
  }

  private getRecentProjects(): RecentProject[] {
    return this.context.globalState.get<RecentProject[]>(this.stateKey) || [];
  }

  private async recordCurrentProject() {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return;

    const currentUriStr = folders[0].uri.toString();
    let projects = this.getRecentProjects().filter((p) => p.fsPath !== currentUriStr);

    projects.unshift({ name: folders[0].name, fsPath: currentUriStr, timestamp: Date.now() });
    if (projects.length > 50) projects = projects.slice(0, 50);

    await this.context.globalState.update(this.stateKey, projects);
    if (this._view) this.updateWebview();
  }

  private async insertProjectToHistory(name: string, uriStr: string, platform?: 'github' | 'gitlab', customDomain?: string) {
    let projects = this.getRecentProjects().filter((p) => p.fsPath !== uriStr);
    projects.unshift({ name, fsPath: uriStr, timestamp: Date.now(), platform, customDomain });

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
      vscode.window.showErrorMessage('无效的远程地址格式，请提供规范的 Git 地址。');
      return;
    }

    const projectName = await vscode.window.showInputBox({ value: repoFullName.split('/').pop() || repoFullName });

    if (projectName) {
      await this.insertProjectToHistory(projectName, targetUriStr, platform, customDomain);
      const choice = await vscode.window.showInformationMessage(`已添加远程项目 ${projectName}，要现在打开吗？`, '在当前窗口打开', '在新窗口打开');
      if (choice) this.executeOpen(targetUriStr, choice === '在新窗口打开');
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
