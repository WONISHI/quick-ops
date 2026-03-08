import * as vscode from 'vscode';

export interface RecentProject {
  name: string;
  fsPath: string;
  timestamp: number;
}

export class RecentProjectsProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private stateKey = 'quickOps.recentProjectsHistory';

  constructor(private context: vscode.ExtensionContext) {
    this.recordCurrentProject();
  }

  // ================= 🌟 Webview 核心初始化 =================
  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri]
    };

    webviewView.webview.onDidReceiveMessage(async data => {
      switch (data.type) {
        case 'openProject': 
          this.openProject(data.fsPath); 
          break;
        case 'openProjectCurrent': 
          this.executeOpen(data.fsPath, false); 
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
        case 'readDir':
          // 🌟 核心：监听网页端发来的读取目录请求
          this.readDirectory(data.id, data.fsPath);
          break;
      }
    });

    this.updateWebview();
  }

  // 🌟 核心新增：按需读取目录内容（支持本地和远程VFS）
  private async readDirectory(id: string, fsPath: string) {
    try {
      const uri = fsPath.includes('://') ? vscode.Uri.parse(fsPath) : vscode.Uri.file(fsPath);
      const entries = await vscode.workspace.fs.readDirectory(uri);
      
      // 处理并排序：文件夹排在前面，文件排在后面
      const children = entries
        .map(([name, type]) => {
          // 判断是否为文件夹 (Directory = 2, File = 1)
          const isFolder = (type & vscode.FileType.Directory) !== 0;
          // 生成子项的完整路径
          const childUriStr = vscode.Uri.joinPath(uri, name).toString();
          return { name, isFolder, path: childUriStr };
        })
        // 过滤掉 node_modules 和 .git 以防卡顿干扰，如果不需要可以去掉
        .filter(c => c.name !== 'node_modules' && c.name !== '.git')
        .sort((a, b) => {
          if (a.isFolder === b.isFolder) return a.name.localeCompare(b.name);
          return a.isFolder ? -1 : 1;
        });

      // 将读取结果发回给网页端
      this._view?.webview.postMessage({ type: 'readDirResult', id, children });
    } catch (e) {
      // 捕获异常（如权限不足或远程未连接），返回空数组
      this._view?.webview.postMessage({ type: 'readDirResult', id, children: [] });
    }
  }

  private updateWebview() {
    if (!this._view) return;
    const projects = this.getRecentProjects();
    const currentUriStr = vscode.workspace.workspaceFolders?.[0]?.uri.toString() || '';
    this._view.webview.html = this.getHtmlForWebview(projects, currentUriStr);
  }

  // ================= 🌟 数据存取逻辑 =================
  private getRecentProjects(): RecentProject[] {
    return this.context.globalState.get<RecentProject[]>(this.stateKey) || [];
  }

  private async recordCurrentProject() {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return;

    const currentUriStr = folders[0].uri.toString(); 
    let projects = this.getRecentProjects().filter(p => p.fsPath !== currentUriStr);

    projects.unshift({ name: folders[0].name, fsPath: currentUriStr, timestamp: Date.now() });
    if (projects.length > 50) projects = projects.slice(0, 50);

    await this.context.globalState.update(this.stateKey, projects);
    if(this._view) this.updateWebview();
  }

  private async insertProjectToHistory(name: string, uriStr: string) {
    let projects = this.getRecentProjects().filter(p => p.fsPath !== uriStr);
    projects.unshift({ name, fsPath: uriStr, timestamp: Date.now() });
    
    if (projects.length > 50) projects = projects.slice(0, 50);
    await this.context.globalState.update(this.stateKey, projects);
    this.updateWebview();
  }

  // ================= 🌟 添加与交互逻辑 =================
  public async addLocalProject() {
    const uri = await vscode.window.showOpenDialog({
      canSelectFiles: false, canSelectFolders: true, canSelectMany: false,
      openLabel: '添加到项目列表'
    });

    if (uri && uri[0]) {
      const folderUri = uri[0];
      const folderName = folderUri.path.split(/[\\/]/).pop() || '本地项目';
      await this.insertProjectToHistory(folderName, folderUri.toString());
    }
  }

  public async addRemoteProject() {
    const input = await vscode.window.showInputBox({
      prompt: '输入 GitHub 仓库 (user/repo) 或 完整地址',
      ignoreFocusOut: true
    });

    if (!input) return;

    let targetUriStr = '';
    let repoFullName = '';
    const trimmedInput = input.trim();
    
    const githubUrlMatch = trimmedInput.match(/github\.com\/([^/]+\/[^/.]+)/);
    const simpleRepoMatch = trimmedInput.match(/^([^/]+\/[^/]+)$/);

    if (githubUrlMatch || simpleRepoMatch) {
      repoFullName = (githubUrlMatch ? githubUrlMatch[1] : simpleRepoMatch![1]).replace(/\.git$/, '');
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

  private async executeOpen(uriStr: string, forceNewWindow: boolean) {
    try {
      const uri = vscode.Uri.parse(uriStr);
      await vscode.commands.executeCommand('workbench.view.explorer');
      await vscode.commands.executeCommand('vscode.openFolder', uri, forceNewWindow);
    } catch (e) {
      vscode.window.showErrorMessage('无法打开该仓库，请确保支持该协议。');
    }
  }

  public async openProject(fsPath: string) {
    const choice = await vscode.window.showInformationMessage(
      '准备打开项目，请选择打开方式：', { modal: false }, '在当前窗口打开', '在新窗口打开'
    );
    if (choice) this.executeOpen(fsPath, choice === '在新窗口打开');
  }

  public async removeProjectByPath(fsPath: string) {
    let projects = this.getRecentProjects().filter(p => p.fsPath !== fsPath);
    await this.context.globalState.update(this.stateKey, projects);
    this.updateWebview();
  }

  public async clearAll() {
    await this.context.globalState.update(this.stateKey, []);
    this.updateWebview();
  }

  // ================= 🌟 HTML 渲染核心 =================
  private getHtmlForWebview(projects: RecentProject[], currentUri: string) {
    
    const listHtml = projects.map(p => {
      const isCurrent = p.fsPath === currentUri;
      const isRemote = p.fsPath.startsWith('vscode-vfs');
      const rootId = `root_${p.timestamp}`;
      
      let displayPath = p.fsPath;
      try {
        const uri = vscode.Uri.parse(p.fsPath);
        displayPath = uri.scheme === 'file' ? uri.fsPath : p.fsPath.replace('vscode-vfs://github/', 'github: ');
      } catch (e) {}

      let iconClass = isRemote ? 'fa-brands fa-github' : (isCurrent ? 'fa-solid fa-folder-open' : 'fa-solid fa-folder');
      const colorClass = isCurrent ? 'icon-opened' : 'icon-closed';
      const activeClass = isCurrent ? 'active' : '';

      // 🌟 项目根节点包裹在 tree-node 中，加入左侧展开图标
      return `
        <li class="tree-node">
          <div class="project-item ${activeClass}" ondblclick="openProject('${p.fsPath}')">
            
            <div class="item-left">
              <div class="tree-chevron" onclick="toggleExpand('${rootId}', '${p.fsPath}', event)">
                <i id="chevron-right-${rootId}" class="fa-solid fa-chevron-right"></i>
                <i id="chevron-down-${rootId}" class="fa-solid fa-chevron-down" style="display:none"></i>
              </div>
              
              <div class="info" title="${p.fsPath}">
                <div class="title">
                  <i class="${iconClass} ${colorClass}"></i>
                  ${p.name}
                </div>
                <div class="path">${displayPath}</div>
              </div>
            </div>

            <div class="item-actions">
              <button class="action-btn-icon open-btn" onclick="openCurrent('${p.fsPath}', event)" title="在当前窗口打开">
                <i class="fa-solid fa-arrow-right-to-bracket"></i>
              </button>
              <button class="action-btn-icon delete-btn" onclick="removeProject('${p.fsPath}', event)" title="移除该记录">
                <i class="fa-solid fa-trash"></i>
              </button>
            </div>
          </div>
          
          <div class="tree-children" id="children-${rootId}" style="display:none;"></div>
        </li>
      `;
    }).join('');

    return `<!DOCTYPE html>
      <html lang="zh-CN">
      <head>
        <meta charset="UTF-8">
        <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet" />
        <style>
          body { 
            padding: 0; margin: 0; color: var(--vscode-foreground); 
            font-family: var(--vscode-font-family); user-select: none;
            display: flex; flex-direction: column; height: 100vh;
            background: var(--vscode-sideBar-background);
          }
          .list-container { flex: 1; overflow-y: auto; padding-bottom: 20px;}
          ul { list-style: none; padding: 0; margin: 0; }
          
          /* 项目行样式 */
          .project-item { 
            display: flex; justify-content: space-between; align-items: center; 
            padding: 6px 12px 6px 4px; cursor: pointer; border-bottom: 1px solid var(--vscode-panel-border); 
            transition: background-color 0.1s;
          }
          .project-item:hover { background-color: var(--vscode-list-hoverBackground); }
          .project-item.active { background-color: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
          .project-item.active .path { color: var(--vscode-list-activeSelectionForeground); opacity: 0.8; }
          
          .item-left { display: flex; align-items: center; flex: 1; min-width: 0; gap: 4px; }
          
          /* 展开折叠按钮 */
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
          .path { font-size: 11px; opacity: 0.6; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding-left: 22px; }
          
          .fa-solid, .fa-regular, .fa-brands { font-size: 14px; flex-shrink: 0; }
          .icon-opened { color: #5dade2 !important; opacity: 1 !important; } 
          .icon-closed { color: var(--vscode-icon-foreground); opacity: 0.8; } 
          .project-item.active .icon-closed { color: var(--vscode-list-activeSelectionForeground) !important; opacity: 1; }
          
          /* 右侧操作按钮 */
          .item-actions { display: flex; align-items: center; gap: 4px; flex-shrink: 0; margin-left: 8px; }
          .action-btn-icon { background: none; border: none; color: var(--vscode-icon-foreground); cursor: pointer; padding: 6px; border-radius: 4px; display: flex; align-items: center; justify-content: center; }
          .open-btn { opacity: 0.4; }
          .open-btn:hover { opacity: 1; color: var(--vscode-foreground); background: var(--vscode-toolbar-hoverBackground); }
          .project-item:hover .open-btn { opacity: 0.8; }
          .delete-btn { display: none; }
          .delete-btn:hover { color: var(--vscode-errorForeground); background: var(--vscode-toolbar-hoverBackground); }
          .project-item:hover .delete-btn { display: flex; }
          .project-item.active .action-btn-icon { color: var(--vscode-list-activeSelectionForeground); opacity: 0.7; }
          .project-item.active .action-btn-icon:hover { opacity: 1; background: rgba(255, 255, 255, 0.2); }
          .action-btn-icon .fa-solid { font-size: 13px; }

          /* 🌟 子级文件树样式 */
          .tree-children { 
            padding-left: 14px; margin-left: 12px;
            border-left: 1px solid var(--vscode-tree-indentGuidesStroke);
          }
          
          /* 子项没有任何点击交互反应，仅仅展示 */
          .sub-item { 
            display: flex; align-items: center; gap: 4px; padding: 4px 0; 
            font-size: 13px; color: var(--vscode-foreground); cursor: default;
          }
          .sub-item:hover { background-color: var(--vscode-list-hoverBackground); }
          
          .sub-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; opacity: 0.9;}
          .sub-icon { opacity: 0.8; font-size: 13px; margin: 0 4px; }
          .file-icon { color: var(--vscode-symbolIcon-fileForeground, #999); }
          .empty-node { font-size: 12px; opacity: 0.5; padding: 4px 12px; font-style: italic; }

          /* 底部常驻栏 */
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
          ${projects.length === 0 ? `
            <div class="empty-state">
              <div class="empty-text">暂无项目记录，请添加：</div>
              <button class="action-btn" onclick="addLocal()"><i class="fa-solid fa-folder-plus"></i> 添加本地项目</button>
              <button class="action-btn secondary" onclick="addRemote()"><i class="fa-brands fa-github"></i> 添加远程仓库</button>
            </div>
          ` : `<ul>${listHtml}</ul>`}
        </div>
        ${projects.length > 0 ? `
          <div class="bottom-bar">
            <button class="action-btn" onclick="addLocal()"><i class="fa-solid fa-folder-plus"></i> 添加本地</button>
            <button class="action-btn secondary" onclick="addRemote()"><i class="fa-brands fa-github"></i> 添加远程</button>
          </div>
        ` : ''}
        
        <script>
          const vscode = acquireVsCodeApi();
          
          // 基础交互
          function openProject(path) { vscode.postMessage({ type: 'openProject', fsPath: path }); }
          function openCurrent(path, event) { event.stopPropagation(); vscode.postMessage({ type: 'openProjectCurrent', fsPath: path }); }
          function removeProject(path, event) { event.stopPropagation(); vscode.postMessage({ type: 'removeProject', fsPath: path }); }
          function addLocal() { vscode.postMessage({ type: 'addLocal' }); }
          function addRemote() { vscode.postMessage({ type: 'addRemote' }); }

          // 🌟 核心：展开/收起文件夹逻辑
          function toggleExpand(id, path, event) {
            event.stopPropagation(); // 阻止双击等其他事件
            
            const childrenContainer = document.getElementById('children-' + id);
            const rightIcon = document.getElementById('chevron-right-' + id);
            const downIcon = document.getElementById('chevron-down-' + id);

            // 如果当前是收起状态
            if (childrenContainer.style.display === 'none') {
              rightIcon.style.display = 'none';
              downIcon.style.display = 'inline-block';
              childrenContainer.style.display = 'block';

              // 如果容器内没有内容，说明还没加载过，发送请求加载
              if (!childrenContainer.hasChildNodes()) {
                childrenContainer.innerHTML = '<div class="empty-node"><i class="fa-solid fa-spinner fa-spin"></i> 加载中...</div>';
                vscode.postMessage({ type: 'readDir', id: id, fsPath: path });
              }
            } else {
              // 否则执行收起操作
              rightIcon.style.display = 'inline-block';
              downIcon.style.display = 'none';
              childrenContainer.style.display = 'none';
            }
          }

          // 🌟 核心：监听并渲染回传的文件列表数据
          window.addEventListener('message', event => {
            const message = event.data;
            if (message.type === 'readDirResult') {
              const container = document.getElementById('children-' + message.id);
              if (!container) return;

              // 处理空文件夹的情况
              if (message.children.length === 0) {
                container.innerHTML = '<div class="empty-node">（空文件夹）</div>';
                return;
              }

              // 递归渲染子项
              let html = '';
              message.children.forEach((child, index) => {
                const childId = message.id + '_' + index;
                const iconClass = child.isFolder ? 'fa-solid fa-folder icon-closed sub-icon' : 'fa-regular fa-file-code file-icon sub-icon';
                
                html += \`
                  <div class="tree-node">
                    <div class="sub-item">
                      \${child.isFolder 
                        ? \`<div class="tree-chevron" onclick="toggleExpand('\${childId}', '\${child.path}', event)">
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