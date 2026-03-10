import * as vscode from 'vscode';
import * as https from 'https';

// ================= 🌟 辅助函数：生成 Nonce 随机字符串 =================
function getNonce() {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

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

  // ================= 🌟 核心：获取远程仓库的默认分支 =================
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

  // ================= 🌟 核心：异步无感刷新所有分支状态 =================
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
            // 💡 针对没有携带分支参数的远程库，自动查它默认分支
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

        // 如果成功获取到了分支，并且和旧的不一样，局部更新UI
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

    // 1. 先渲染UI，不阻塞
    this._view.webview.html = this.getHtmlForWebview(this._view.webview, projects, currentUriStr);

    // 2. 触发后台异步检测分支，如果有变化自动打上Tag
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

  // ================= 🌟 HTML 渲染核心 =================
  private getHtmlForWebview(webview: vscode.Webview, projects: RecentProject[], currentUri: string) {
    const styleSrc = `https://cdnjs.cloudflare.com https://cdn.jsdelivr.net`;

    const currentBaseUri = currentUri.split('?')[0];
    let currentProject: RecentProject | undefined;
    let otherProjects: RecentProject[] = [];

    projects.forEach((p) => {
      if (p.fsPath.split('?')[0] === currentBaseUri) currentProject = p;
      else otherProjects.push(p);
    });

    let currentProjectHtml = '';
    if (currentProject) {
      const isRemote = currentProject.fsPath.startsWith('vscode-vfs') || currentProject.fsPath.startsWith('http');
      const isGitlab = currentProject.platform === 'gitlab' || currentProject.fsPath.startsWith('vscode-vfs://gitlab');

      let displayPath = currentProject.fsPath;
      try {
        const uri = vscode.Uri.parse(currentProject.fsPath);
        if (uri.scheme === 'file') {
          displayPath = uri.fsPath;
        } else if (currentProject.customDomain) {
          displayPath = `Self-Hosted: ${currentProject.customDomain}/${uri.path.replace(/^\//, '')}`;
        } else {
          displayPath = currentProject.fsPath.replace('vscode-vfs://github/', 'GitHub: ').replace('vscode-vfs://gitlab/', 'GitLab: ');
        }
      } catch (e) {}

      let iconClass = 'fa-solid fa-folder-open';
      if (isRemote) iconClass = isGitlab ? 'fa-brands fa-gitlab' : 'fa-brands fa-github';

      const branchTagHtml = currentProject.branch
        ? `<span class="branch-tag" title="当前分支: ${currentProject.branch}"><i class="fa-solid fa-code-branch" style="font-size:10px;"></i> ${currentProject.branch}</span>`
        : '';

      const safeFsPath = currentProject.fsPath.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      const displayTitle = currentProject.customName ? currentProject.customName : currentProject.name;
      const safeCustomName = (currentProject.customName || '').replace(/'/g, "\\'");
      const platformStr = currentProject.platform || 'github';
      const customDomainStr = currentProject.customDomain || '';

      const finalDisplayPath = currentProject.customName ? `${currentProject.name} • ${displayPath}` : displayPath;
      const searchStr = `${displayTitle} ${currentProject.name} ${finalDisplayPath} ${currentProject.fsPath}`.toLowerCase().replace(/'/g, "\\'");

      currentProjectHtml = `
        <div class="searchable-item" data-search="${searchStr}">
          <div class="active-top-project" title="当前窗口正在运行的项目" 
               oncontextmenu="showContextMenu(event, '${safeFsPath}', ${isRemote}, '${currentProject.name.replace(/'/g, "\\'")}', '${safeCustomName}', '${platformStr}', '${customDomainStr}')">
            <div class="item-left">
              <div class="tree-chevron" style="visibility: hidden;"></div>
              <div class="info">
                <div class="title">
                  <i class="${iconClass} icon-opened project-icon"></i>
                  ${displayTitle}
                  <span class="branch-wrapper" data-branch-path="${safeFsPath}">${branchTagHtml}</span>
                </div>
                <div class="path">${finalDisplayPath}</div>
              </div>
            </div>
            <div class="item-actions"></div>
          </div>
          <div class="top-divider"></div>
        </div>
      `;
    }

    const listHtml = otherProjects
      .map((p) => {
        const isRemote = p.fsPath.startsWith('vscode-vfs') || p.fsPath.startsWith('http');
        const isGitlab = p.platform === 'gitlab' || p.fsPath.startsWith('vscode-vfs://gitlab');
        const rootId = `root_${p.timestamp}`;
        const isJustOpened = p.fsPath === this.lastOpenedPath;

        let displayPath = p.fsPath;
        try {
          const uri = vscode.Uri.parse(p.fsPath);
          if (uri.scheme === 'file') {
            displayPath = uri.fsPath;
          } else if (p.customDomain) {
            displayPath = `Self-Hosted: ${p.customDomain}/${uri.path.replace(/^\//, '')}`;
          } else {
            displayPath = p.fsPath.replace('vscode-vfs://github/', 'GitHub: ').replace('vscode-vfs://gitlab/', 'GitLab: ');
          }
        } catch (e) {}

        let iconClass = isRemote ? (isGitlab ? 'fa-brands fa-gitlab' : 'fa-brands fa-github') : 'fa-solid fa-folder';
        const colorClass = 'icon-closed';

        const branchTagHtml = p.branch ? `<span class="branch-tag" title="当前分支: ${p.branch}"><i class="fa-solid fa-code-branch" style="font-size:10px;"></i> ${p.branch}</span>` : '';
        const safeFsPath = p.fsPath.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

        const displayTitle = p.customName ? p.customName : p.name;
        const safeProjName = p.name.replace(/'/g, "\\'");
        const safeCustomName = (p.customName || '').replace(/'/g, "\\'");

        const justOpenedClass = isJustOpened ? 'just-opened' : '';
        const platformStr = p.platform || 'github';
        const customDomainStr = p.customDomain || '';

        const finalDisplayPath = p.customName ? `${p.name} • ${displayPath}` : displayPath;
        const searchStr = `${displayTitle} ${p.name} ${finalDisplayPath} ${p.fsPath}`.toLowerCase().replace(/'/g, "\\'");

        return `
        <li class="tree-node searchable-item" data-search="${searchStr}">
          <div class="project-item ${justOpenedClass}" 
               ondblclick="openProject('${safeFsPath}')" 
               oncontextmenu="showContextMenu(event, '${safeFsPath}', ${isRemote}, '${safeProjName}', '${safeCustomName}', '${platformStr}', '${customDomainStr}')"
               title="${isJustOpened ? '刚刚在此窗口中唤起过' : ''}">
            
            <div class="item-left">
              <div class="tree-chevron" onclick="toggleExpand('${rootId}', '${safeFsPath}', '${displayTitle.replace(/'/g, "\\'")}', event)">
                <i id="chevron-right-${rootId}" class="fa-solid fa-chevron-right"></i>
                <i id="chevron-down-${rootId}" class="fa-solid fa-chevron-down" style="display:none"></i>
              </div>
              
              <div class="info">
                <div class="title">
                  <i class="${iconClass} ${colorClass} project-icon"></i>
                  ${displayTitle}
                  <span class="branch-wrapper" data-branch-path="${safeFsPath}">${branchTagHtml}</span>
                </div>
                <div class="path">${finalDisplayPath}</div>
              </div>
            </div>

            <div class="item-actions">
              <button class="action-btn-icon open-btn" onclick="openCurrent('${safeFsPath}', event)" title="在当前窗口打开">
                <i class="fa-solid fa-arrow-right-to-bracket"></i>
              </button>
            </div>
          </div>
          
          <div class="tree-children" id="children-${rootId}" style="display:none;"></div>
        </li>
      `;
      })
      .join('');

    return `<!DOCTYPE html>
      <html lang="zh-CN">
      <head>
        <meta charset="UTF-8">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline' ${styleSrc}; script-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} https:; font-src ${webview.cspSource} https:;">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" 
              onerror="this.onerror=null;this.href='https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css';">
        <style>
          * { box-sizing: border-box; }
          body { 
            padding: 0; margin: 0; color: var(--vscode-foreground); 
            font-family: var(--vscode-font-family); user-select: none;
            display: flex; flex-direction: column; height: 100vh;
            background: var(--vscode-sideBar-background);
          }

          .search-container { padding: 10px 12px; background: var(--vscode-sideBar-background); position: sticky; top: 0; z-index: 10; }
          .search-box { display: flex; align-items: center; background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); padding: 4px 8px; border-radius: 2px; transition: border-color 0.2s; }
          .search-box:focus-within { border-color: var(--vscode-focusBorder); outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
          .search-box input { flex: 1; background: transparent; border: none; color: var(--vscode-input-foreground); outline: none; margin-left: 6px; font-family: inherit; font-size: 12px; }
          .search-box input::placeholder { color: var(--vscode-input-placeholderForeground); }
          .search-box .fa-magnifying-glass { color: var(--vscode-input-placeholderForeground); font-size: 12px; }
          
          #no-search-results { text-align: center; padding: 20px; font-size: 12px; color: var(--vscode-descriptionForeground); display: none; }

          .list-container { flex: 1; overflow-y: auto; padding-bottom: 20px;}
          ul { list-style: none; padding: 0; margin: 0; }
          
          .active-top-project { display: flex; justify-content: space-between; align-items: center; padding: 8px 10px 8px 0px; background-color: rgba(93, 173, 226, 0.1); border-left: 3px solid #5dade2; cursor: context-menu; }
          .active-top-project .path { color: var(--vscode-descriptionForeground); opacity: 0.8; }
          .top-divider { height: 4px; background: rgba(0, 0, 0, 0.1); box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.1); margin-bottom: 4px; }
          .project-item { display: flex; justify-content: space-between; align-items: center; padding: 6px 10px 6px 3px; cursor: pointer; border-bottom: 1px solid var(--vscode-panel-border); transition: background-color 0.1s; }
          .project-item:hover { background-color: var(--vscode-list-hoverBackground); }
          .project-item.just-opened { padding-left: 1px; background-color: rgba(128, 128, 128, 0.06); box-shadow: inset 0 0 12px rgba(128, 128, 128, 0.15); border-left: 2px solid var(--vscode-descriptionForeground); }
          
          .item-left { display: flex; align-items: center; flex: 1; min-width: 0; gap: 3px; }
          
          .tree-chevron, .chevron-placeholder { width: 14px; height: 20px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
          .tree-chevron { cursor: pointer; color: var(--vscode-icon-foreground); opacity: 0.8; border-radius: 4px; }
          .tree-chevron:hover { background: var(--vscode-toolbar-hoverBackground); opacity: 1; }
          .tree-chevron .fa-solid { font-size: 10px; transition: transform 0.1s; }

          .project-icon, .sub-icon { width: 16px; text-align: center; margin-right: 6px; flex-shrink: 0; display: inline-block; font-size: 14px; }

          .info { overflow: hidden; display: flex; flex-direction: column; flex: 1; padding-top: 2px; padding-bottom: 2px; }
          .title { font-size: 13px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: flex; align-items: center; }
          .path { font-size: 10px; opacity: 0.6; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
          
          .branch-tag { font-size: 10px; background: rgba(128, 128, 128, 0.15); color: var(--vscode-descriptionForeground); padding: 2px 6px; border-radius: 10px; display: inline-flex; align-items: center; gap: 3px; font-weight: normal; margin-left: 6px; }

          .icon-opened { color: #5dade2 !important; opacity: 1 !important; } 
          .icon-closed { color: var(--vscode-icon-foreground); opacity: 0.8; } 
          
          .item-actions { display: flex; align-items: center; gap: 2px; flex-shrink: 0; margin-left: 4px; }
          .action-btn-icon { background: none; border: none; color: var(--vscode-icon-foreground); cursor: pointer; padding: 6px; border-radius: 4px; display: flex; align-items: center; justify-content: center; transition: background-color 0.2s, color 0.2s, opacity 0.2s; }
          .open-btn { opacity: 0.4; }
          .open-btn:hover { opacity: 1; color: var(--vscode-foreground); background: var(--vscode-toolbar-hoverBackground); }
          .project-item:hover .open-btn { opacity: 0.8; }

          .action-btn-icon .fa-solid { font-size: 13px; }

          .tree-children { margin-left: 10px; padding-left: 6px; border-left: 1px solid var(--vscode-tree-indentGuidesStroke); }
          .sub-item { display: flex; align-items: center; padding: 2px 0; font-size: 13px; color: var(--vscode-foreground); cursor: default; }
          .sub-item:hover { background-color: var(--vscode-list-hoverBackground); }
          .sub-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; opacity: 0.9;}
          
          .file-icon-js { color: #f1e05a; } .file-icon-ts { color: #3178c6; } .file-icon-vue { color: #41b883; }
          .file-icon-html { color: #e34c26; } .file-icon-css { color: #563d7c; } .file-icon-json { color: #cbcb41; }
          .file-icon-md { color: #5dade2; } .file-icon-img { color: #a074c4; } .file-icon-default { color: var(--vscode-symbolIcon-fileForeground, #999); }

          .empty-node { font-size: 12px; opacity: 0.5; padding: 4px 12px; font-style: italic; }
          .empty-state { padding: 30px 20px; text-align: center; }
          .empty-text { opacity: 0.6; font-size: 13px; margin-bottom: 20px; }
          .bottom-bar { padding: 10px; border-top: 1px solid var(--vscode-panel-border); display: flex; gap: 8px; background: var(--vscode-sideBar-background); flex-shrink: 0; }
          .action-btn { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 6px 12px; border-radius: 2px; cursor: pointer; font-size: 12px; width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px; margin-bottom: 8px; transition: background 0.2s; }
          .action-btn:hover { background: var(--vscode-button-hoverBackground); }
          .action-btn.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
          .action-btn.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
          .bottom-bar .action-btn { margin-bottom: 0; }

          #context-menu {
            position: fixed; background: var(--vscode-menu-background); color: var(--vscode-menu-foreground);
            border: 1px solid var(--vscode-menu-border); box-shadow: 0 4px 12px rgba(0,0,0,0.25); border-radius: 6px;
            z-index: 9999; min-width: 180px; padding: 4px 0; display: none; font-size: 13px;
          }
          #context-menu li { padding: 6px 12px; cursor: pointer; display: flex; align-items: center; gap: 10px; }
          #context-menu li:hover { background: var(--vscode-menu-selectionBackground); color: var(--vscode-menu-selectionForeground); }
          #context-menu .fa-solid { width: 14px; text-align: center; opacity: 0.8; }
          .menu-separator { height: 1px; background: var(--vscode-menu-separatorBackground); margin: 4px 0; }
        </style>
      </head>
      <body>
        <div id="context-menu">
          <ul id="context-menu-list" style="list-style: none; padding: 0; margin: 0;"></ul>
        </div>

        ${
          projects.length > 0
            ? `
        <div class="search-container">
          <div class="search-box">
            <i class="fa-solid fa-magnifying-glass"></i>
            <input type="text" id="project-search" placeholder="搜索标题、文件夹、地址..." autocomplete="off" spellcheck="false" />
          </div>
        </div>
        `
            : ''
        }

        <div class="list-container">
          ${
            projects.length === 0
              ? `
            <div class="empty-state">
              <div class="empty-text">暂无项目记录，请添加：</div>
              <button class="action-btn" onclick="addLocal()"><i class="fa-solid fa-folder-plus"></i> 添加本地项目</button>
              <button class="action-btn secondary" onclick="addRemote()"><i class="fa-brands fa-github"></i> 添加远程仓库</button>
            </div>
          `
              : `${currentProjectHtml}<ul>${listHtml}</ul><div id="no-search-results">没有找到匹配的项目...</div>`
          }
        </div>
        ${
          projects.length > 0
            ? `
          <div class="bottom-bar">
            <button class="action-btn" onclick="addLocal()"><i class="fa-solid fa-folder-plus"></i> 添加本地</button>
            <button class="action-btn secondary" onclick="addRemote()"><i class="fa-brands fa-github"></i> 添加远程</button>
          </div>
        `
            : ''
        }
        
        <script>
          const vscode = acquireVsCodeApi();
          
          let activeContextMenuPath = '';
          let activeContextMenuPlatform = '';
          let activeContextMenuDomain = '';

          const searchInput = document.getElementById('project-search');
          const noResultsMsg = document.getElementById('no-search-results');
          
          if (searchInput) {
            searchInput.addEventListener('input', (e) => {
              const query = e.target.value.toLowerCase().trim();
              const searchableItems = document.querySelectorAll('.searchable-item');
              let matchCount = 0;

              searchableItems.forEach(item => {
                const searchStr = item.getAttribute('data-search') || '';
                if (searchStr.includes(query)) {
                  item.style.display = ''; 
                  matchCount++;
                } else {
                  item.style.display = 'none';
                }
              });

              if (noResultsMsg) {
                noResultsMsg.style.display = matchCount === 0 ? 'block' : 'none';
              }
            });
          }

          function openProject(path) { vscode.postMessage({ type: 'openProject', fsPath: path }); }
          function openCurrent(path, event) { event.stopPropagation(); vscode.postMessage({ type: 'openProjectCurrent', fsPath: path }); }
          function addLocal() { vscode.postMessage({ type: 'addLocal' }); }
          function addRemote() { vscode.postMessage({ type: 'addRemote' }); }
          
          function openFile(path, projectName, event) {
            event.stopPropagation();
            vscode.postMessage({ type: 'openFile', fsPath: path, projectName: projectName });
          }

          function toggleExpand(id, path, projectName, event) {
            event.stopPropagation();
            const childrenContainer = document.getElementById('children-' + id);
            const rightIcon = document.getElementById('chevron-right-' + id);
            const downIcon = document.getElementById('chevron-down-' + id);

            if (childrenContainer.style.display === 'none') {
              rightIcon.style.display = 'none';
              downIcon.style.display = 'inline-block';
              childrenContainer.style.display = 'block';

              const isRemote = path.startsWith('vscode-vfs://') || path.startsWith('http');

              // 🌟 核心优化：SWR (Stale-While-Revalidate) 体验
              if (!childrenContainer.hasChildNodes()) {
                // 第一次完全没数据，显示大加载框
                childrenContainer.innerHTML = '<div class="empty-node"><i class="fa-solid fa-spinner fa-spin"></i> 加载中...</div>';
                vscode.postMessage({ type: 'readDir', id: id, fsPath: path, projectName: projectName });
              } else if (isRemote) {
                // 如果已经有缓存数据了，立即展示！同时把右侧箭头变成 Loading 状态，后台静默拉取更新
                downIcon.classList.remove('fa-chevron-down');
                downIcon.classList.add('fa-spinner', 'fa-spin');
                vscode.postMessage({ type: 'readDir', id: id, fsPath: path, projectName: projectName });
              }
            } else {
              rightIcon.style.display = 'inline-block';
              downIcon.style.display = 'none';
              childrenContainer.style.display = 'none';
            }
          }

          function showContextMenu(event, path, isRemote, originalName, customName, platform, customDomain) {
            event.preventDefault();
            
            activeContextMenuPath = path;
            activeContextMenuPlatform = platform;
            activeContextMenuDomain = customDomain;

            const menu = document.getElementById('context-menu');
            const list = document.getElementById('context-menu-list');
            list.innerHTML = '';

            const displayName = customName ? customName : originalName;

            list.innerHTML += \`<li onclick="handleMenuClick('edit')"><i class="fa-solid fa-pen"></i> 编辑项目名称</li>\`;
            
            if (isRemote) {
              list.innerHTML += \`<li onclick="handleMenuClick('switchBranch')"><i class="fa-solid fa-code-branch"></i> 切换分支</li>\`;
            }

            list.innerHTML += \`<div class="menu-separator"></div>\`;

            list.innerHTML += \`<li onclick="handleMenuClick('copyName', '\${displayName}')"><i class="fa-solid fa-copy"></i> 复制项目名称</li>\`;
            list.innerHTML += \`<li onclick="handleMenuClick('copyPath', '\${path}')"><i class="fa-solid fa-link"></i> 复制地址链接</li>\`;

            if (isRemote) {
              list.innerHTML += \`<li onclick="handleMenuClick('openLink', '\${path}')"><i class="fa-solid fa-globe"></i> 在浏览器中打开</li>\`;
            }

            list.innerHTML += \`<div class="menu-separator"></div>\`;

            list.innerHTML += \`<li onclick="handleMenuClick('delete')" style="color: var(--vscode-errorForeground);"><i class="fa-solid fa-trash"></i> 移除该项目</li>\`;

            let x = event.pageX;
            let y = event.pageY;
            
            menu.style.display = 'block';
            if (x + menu.offsetWidth > window.innerWidth) x = window.innerWidth - menu.offsetWidth;
            if (y + menu.offsetHeight > window.innerHeight) y = window.innerHeight - menu.offsetHeight;

            menu.style.left = x + 'px';
            menu.style.top = y + 'px';
          }

          document.addEventListener('click', () => {
            const menu = document.getElementById('context-menu');
            if (menu) menu.style.display = 'none';
          });

          function handleMenuClick(action, payload) {
            document.getElementById('context-menu').style.display = 'none';
            switch(action) {
              case 'edit':
                vscode.postMessage({ type: 'editProjectName', fsPath: activeContextMenuPath });
                break;
              case 'switchBranch':
                vscode.postMessage({ type: 'switchBranch', fsPath: activeContextMenuPath });
                break;
              case 'copyName':
              case 'copyPath':
                vscode.postMessage({ type: 'copyToClipboard', text: payload });
                break;
              case 'openLink':
                vscode.postMessage({ type: 'openExternalLink', fsPath: payload, platform: activeContextMenuPlatform, customDomain: activeContextMenuDomain });
                break;
              case 'delete':
                vscode.postMessage({ type: 'removeProject', fsPath: activeContextMenuPath });
                break;
            }
          }

          function getFileIcon(filename) {
            const extMatch = filename.match(/\\.([^.]+)$/);
            const ext = extMatch ? extMatch[1].toLowerCase() : '';
            switch(ext) {
              case 'js': case 'jsx': return 'fa-brands fa-js file-icon-js';
              case 'ts': case 'tsx': return 'fa-brands fa-js file-icon-ts'; 
              case 'vue': return 'fa-brands fa-vuejs file-icon-vue';
              case 'html': return 'fa-brands fa-html5 file-icon-html';
              case 'css': case 'scss': case 'less': return 'fa-brands fa-css3-alt file-icon-css';
              case 'json': return 'fa-solid fa-file-code file-icon-json';
              case 'md': return 'fa-brands fa-markdown file-icon-md';
              case 'png': case 'jpg': case 'jpeg': case 'gif': case 'svg': case 'ico': return 'fa-regular fa-image file-icon-img';
              default: return 'fa-regular fa-file-code file-icon-default';
            }
          }

          window.addEventListener('message', event => {
            const message = event.data;
            
            if (message.type === 'updateBranchTag') {
              const safePath = message.fsPath.replace(/\\\\/g, '\\\\\\\\').replace(/'/g, "\\\\'");
              const wrappers = document.querySelectorAll(\`[data-branch-path="\${safePath}"]\`);
              
              wrappers.forEach(w => {
                if (message.branch) {
                  w.innerHTML = \`<span class="branch-tag" title="当前分支: \${message.branch}"><i class="fa-solid fa-code-branch" style="font-size:10px;"></i> \${message.branch}</span>\`;
                } else {
                  w.innerHTML = '';
                }
              });
              return;
            }

            if (message.type === 'readDirResult') {
              const container = document.getElementById('children-' + message.id);
              if (!container) return;

              if (message.children.length === 0) {
                container.innerHTML = '<div class="empty-node">（空文件夹/无读取权限）</div>';
              } else {
                const projName = message.projectName || 'Unknown';
                const safeProjName = projName.replace(/'/g, "\\\\'");

                let html = '';
                message.children.forEach((child, index) => {
                  const childId = message.id + '_' + index;
                  const iconClass = child.isFolder ? 'fa-solid fa-folder icon-closed sub-icon' : getFileIcon(child.name) + ' sub-icon';
                  const safeChildPath = child.path.replace(/\\\\/g, '\\\\\\\\').replace(/'/g, "\\\\'");
                  const clickAttr = child.isFolder ? '' : 'onclick="openFile(\\'' + safeChildPath + '\\', \\'' + safeProjName + '\\', event)" style="cursor:pointer;" title="点击以只读模式预览"';
                  
                  html += \`
                    <div class="tree-node">
                      <div class="sub-item" \${clickAttr}>
                        \${child.isFolder 
                          ? \`<div class="tree-chevron" onclick="toggleExpand('\${childId}', '\${safeChildPath}', '\${safeProjName}', event)">
                              <i id="chevron-right-\${childId}" class="fa-solid fa-chevron-right"></i>
                              <i id="chevron-down-\${childId}" class="fa-solid fa-chevron-down" style="display:none"></i>
                             </div>\` 
                          : \`<div class="chevron-placeholder"></div>\`
                        }
                        <i class="\${iconClass}"></i>
                        <span class="sub-name">\${child.name}</span>
                      </div>
                      \${child.isFolder ? \`<div class="tree-children" id="children-\${childId}" style="display:none;"></div>\` : ''}
                    </div>
                  \`;
                });
                
                container.innerHTML = html;
              }

              // 🌟 核心：恢复 Loading 图标为普通箭头
              const downIcon = document.getElementById('chevron-down-' + message.id);
              if (downIcon && downIcon.classList.contains('fa-spinner')) {
                downIcon.classList.remove('fa-spinner', 'fa-spin');
                downIcon.classList.add('fa-chevron-down');
              }
            }
          });
        </script>
      </body>
      </html>`;
  }
}
