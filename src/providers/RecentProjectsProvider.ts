import * as vscode from 'vscode';
import * as https from 'https';
import { IFeature } from '../core/interfaces/IFeature';
import ColorLog from '../utils/ColorLog';

// ================= 🌟 辅助函数：生成 Nonce 随机字符串 =================
function getNonce() {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

// 🌟 新增：虚拟只读文档提供程序
// 专门用于将本地或远程文件以“纯只读”模式渲染在编辑器中
export class ReadOnlyContentProvider implements vscode.TextDocumentContentProvider {
  // 当文档内容发生变化时触发（只读模式下通常不需要，但保留接口）
  public onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
  public onDidChange = this.onDidChangeEmitter.event;

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    try {
      // 从 query 参数中提取出真实的文件 URI
      const targetQuery = uri.query.replace('target=', '');
      const targetUriStr = decodeURIComponent(targetQuery);
      const targetUri = vscode.Uri.parse(targetUriStr);

      // 调用 VS Code 底层的 fs 读取文件（天然支持 file 协议和 vscode-vfs 远程协议）
      const contentBytes = await vscode.workspace.fs.readFile(targetUri);
      return Buffer.from(contentBytes).toString('utf8');
    } catch (e) {
      return `/* 无法读取该文件内容: ${e} */`;
    }
  }
}

export interface RecentProject {
  name: string;
  fsPath: string;
  timestamp: number;
  branch?: string;
}

