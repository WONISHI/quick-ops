import * as vscode from 'vscode';
import { RecentProject } from '../providers/RecentProjectsProvider';

// ================= 🌟 辅助函数：生成 Nonce 随机字符串 =================
function getNonce() {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

// ================= 🌟 HTML 渲染核心抽离 =================
export function getRecentProjectsHtml(webview: vscode.Webview, projects: RecentProject[], currentUri: string, lastOpenedPath: string): string {
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
    const safeProjName = currentProject.name.replace(/'/g, "\\'");
    const safeCustomName = (currentProject.customName || '').replace(/'/g, "\\'");
    const platformStr = currentProject.platform || 'github';
    const customDomainStr = currentProject.customDomain || '';

    const finalDisplayPath = currentProject.customName ? `${currentProject.name} • ${displayPath}` : displayPath;
    const searchStr = `${displayTitle} ${currentProject.name} ${finalDisplayPath} ${currentProject.fsPath}`.toLowerCase().replace(/'/g, "\\'");

    currentProjectHtml = `
      <div class="searchable-item" data-search="${searchStr}">
        <div class="active-top-project" title="当前窗口正在运行的项目" 
             oncontextmenu="showContextMenu(event, '${safeFsPath}', ${isRemote}, '${safeProjName}', '${safeCustomName}', '${platformStr}', '${customDomainStr}', true)">
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
      const isJustOpened = p.fsPath === lastOpenedPath;

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

      const safeTitleForClick = displayTitle.replace(/'/g, "\\'");

      return `
      <li class="tree-node searchable-item" data-search="${searchStr}">
        <div class="project-item ${justOpenedClass}" 
             ondblclick="openProject('${safeFsPath}')" 
             oncontextmenu="showContextMenu(event, '${safeFsPath}', ${isRemote}, '${safeProjName}', '${safeCustomName}', '${platformStr}', '${customDomainStr}', false)"
             title="${isJustOpened ? '刚刚在此窗口中唤起过' : ''}">
          
          <div class="item-left clickable-expand" onclick="toggleExpand('${rootId}', '${safeFsPath}', '${safeTitleForClick}', event)">
            <div class="tree-chevron">
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
        
        .clickable-expand { cursor: pointer; }
        .clickable-expand:hover .tree-chevron { background: var(--vscode-toolbar-hoverBackground); opacity: 1; }

        .tree-chevron, .chevron-placeholder { width: 14px; height: 20px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: background 0.2s; }
        .tree-chevron { color: var(--vscode-icon-foreground); opacity: 0.8; border-radius: 4px; }
        .tree-chevron .fa-solid { font-size: 10px; transition: transform 0.1s; }

        .project-icon, .sub-icon { width: 16px; text-align: center; margin-right: 6px; flex-shrink: 0; display: inline-block; font-size: 14px; }

        .info { overflow: hidden; display: flex; flex-direction: column; flex: 1; padding-top: 2px; padding-bottom: 2px; pointer-events: none; }
        .title { font-size: 13px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: flex; align-items: center; pointer-events: auto; }
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
        .sub-item.clickable-sub { cursor: pointer; }
        .sub-item.clickable-sub:hover .tree-chevron { background: var(--vscode-toolbar-hoverBackground); opacity: 1; }
        .sub-item:hover { background-color: var(--vscode-list-hoverBackground); }
        .sub-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; opacity: 0.9; pointer-events: none;}
        
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
        #context-menu .fa-solid, #context-menu .fa-regular { width: 14px; text-align: center; opacity: 0.8; }
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
        let activeContextMenuProject = '';

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

        let clickTimer = null;
        const DELAY = 250;

        function openProject(path) { 
           clearTimeout(clickTimer);
           vscode.postMessage({ type: 'openProject', fsPath: path }); 
        }

        function openCurrent(path, event) { event.stopPropagation(); vscode.postMessage({ type: 'openProjectCurrent', fsPath: path }); }
        function addLocal() { vscode.postMessage({ type: 'addLocal' }); }
        function addRemote() { vscode.postMessage({ type: 'addRemote' }); }
        
        function openFile(path, projectName, event) {
          event.stopPropagation();
          vscode.postMessage({ type: 'openFile', fsPath: path, projectName: projectName });
        }

        function toggleExpand(id, path, projectName, event) {
          event.stopPropagation();
          const target = event.currentTarget;
          
          clearTimeout(clickTimer);
          clickTimer = setTimeout(() => {
              const childrenContainer = document.getElementById('children-' + id);
              const rightIcon = document.getElementById('chevron-right-' + id);
              const downIcon = document.getElementById('chevron-down-' + id);

              if (childrenContainer.style.display === 'none') {
                rightIcon.style.display = 'none';
                downIcon.style.display = 'inline-block';
                childrenContainer.style.display = 'block';

                const isRemote = path.startsWith('vscode-vfs://') || path.startsWith('http');

                if (!childrenContainer.hasChildNodes()) {
                  childrenContainer.innerHTML = '<div class="empty-node"><i class="fa-solid fa-spinner fa-spin"></i> 加载中...</div>';
                  vscode.postMessage({ type: 'readDir', id: id, fsPath: path, projectName: projectName });
                } else if (isRemote) {
                  downIcon.classList.remove('fa-chevron-down');
                  downIcon.classList.add('fa-spinner', 'fa-spin');
                  vscode.postMessage({ type: 'readDir', id: id, fsPath: path, projectName: projectName });
                }
              } else {
                rightIcon.style.display = 'inline-block';
                downIcon.style.display = 'none';
                childrenContainer.style.display = 'none';
              }
          }, DELAY);
        }

        // ================= 🌟 原本：针对项目根节点的右键菜单 =================
        function showContextMenu(event, path, isRemote, originalName, customName, platform, customDomain, isActiveProject) {
          event.preventDefault();
          event.stopPropagation();
          
          activeContextMenuPath = path;
          activeContextMenuPlatform = platform;
          activeContextMenuDomain = customDomain;

          const menu = document.getElementById('context-menu');
          const list = document.getElementById('context-menu-list');
          list.innerHTML = '';

          const escOriginalName = originalName.replace(/\\\\/g, '\\\\\\\\').replace(/'/g, "\\\\'");
          const escCustomName = customName ? customName.replace(/\\\\/g, '\\\\\\\\').replace(/'/g, "\\\\'") : '';
          const escPath = path.replace(/\\\\/g, '\\\\\\\\').replace(/'/g, "\\\\'");

          list.innerHTML += \`<li onclick="handleMenuClick('openInNewWindow')"><i class="fa-solid fa-arrow-up-right-from-square"></i> 在新窗口打开</li>\`;
          list.innerHTML += \`<div class="menu-separator"></div>\`;
          
          list.innerHTML += \`<li onclick="handleMenuClick('edit')"><i class="fa-solid fa-pen"></i> 编辑项目名称</li>\`;
          list.innerHTML += \`<li onclick="handleMenuClick('changeAddress')"><i class="fa-solid fa-location-dot"></i> 更换地址</li>\`;
          
          if (isRemote) {
            list.innerHTML += \`<li onclick="handleMenuClick('switchBranch')"><i class="fa-solid fa-code-branch"></i> 切换分支</li>\`;
          }

          list.innerHTML += \`<div class="menu-separator"></div>\`;

          list.innerHTML += \`<li onclick="handleMenuClick('copyText', '\${escOriginalName}')"><i class="fa-regular fa-copy"></i> 复制文件名</li>\`;
          
          if (customName) {
             list.innerHTML += \`<li onclick="handleMenuClick('copyText', '\${escCustomName}')"><i class="fa-solid fa-copy"></i> 复制项目名</li>\`;
          }
          
          list.innerHTML += \`<li onclick="handleMenuClick('copyText', '\${escPath}')"><i class="fa-solid fa-link"></i> 复制地址链接</li>\`;

          if (isRemote) {
            list.innerHTML += \`<li onclick="handleMenuClick('openLink', '\${escPath}')"><i class="fa-solid fa-globe"></i> 在浏览器中打开</li>\`;
          } else {
            list.innerHTML += \`<li onclick="handleMenuClick('revealInExplorer', '\${escPath}')"><i class="fa-regular fa-folder-open"></i> 在访达/资源管理器中显示</li>\`;
          }

          // 🌟 修改点 1：如果是当前正在打开的项目，就不显示删除按钮
          if (!isActiveProject) {
            list.innerHTML += \`<div class="menu-separator"></div>\`;
            list.innerHTML += \`<li onclick="handleMenuClick('delete')" style="color: var(--vscode-errorForeground);"><i class="fa-solid fa-trash"></i> 移除该项目</li>\`;
          }

          let x = event.pageX;
          let y = event.pageY;
          
          menu.style.display = 'block';
          if (x + menu.offsetWidth > window.innerWidth) x = window.innerWidth - menu.offsetWidth;
          if (y + menu.offsetHeight > window.innerHeight) y = window.innerHeight - menu.offsetHeight;

          menu.style.left = x + 'px';
          menu.style.top = y + 'px';
        }

        // ================= 🌟 新增：针对子文件/子文件夹的右键菜单 =================
        function showSubItemContextMenu(event, path, name, isFolder, projectName) {
          event.preventDefault();
          event.stopPropagation();
          
          activeContextMenuPath = path;
          activeContextMenuProject = projectName;

          const menu = document.getElementById('context-menu');
          const list = document.getElementById('context-menu-list');
          list.innerHTML = '';

          const escName = name.replace(/\\\\/g, '\\\\\\\\').replace(/'/g, "\\\\'");
          const escPath = path.replace(/\\\\/g, '\\\\\\\\').replace(/'/g, "\\\\'");
          
          const isRemote = path.startsWith('vscode-vfs') || path.startsWith('http');

          // 🌟 修改点 2：如果点击的不是文件夹而是文件，则显示“在侧边打开”
          if (!isFolder) {
             list.innerHTML += \`<li onclick="handleMenuClick('openFileToSide')"><i class="fa-solid fa-columns"></i> 在侧边打开</li>\`;
             list.innerHTML += \`<div class="menu-separator"></div>\`;
          }

          list.innerHTML += \`<li onclick="handleMenuClick('copyText', '\${escName}')"><i class="fa-regular fa-copy"></i> 复制名称</li>\`;
          list.innerHTML += \`<li onclick="handleMenuClick('copyText', '\${escPath}')"><i class="fa-solid fa-link"></i> 复制路径</li>\`;

          if (!isRemote) {
             list.innerHTML += \`<div class="menu-separator"></div>\`;
             list.innerHTML += \`<li onclick="handleMenuClick('revealInExplorer', '\${escPath}')"><i class="fa-regular fa-folder-open"></i> 在访达/资源管理器中显示</li>\`;
          }

          let x = event.pageX;
          let y = event.pageY;
          
          menu.style.display = 'block';
          if (x + menu.offsetWidth > window.innerWidth) x = window.innerWidth - menu.offsetWidth;
          if (y + menu.offsetHeight > window.innerHeight) y = window.innerHeight - menu.offsetHeight;

          menu.style.left = x + 'px';
          menu.style.top = y + 'px';
        }

        // ================= 🌟 隐藏右键菜单的全局处理 =================
        function hideContextMenu() {
          const menu = document.getElementById('context-menu');
          if (menu) menu.style.display = 'none';
        }

        document.addEventListener('click', hideContextMenu);
        window.addEventListener('blur', hideContextMenu);

        const listContainer = document.querySelector('.list-container');
        if (listContainer) {
          listContainer.addEventListener('scroll', hideContextMenu);
        }

        function handleMenuClick(action, payload) {
          document.getElementById('context-menu').style.display = 'none';
          switch(action) {
            case 'openInNewWindow':
              vscode.postMessage({ type: 'openInNewWindow', fsPath: activeContextMenuPath });
              break;
            case 'edit':
              vscode.postMessage({ type: 'editProjectName', fsPath: activeContextMenuPath });
              break;
            case 'changeAddress':
              vscode.postMessage({ type: 'changeAddress', fsPath: activeContextMenuPath });
              break;
            case 'switchBranch':
              vscode.postMessage({ type: 'switchBranch', fsPath: activeContextMenuPath });
              break;
            case 'copyText':
              vscode.postMessage({ type: 'copyToClipboard', text: payload });
              break;
            case 'openLink':
              vscode.postMessage({ type: 'openExternalLink', fsPath: payload, platform: activeContextMenuPlatform, customDomain: activeContextMenuDomain });
              break;
            case 'revealInExplorer':
              vscode.postMessage({ type: 'revealInExplorer', fsPath: payload });
              break;
            case 'delete':
              vscode.postMessage({ type: 'removeProject', fsPath: activeContextMenuPath });
              break;
            // 🌟 修改点 3：捕获新增的“在侧边打开”事件，并带上文件路径和项目名
            case 'openFileToSide':
              vscode.postMessage({ type: 'openFileToSide', fsPath: activeContextMenuPath, projectName: activeContextMenuProject });
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
                
                const escNameForMenu = child.name.replace(/\\\\/g, '\\\\\\\\').replace(/'/g, "\\\\'");
                
                if(child.isFolder) {
                   html += \`
                    <div class="tree-node">
                      <div class="sub-item clickable-sub" 
                           onclick="toggleExpand('\${childId}', '\${safeChildPath}', '\${safeProjName}', event)"
                           oncontextmenu="showSubItemContextMenu(event, '\${safeChildPath}', '\${escNameForMenu}', true, '\${safeProjName}')">
                        <div class="tree-chevron">
                          <i id="chevron-right-\${childId}" class="fa-solid fa-chevron-right"></i>
                          <i id="chevron-down-\${childId}" class="fa-solid fa-chevron-down" style="display:none"></i>
                        </div>
                        <i class="\${iconClass}"></i>
                        <span class="sub-name">\${child.name}</span>
                      </div>
                      <div class="tree-children" id="children-\${childId}" style="display:none;"></div>
                    </div>
                  \`;
                } else {
                   html += \`
                    <div class="tree-node">
                      <div class="sub-item" 
                           onclick="openFile('\${safeChildPath}', '\${safeProjName}', event)" 
                           oncontextmenu="showSubItemContextMenu(event, '\${safeChildPath}', '\${escNameForMenu}', false, '\${safeProjName}')"
                           style="cursor:pointer;" title="点击以只读模式预览">
                        <div class="chevron-placeholder"></div>
                        <i class="\${iconClass}"></i>
                        <span class="sub-name">\${child.name}</span>
                      </div>
                    </div>
                  \`;
                }
              });
              
              container.innerHTML = html;
            }

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