export class RecentProjectsProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private stateKey = 'quickOps.recentProjectsHistory';

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
          this.readDirectory(data.id, data.fsPath);
          break;
        case 'openFile':
          // 🌟 接收前端传来的文件路径，并以只读模式打开
          this.openFileReadOnly(data.fsPath);
          break;
      }
    });

    this.updateWebview();
  }

  // ================= 🌟 核心：以只读模式打开文件 =================
  private async openFileReadOnly(fsPath: string) {
    try {
      const originalUri = fsPath.includes('://') ? vscode.Uri.parse(fsPath) : vscode.Uri.file(fsPath);

      // 构造自定义的只读 URI
      // Scheme 设为 quickops-ro 会触发我们上面定义的 ReadOnlyContentProvider
      // 保留原始的 path 是为了让 VS Code 能够根据后缀名（如 .js, .ts）正确进行语法高亮
      // 真实的地址存放在 query 参数中传递过去
      const roUri = vscode.Uri.parse(`quickops-ro:${originalUri.path}?target=${encodeURIComponent(originalUri.toString())}`);

      const doc = await vscode.workspace.openTextDocument(roUri);
      // preview: true 表示以预览标签页（斜体）打开，点击其他文件会覆盖当前标签页，体验更好
      await vscode.window.showTextDocument(doc, { preview: true });
    } catch (e) {
      vscode.window.showErrorMessage('无法打开该文件预览。');
    }
  }

  public async switchRemoteBranch(fsPath: string) {
    const match = fsPath.match(/vscode-vfs:\/\/(github|gitlab)\/([^/]+)\/([^/]+)/);
    if (!match) {
      vscode.window.showErrorMessage('无法解析该远程仓库地址，暂不支持获取该仓库的分支。');
      return;
    }

    const platform = match[1];
    const owner = match[2];
    const repo = match[3].split('?')[0];

    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `正在查询 ${repo} 的远程分支...`,
          cancellable: false,
        },
        async () => {
          return new Promise<any[]>((resolve, reject) => {
            let options: any = {};

            if (platform === 'github') {
              options = {
                hostname: 'api.github.com',
                path: `/repos/${owner}/${repo}/branches`,
                headers: { 'User-Agent': 'VSCode-QuickOps-Extension' },
              };
            } else if (platform === 'gitlab') {
              const encodedProjectPath = encodeURIComponent(`${owner}/${repo}`);
              options = {
                hostname: 'gitlab.com',
                path: `/api/v4/projects/${encodedProjectPath}/repository/branches`,
                headers: { 'User-Agent': 'VSCode-QuickOps-Extension' },
              };
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
                    reject(new Error(`API Limit or Error: ${res.statusCode}`));
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
              description: platform === 'gitlab' ? 'GitLab 远程分支' : 'GitHub 远程分支',
              branch: b.name,
            }));

            const selected = await vscode.window.showQuickPick(items, {
              placeHolder: '请选择要切换的远程分支',
            });

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
        },
      );
    } catch (e) {
      vscode.window.showErrorMessage('获取远程分支失败，可能是因为网络问题或该仓库为私有仓库/未授权。');
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

  private async readDirectory(id: string, fsPath: string) {
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

      this._view?.webview.postMessage({ type: 'readDirResult', id, children });
    } catch (e) {
      this._view?.webview.postMessage({ type: 'readDirResult', id, children: [] });
    }
  }

  private updateWebview() {
    if (!this._view) return;
    const projects = this.getRecentProjects();
    const currentUriStr = vscode.workspace.workspaceFolders?.[0]?.uri.toString() || '';
    this._view.webview.html = this.getHtmlForWebview(this._view.webview, projects, currentUriStr);
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

  private async insertProjectToHistory(name: string, uriStr: string) {
    let projects = this.getRecentProjects().filter((p) => p.fsPath !== uriStr);
    projects.unshift({ name, fsPath: uriStr, timestamp: Date.now() });

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
      prompt: '输入 GitHub/GitLab 仓库 (user/repo) 或 完整地址',
      ignoreFocusOut: true,
    });

    if (!input) return;

    let targetUriStr = '';
    let repoFullName = '';
    const trimmedInput = input.trim();

    const githubUrlMatch = trimmedInput.match(/github\.com\/([^/]+\/[^/.]+)/);
    const gitlabUrlMatch = trimmedInput.match(/gitlab\.com\/([^/]+\/[^/.]+)/);
    const simpleRepoMatch = trimmedInput.match(/^([^/]+\/[^/]+)$/);

    if (githubUrlMatch) {
      repoFullName = githubUrlMatch[1].replace(/\.git$/, '');
      targetUriStr = `vscode-vfs://github/${repoFullName}`;
    } else if (gitlabUrlMatch) {
      repoFullName = gitlabUrlMatch[1].replace(/\.git$/, '');
      targetUriStr = `vscode-vfs://gitlab/${repoFullName}`;
    } else if (simpleRepoMatch) {
      repoFullName = simpleRepoMatch[1].replace(/\.git$/, '');
      targetUriStr = `vscode-vfs://github/${repoFullName}`;
    } else {
      try {
        const uri = vscode.Uri.parse(trimmedInput);
        if (!uri.scheme || uri.scheme === 'file') throw new Error();
        targetUriStr = uri.toString();
        repoFullName = trimmedInput.split(/[/\\]/).pop() || 'Remote Project';
      } catch (e) {
        vscode.window.showErrorMessage('无效的远程地址格式');
        return;
      }
    }

    const projectName = await vscode.window.showInputBox({ value: repoFullName.split('/').pop() || repoFullName });

    if (projectName) {
      const uriStr = vscode.Uri.parse(targetUriStr).toString();
      await this.insertProjectToHistory(projectName, uriStr);
      const choice = await vscode.window.showInformationMessage(`已添加远程项目 ${projectName}，要现在打开吗？`, '在当前窗口打开', '在新窗口打开');
      if (choice) this.executeOpen(uriStr, choice === '在新窗口打开');
    }
  }

  private async executeOpen(uriStr: string, forceNewWindow: boolean, branch?: string) {
    try {
      let finalUriStr = uriStr;

      if (branch && (uriStr.startsWith('vscode-vfs://github') || uriStr.startsWith('vscode-vfs://gitlab'))) {
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

  private getHtmlForWebview(webview: vscode.Webview, projects: RecentProject[], currentUri: string) {
    const styleSrc = `https://cdnjs.cloudflare.com https://cdn.jsdelivr.net`;

    const listHtml = projects
      .map((p) => {
        const isCurrent = p.fsPath.split('?')[0] === currentUri.split('?')[0];
        const isRemote = p.fsPath.startsWith('vscode-vfs');
        const isGitlab = p.fsPath.includes('vscode-vfs://gitlab');
        const rootId = `root_${p.timestamp}`;

        let displayPath = p.fsPath;
        try {
          const uri = vscode.Uri.parse(p.fsPath);
          if (uri.scheme === 'file') {
            displayPath = uri.fsPath;
          } else {
            displayPath = p.fsPath.replace('vscode-vfs://github/', 'GitHub: ').replace('vscode-vfs://gitlab/', 'GitLab: ');
          }
        } catch (e) {}

        let iconClass = 'fa-solid fa-folder';
        if (isRemote) {
          iconClass = isGitlab ? 'fa-brands fa-gitlab' : 'fa-brands fa-github';
        } else if (isCurrent) {
          iconClass = 'fa-solid fa-folder-open';
        }

        const colorClass = isCurrent ? 'icon-opened' : 'icon-closed';
        const activeClass = isCurrent ? 'active' : '';
        const branchTagHtml = p.branch ? `<span class="branch-tag" title="当前分支: ${p.branch}"><i class="fa-solid fa-code-branch" style="font-size:10px;"></i> ${p.branch}</span>` : '';

        const safeFsPath = p.fsPath.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

        return `
        <li class="tree-node">
          <div class="project-item ${activeClass}" ondblclick="openProject('${safeFsPath}')">
            
            <div class="item-left">
              <div class="tree-chevron" onclick="toggleExpand('${rootId}', '${safeFsPath}', event)">
                <i id="chevron-right-${rootId}" class="fa-solid fa-chevron-right"></i>
                <i id="chevron-down-${rootId}" class="fa-solid fa-chevron-down" style="display:none"></i>
              </div>
              
              <div class="info" title="${p.fsPath}">
                <div class="title">
                  <i class="${iconClass} ${colorClass}"></i>
                  ${p.name}
                  ${branchTagHtml} </div>
                <div class="path">${displayPath}</div>
              </div>
            </div>

            <div class="item-actions">
              <button class="action-btn-icon open-btn" onclick="openCurrent('${safeFsPath}', event)" title="在当前窗口打开">
                <i class="fa-solid fa-arrow-right-to-bracket"></i>
              </button>
              
              ${
                isRemote
                  ? `
              <button class="action-btn-icon branch-btn" onclick="switchBranch('${safeFsPath}', event)" title="切换远程分支">
                <i class="fa-solid fa-code-branch"></i>
              </button>
              `
                  : ''
              }

              <button class="action-btn-icon delete-btn" onclick="removeProject('${safeFsPath}', event)" title="移除该记录">
                <i class="fa-solid fa-trash"></i>
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
          body { 
            padding: 0; margin: 0; color: var(--vscode-foreground); 
            font-family: var(--vscode-font-family); user-select: none;
            display: flex; flex-direction: column; height: 100vh;
            background: var(--vscode-sideBar-background);
          }
          .list-container { flex: 1; overflow-y: auto; padding-bottom: 20px;}
          ul { list-style: none; padding: 0; margin: 0; }
          
          .project-item { 
            display: flex; justify-content: space-between; align-items: center; 
            padding: 6px 12px 6px 4px; cursor: pointer; border-bottom: 1px solid var(--vscode-panel-border); 
            transition: background-color 0.1s;
          }
          .project-item:hover { background-color: var(--vscode-list-hoverBackground); }
          .project-item.active { background-color: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
          .project-item.active .path { color: var(--vscode-list-activeSelectionForeground); opacity: 0.8; }
          
          .item-left { display: flex; align-items: center; flex: 1; min-width: 0; gap: 4px; }
          
          .tree-chevron { 
            width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; 
            cursor: pointer; color: var(--vscode-icon-foreground); opacity: 0.8; border-radius: 4px; flex-shrink: 0;
          }
          .tree-chevron:hover { background: var(--vscode-toolbar-hoverBackground); opacity: 1; }
          .tree-chevron .fa-solid { font-size: 10px; transition: transform 0.1s; }
          .chevron-placeholder { width: 22px; height: 22px; flex-shrink: 0; }
          .project-item.active .tree-chevron { color: var(--vscode-list-activeSelectionForeground); }

          .info { overflow: hidden; display: flex; flex-direction: column; gap: 4px; flex: 1; }
          .title { font-size: 13px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: flex; align-items: center; gap: 8px; }
          .path { font-size: 11px; opacity: 0.6; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
          
          .branch-tag {
            font-size: 10px;
            background: rgba(128, 128, 128, 0.15);
            color: var(--vscode-descriptionForeground);
            padding: 2px 6px;
            border-radius: 10px;
            display: inline-flex;
            align-items: center;
            gap: 3px;
            font-weight: normal;
          }
          .project-item.active .branch-tag { 
            color: var(--vscode-list-activeSelectionForeground); 
            background: rgba(255, 255, 255, 0.2); 
          }

          .fa-solid, .fa-regular, .fa-brands { font-size: 14px; flex-shrink: 0; }
          .icon-opened { color: #5dade2 !important; opacity: 1 !important; } 
          .icon-closed { color: var(--vscode-icon-foreground); opacity: 0.8; } 
          .project-item.active .icon-closed { color: var(--vscode-list-activeSelectionForeground) !important; opacity: 1; }
          
          .item-actions { display: flex; align-items: center; gap: 2px; flex-shrink: 0; margin-left: 4px; }
          .action-btn-icon { background: none; border: none; color: var(--vscode-icon-foreground); cursor: pointer; padding: 6px; border-radius: 4px; display: flex; align-items: center; justify-content: center; transition: background-color 0.2s, color 0.2s, opacity 0.2s; }
          
          .open-btn { opacity: 0.4; }
          .open-btn:hover { opacity: 1; color: var(--vscode-foreground); background: var(--vscode-toolbar-hoverBackground); }
          .project-item:hover .open-btn { opacity: 0.8; }
          
          .branch-btn { opacity: 0.4; }
          .branch-btn:hover { opacity: 1; color: #3498db; background: var(--vscode-toolbar-hoverBackground); }
          .project-item:hover .branch-btn { opacity: 0.8; }

          .delete-btn { display: none; }
          .delete-btn:hover { color: var(--vscode-errorForeground); background: var(--vscode-toolbar-hoverBackground); }
          .project-item:hover .delete-btn { display: flex; }

          .project-item.active .action-btn-icon { color: var(--vscode-list-activeSelectionForeground); opacity: 0.7; }
          .project-item.active .action-btn-icon:hover { opacity: 1; background: rgba(255, 255, 255, 0.2); }
          .action-btn-icon .fa-solid { font-size: 13px; }

          /* ================= 🌟 文件树列表样式调整 ================= */
          .tree-children { padding-left: 14px; margin-left: 12px; border-left: 1px solid var(--vscode-tree-indentGuidesStroke); }
          
          /* 🌟 将 padding 缩小至 2px 0，减小上下间隙；使用 align-items: center 完美居中 */
          .sub-item { display: flex; align-items: center; gap: 4px; padding: 2px 0; font-size: 13px; color: var(--vscode-foreground); cursor: default; }
          .sub-item:hover { background-color: var(--vscode-list-hoverBackground); }
          .sub-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; opacity: 0.9;}
          
          /* 🌟 给 icon 固定 16px 的宽度，并居中排布，保证不同文件图标不会把文字挤偏 */
          .sub-icon { opacity: 0.8; font-size: 13px; margin: 0; width: 16px; text-align: center; display: inline-block; flex-shrink: 0; }
          
          /* 🌟 各类文件后缀专属颜色 */
          .file-icon-js { color: #f1e05a; }       /* JS 黄色 */
          .file-icon-ts { color: #3178c6; }       /* TS 蓝色 */
          .file-icon-vue { color: #41b883; }      /* Vue 绿色 */
          .file-icon-html { color: #e34c26; }     /* HTML 橙色 */
          .file-icon-css { color: #563d7c; }      /* CSS 紫色 */
          .file-icon-json { color: #cbcb41; }     /* JSON 黄绿色 */
          .file-icon-md { color: #5dade2; }       /* Markdown 浅蓝 */
          .file-icon-img { color: #a074c4; }      /* 图片 淡紫 */
          .file-icon-default { color: var(--vscode-symbolIcon-fileForeground, #999); } /* 默认颜色 */

          .empty-node { font-size: 12px; opacity: 0.5; padding: 4px 12px; font-style: italic; }

          .empty-state { padding: 30px 20px; text-align: center; }
          .empty-text { opacity: 0.6; font-size: 13px; margin-bottom: 20px; }
          .bottom-bar { padding: 10px; border-top: 1px solid var(--vscode-panel-border); display: flex; gap: 8px; background: var(--vscode-sideBar-background); flex-shrink: 0; }
          .action-btn { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 6px 12px; border-radius: 2px; cursor: pointer; font-size: 12px; width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px; margin-bottom: 8px; transition: background 0.2s; }
          .action-btn:hover { background: var(--vscode-button-hoverBackground); }
          .action-btn.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
          .action-btn.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
          .bottom-bar .action-btn { margin-bottom: 0; }
        </style>
      </head>
      <body>
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
              : `<ul>${listHtml}</ul>`
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
          
          function openProject(path) { vscode.postMessage({ type: 'openProject', fsPath: path }); }
          function openCurrent(path, event) { event.stopPropagation(); vscode.postMessage({ type: 'openProjectCurrent', fsPath: path }); }
          function removeProject(path, event) { event.stopPropagation(); vscode.postMessage({ type: 'removeProject', fsPath: path }); }
          function addLocal() { vscode.postMessage({ type: 'addLocal' }); }
          function addRemote() { vscode.postMessage({ type: 'addRemote' }); }
          
          function openFile(path, event) {
            event.stopPropagation();
            vscode.postMessage({ type: 'openFile', fsPath: path });
          }

          function switchBranch(path, event) { 
            event.stopPropagation(); 
            vscode.postMessage({ type: 'switchBranch', fsPath: path }); 
          }

          function toggleExpand(id, path, event) {
            event.stopPropagation();
            
            const childrenContainer = document.getElementById('children-' + id);
            const rightIcon = document.getElementById('chevron-right-' + id);
            const downIcon = document.getElementById('chevron-down-' + id);

            if (childrenContainer.style.display === 'none') {
              rightIcon.style.display = 'none';
              downIcon.style.display = 'inline-block';
              childrenContainer.style.display = 'block';

              if (!childrenContainer.hasChildNodes()) {
                childrenContainer.innerHTML = '<div class="empty-node"><i class="fa-solid fa-spinner fa-spin"></i> 加载中...</div>';
                vscode.postMessage({ type: 'readDir', id: id, fsPath: path });
              }
            } else {
              rightIcon.style.display = 'inline-block';
              downIcon.style.display = 'none';
              childrenContainer.style.display = 'none';
            }
          }

          // 🌟 根据文件名返回不同的 FontAwesome 图标和预设的颜色类名
          function getFileIcon(filename) {
            const extMatch = filename.match(/\\.([^.]+)$/);
            const ext = extMatch ? extMatch[1].toLowerCase() : '';
            
            switch(ext) {
              case 'js': case 'jsx': return 'fa-brands fa-js file-icon-js';
              case 'ts': case 'tsx': return 'fa-brands fa-js file-icon-ts'; // FA目前没有专门的TS图标，用JS图标替代但给蓝色
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
            if (message.type === 'readDirResult') {
              const container = document.getElementById('children-' + message.id);
              if (!container) return;

              if (message.children.length === 0) {
                container.innerHTML = '<div class="empty-node">（空文件夹/无读取权限）</div>';
                return;
              }

              let html = '';
              message.children.forEach((child, index) => {
                const childId = message.id + '_' + index;
                
                // 🌟 判断是文件夹还是具体文件，调用 getFileIcon 函数
                const iconClass = child.isFolder 
                  ? 'fa-solid fa-folder icon-closed sub-icon' 
                  : getFileIcon(child.name) + ' sub-icon';
                  
                const safeChildPath = child.path.replace(/\\\\/g, '\\\\\\\\').replace(/'/g, "\\\\'");
                
                const clickAttr = child.isFolder 
                  ? '' 
                  : 'onclick="openFile(\\'' + safeChildPath + '\\', event)" style="cursor:pointer;" title="点击以只读模式预览"';
                
                html += \`
                  <div class="tree-node">
                    <div class="sub-item" \${clickAttr}>
                      \${child.isFolder 
                        ? \`<div class="tree-chevron" onclick="toggleExpand('\${childId}', '\${safeChildPath}', event)">
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
          });
        </script>
      </body>
      </html>`;
  }
}
