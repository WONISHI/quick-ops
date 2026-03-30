import React, { useEffect, useState, useMemo, useRef } from 'react';
import { vscode } from '../utils/vscode';

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { 
  faMagnifyingGlass, faFolderOpen, faFolderPlus, faCodeBranch, 
  faChevronRight, faChevronDown, faArrowRightToBracket, faFolder, 
  faArrowUpRightFromSquare, faPen, faLocationDot, faRotateRight, 
  faLink, faGlobe, faTrash, faColumns, faCodeCompare, faSpinner, 
  faFileCode
} from '@fortawesome/free-solid-svg-icons';
import { 
  faCopy, faSquareCheck, faClone, faImage, faFolderOpen as faFolderOpenReg 
} from '@fortawesome/free-regular-svg-icons';
import { 
  faGithub, faGitlab, faJs, faVuejs, faHtml5, faCss3Alt, faMarkdown 
} from '@fortawesome/free-brands-svg-icons';

// ---------------- 辅助函数 ----------------
function getDisplayPath(project: any) {
  let displayPath = project.fsPath;
  try {
    const isFile = !project.fsPath.startsWith('vscode-vfs') && !project.fsPath.startsWith('http');
    if (isFile) {
       displayPath = project.fsPath; 
    } else if (project.customDomain) {
       const pathPart = project.fsPath.split('/').slice(3).join('/');
       displayPath = `Self-Hosted: ${project.customDomain}/${pathPart}`;
    } else {
       displayPath = project.fsPath.replace('vscode-vfs://github/', 'GitHub: ').replace('vscode-vfs://gitlab/', 'GitLab: ');
    }
  } catch(e) {}
  return displayPath;
}

function getFileIcon(filename: string) {
  const extMatch = filename.match(/\.([^.]+)$/);
  const ext = extMatch ? extMatch[1].toLowerCase() : '';
  switch(ext) {
    case 'js': case 'jsx': return <FontAwesomeIcon icon={faJs} className="file-icon-js sub-icon" />;
    case 'ts': case 'tsx': return <FontAwesomeIcon icon={faJs} className="file-icon-ts sub-icon" />; 
    case 'vue': return <FontAwesomeIcon icon={faVuejs} className="file-icon-vue sub-icon" />;
    case 'html': return <FontAwesomeIcon icon={faHtml5} className="file-icon-html sub-icon" />;
    case 'css': case 'scss': case 'less': return <FontAwesomeIcon icon={faCss3Alt} className="file-icon-css sub-icon" />;
    case 'json': return <FontAwesomeIcon icon={faFileCode} className="file-icon-json sub-icon" />;
    case 'md': return <FontAwesomeIcon icon={faMarkdown} className="file-icon-md sub-icon" />;
    case 'png': case 'jpg': case 'jpeg': case 'gif': case 'svg': case 'ico': return <FontAwesomeIcon icon={faImage} className="file-icon-img sub-icon" />;
    default: return <FontAwesomeIcon icon={faFileCode} className="file-icon-default sub-icon" />;
  }
}

export default function RecentProjectsApp() {
  // 核心数据
  const [projects, setProjects] = useState<any[]>([]);
  const [currentUri, setCurrentUri] = useState('');
  const [lastOpenedPath, setLastOpenedPath] = useState('');
  
  // 交互状态
  const [searchQuery, setSearchQuery] = useState(vscode.getState()?.searchQuery || '');
  const [selectedId, setSelectedId] = useState<string>('');
  
  // 动态树形结构状态
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [loadingNodes, setLoadingNodes] = useState<Set<string>>(new Set());
  const [dirChildren, setDirChildren] = useState<Record<string, any[]>>({});

  // 动态分支状态 (接收单独更新)
  const [branchMap, setBranchMap] = useState<Record<string, string>>({});

  // 右键菜单状态
  const [contextMenu, setContextMenu] = useState<{
    visible: boolean, x: number, y: number, type: 'top' | 'sub', payload: any
  }>({ visible: false, x: 0, y: 0, type: 'top', payload: {} });
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      const msg = e.data;
      if (msg.type === 'init' || msg.type === 'config') { // 根据你外层发的消息类型调整
        setProjects(msg.projects || []);
        setCurrentUri(msg.currentUri || '');
        setLastOpenedPath(msg.lastOpenedPath || '');
        // 初始化 branch map
        const initialBranches: Record<string, string> = {};
        (msg.projects || []).forEach((p: any) => { if(p.branch) initialBranches[p.fsPath] = p.branch; });
        setBranchMap(initialBranches);
      } else if (msg.type === 'updateBranchTag') {
        setBranchMap(prev => ({ ...prev, [msg.fsPath]: msg.branch }));
      } else if (msg.type === 'readDirResult') {
        setLoadingNodes(prev => { const n = new Set(prev); n.delete(msg.id); return n; });
        setDirChildren(prev => ({ ...prev, [msg.id]: msg.children }));
      }
    };
    window.addEventListener('message', handleMessage);
    vscode.postMessage({ type: 'refresh' }); // 唤起初始数据
    
    // 全局点击关闭右键菜单
    const handleClickOutside = () => setContextMenu(prev => ({ ...prev, visible: false }));
    window.addEventListener('click', handleClickOutside);
    window.addEventListener('blur', handleClickOutside);
    
    return () => {
      window.removeEventListener('message', handleMessage);
      window.removeEventListener('click', handleClickOutside);
      window.removeEventListener('blur', handleClickOutside);
    };
  }, []);

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearchQuery(val);
    vscode.setState({ searchQuery: val });
  };

  const currentBaseUri = currentUri.split('?')[0];
  const currentProject = projects.find(p => p.fsPath.split('?')[0] === currentBaseUri);
  const otherProjects = projects.filter(p => p !== currentProject);

  // 过滤逻辑
  const matchSearch = (p: any) => {
    if (!searchQuery) return true;
    const title = p.customName || p.name;
    const path = getDisplayPath(p);
    const full = `${title} ${p.name} ${path} ${p.fsPath}`.toLowerCase();
    return full.includes(searchQuery.toLowerCase().trim());
  };

  const filteredOtherProjects = otherProjects.filter(matchSearch);
  const isCurrentVisible = currentProject && matchSearch(currentProject);

  // ----------- 操作动作 -----------
  const clickTimeout = useRef<any>(null);

  const handleOpenProject = (path: string) => {
    clearTimeout(clickTimeout.current);
    vscode.postMessage({ type: 'openProject', fsPath: path });
  };
  
  const handleOpenCurrent = (path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    vscode.postMessage({ type: 'openProjectCurrent', fsPath: path });
  };

  const handleOpenFile = (path: string, projectName: string, id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedId(id);
    vscode.postMessage({ type: 'openFile', fsPath: path, projectName });
  };

  const handleToggleExpand = (id: string, path: string, projectName: string, isRemote: boolean, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedId(id);
    clearTimeout(clickTimeout.current);
    clickTimeout.current = setTimeout(() => {
      setExpandedNodes(prev => {
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
          // 若没有子数据则去拉取
          if (!dirChildren[id]) {
            setLoadingNodes(l => { const n = new Set(l); n.add(id); return n; });
            vscode.postMessage({ type: 'readDir', id, fsPath: path, projectName });
          }
        }
        return next;
      });
    }, 250);
  };

  const handleContextMenu = (e: React.MouseEvent, type: 'top' | 'sub', payload: any, elementId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedId(elementId);
    
    // 菜单位置防溢出
    let x = e.pageX; let y = e.pageY;
    if (x + 200 > window.innerWidth) x = window.innerWidth - 200;
    if (y + 300 > window.innerHeight) y = window.innerHeight - 300;
    
    setContextMenu({ visible: true, x, y, type, payload });
  };

  const executeMenuAction = (action: string, arg?: any) => {
    setContextMenu(prev => ({ ...prev, visible: false }));
    const { payload } = contextMenu;
    
    switch(action) {
      case 'openInNewWindow': vscode.postMessage({ type: 'openInNewWindow', fsPath: payload.path }); break;
      case 'edit': vscode.postMessage({ type: 'editProjectName', fsPath: payload.path }); break;
      case 'changeAddress': vscode.postMessage({ type: 'changeAddress', fsPath: payload.path }); break;
      case 'switchBranch': vscode.postMessage({ type: 'switchBranch', fsPath: payload.path }); break;
      case 'copyText': vscode.postMessage({ type: 'copyToClipboard', text: arg }); break;
      case 'copyFile': vscode.postMessage({ type: 'copyFile', fsPath: payload.path }); break;
      case 'openLink': vscode.postMessage({ type: 'openExternalLink', fsPath: payload.path, platform: payload.platform, customDomain: payload.customDomain }); break;
      case 'revealInExplorer': vscode.postMessage({ type: 'revealInExplorer', fsPath: arg || payload.path }); break;
      case 'delete': vscode.postMessage({ type: 'removeProject', fsPath: payload.path }); break;
      case 'openFileToSide': vscode.postMessage({ type: 'openFileToSide', fsPath: payload.path, projectName: payload.projectName }); break;
      case 'updateBranch': vscode.postMessage({ type: 'updateSingleBranch', fsPath: payload.path }); break;
      case 'selectForCompare': vscode.postMessage({ type: 'selectForCompare', fsPath: payload.path, projectName: payload.projectName }); break;
      case 'compareWithSelected': vscode.postMessage({ type: 'compareWithSelected', fsPath: payload.path, projectName: payload.projectName }); break;
    }
  };

  // ----------- 渲染子树组件 -----------
  const renderTreeChildren = (parentId: string, projectName: string) => {
    const children = dirChildren[parentId];
    if (loadingNodes.has(parentId)) {
      return <div className="empty-node"><FontAwesomeIcon icon={faSpinner} spin /> 加载中...</div>;
    }
    if (!children) return null;
    if (children.length === 0) return <div className="empty-node">（空文件夹/无读取权限）</div>;

    return (
      <>
        {children.map((child, index) => {
          const childId = `${parentId}_${index}`;
          const isExpanded = expandedNodes.has(childId);
          const isRemote = child.path.startsWith('vscode-vfs') || child.path.startsWith('http');
          
          if (child.isFolder) {
            return (
              <div key={childId} className="tree-node">
                <div className={`sub-item clickable-sub ${selectedId === childId ? 'selected' : ''}`}
                     onClick={(e) => handleToggleExpand(childId, child.path, projectName, isRemote, e)}
                     onContextMenu={(e) => handleContextMenu(e, 'sub', { path: child.path, name: child.name, isFolder: true, projectName }, childId)}>
                  <div className="tree-chevron">
                    <FontAwesomeIcon icon={isExpanded ? faChevronDown : faChevronRight} style={{ fontSize: '10px' }} />
                  </div>
                  <FontAwesomeIcon icon={faFolder} className="icon-closed sub-icon" />
                  <span className="sub-name">{child.name}</span>
                </div>
                {isExpanded && <div className="tree-children">{renderTreeChildren(childId, projectName)}</div>}
              </div>
            );
          } else {
            return (
              <div key={childId} className="tree-node">
                <div className={`sub-item ${selectedId === childId ? 'selected' : ''}`}
                     onClick={(e) => handleOpenFile(child.path, projectName, childId, e)}
                     onContextMenu={(e) => handleContextMenu(e, 'sub', { path: child.path, name: child.name, isFolder: false, projectName }, childId)}
                     style={{ cursor: 'pointer' }} title="点击以只读模式预览">
                  <div className="chevron-placeholder"></div>
                  {getFileIcon(child.name)}
                  <span className="sub-name">{child.name}</span>
                </div>
              </div>
            );
          }
        })}
      </>
    );
  };

  // ----------- 主渲染逻辑 -----------
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--vscode-sideBar-background)', color: 'var(--vscode-foreground)' }}>
      <style>{`
        * { box-sizing: border-box; }
        body { padding: 0; margin: 0; font-family: var(--vscode-font-family); user-select: none; }
        .search-container { padding: 10px 12px; position: sticky; top: 0; z-index: 10; background: var(--vscode-sideBar-background); }
        .search-box { display: flex; align-items: center; background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); padding: 4px 8px; border-radius: 2px; }
        .search-box:focus-within { border-color: var(--vscode-focusBorder); outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
        .search-box input { flex: 1; background: transparent; border: none; color: var(--vscode-input-foreground); outline: none; margin-left: 6px; font-size: 12px; }
        .list-container { flex: 1; overflow-y: auto; padding-bottom: 20px;}
        ul { list-style: none; padding: 0; margin: 0; }
        
        .active-top-project { display: flex; justify-content: space-between; align-items: center; padding: 8px 10px 8px 0px; background-color: rgba(93, 173, 226, 0.1); border-left: 3px solid #5dade2; cursor: context-menu; }
        .active-top-project .path { color: var(--vscode-descriptionForeground); opacity: 0.8; }
        .top-divider { height: 4px; background: rgba(0, 0, 0, 0.1); box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.1); margin-bottom: 4px; }
        
        .project-item { display: flex; justify-content: space-between; align-items: center; padding: 6px 10px 6px 3px; cursor: pointer; border-bottom: 1px solid var(--vscode-panel-border); transition: background-color 0.1s; }
        .project-item:hover { background-color: var(--vscode-list-hoverBackground); }
        .project-item.just-opened { padding-left: 1px; background-color: rgba(128, 128, 128, 0.06); box-shadow: inset 0 0 12px rgba(128, 128, 128, 0.15); border-left: 2px solid var(--vscode-descriptionForeground); }
        
        .project-item.selected, .sub-item.selected, .active-top-project.selected { background-color: var(--vscode-list-activeSelectionBackground) !important; color: var(--vscode-list-activeSelectionForeground) !important; }
        .project-item.selected .path, .active-top-project.selected .path, .project-item.selected .icon-closed, .sub-item.selected .tree-chevron { color: var(--vscode-list-activeSelectionForeground) !important; opacity: 0.9 !important; }

        .item-left { display: flex; align-items: center; flex: 1; min-width: 0; gap: 3px; }
        .clickable-expand { cursor: pointer; }
        .clickable-expand:hover .tree-chevron { background: var(--vscode-toolbar-hoverBackground); opacity: 1; }

        .tree-chevron, .chevron-placeholder { width: 14px; height: 20px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; border-radius: 4px;}
        .tree-chevron { color: var(--vscode-icon-foreground); opacity: 0.8; }
        .project-icon, .sub-icon { width: 16px; text-align: center; margin-right: 6px; flex-shrink: 0; display: inline-block; font-size: 14px; }

        .info { overflow: hidden; display: flex; flex-direction: column; flex: 1; padding: 2px 0; pointer-events: none; }
        .title { font-size: 13px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: flex; align-items: center; pointer-events: auto; }
        .path { font-size: 10px; opacity: 0.6; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        
        .branch-tag { font-size: 10px; background: var(--vscode-badge-background, rgba(128, 128, 128, 0.15)); color: var(--vscode-badge-foreground, var(--vscode-descriptionForeground)); padding: 2px 6px; border-radius: 10px; display: inline-flex; align-items: center; gap: 3px; margin-left: 8px; border: 1px solid var(--vscode-panel-border);}
        .icon-opened { color: #5dade2 !important; } 
        .icon-closed { color: var(--vscode-icon-foreground); opacity: 0.8; } 
        
        .item-actions { display: flex; align-items: center; gap: 2px; flex-shrink: 0; margin-left: 4px; }
        .action-btn-icon { background: none; border: none; color: var(--vscode-icon-foreground); cursor: pointer; padding: 6px; border-radius: 4px; display: flex; align-items: center; justify-content: center; }
        .open-btn { opacity: 0.4; } .open-btn:hover { opacity: 1; background: var(--vscode-toolbar-hoverBackground); }
        .project-item:hover .open-btn { opacity: 0.8; }

        .tree-children { margin-left: 10px; padding-left: 6px; border-left: 1px solid var(--vscode-tree-indentGuidesStroke); }
        .sub-item { display: flex; align-items: center; padding: 2px 0; font-size: 13px; cursor: default; }
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
        .action-btn { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 6px 12px; border-radius: 2px; cursor: pointer; font-size: 12px; width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px; transition: background 0.2s; }
        .action-btn:hover { background: var(--vscode-button-hoverBackground); }
        .action-btn.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
        .action-btn.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }

        #context-menu { position: fixed; background: var(--vscode-menu-background); color: var(--vscode-menu-foreground); border: 1px solid var(--vscode-menu-border); box-shadow: 0 4px 12px rgba(0,0,0,0.25); border-radius: 6px; z-index: 9999; min-width: 180px; padding: 4px 0; font-size: 13px; }
        #context-menu li { padding: 6px 12px; cursor: pointer; display: flex; align-items: center; gap: 10px; }
        #context-menu li:hover { background: var(--vscode-menu-selectionBackground); color: var(--vscode-menu-selectionForeground); }
        .menu-icon { width: 14px; text-align: center; opacity: 0.8; }
        .menu-separator { height: 1px; background: var(--vscode-menu-separatorBackground); margin: 4px 0; }
      `}</style>

      {/* 右键菜单 */}
      {contextMenu.visible && (
        <div id="context-menu" ref={menuRef} style={{ left: contextMenu.x, top: contextMenu.y }}>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {contextMenu.type === 'top' && (
              <>
                <li onClick={() => executeMenuAction('openInNewWindow')}><FontAwesomeIcon icon={faArrowUpRightFromSquare} className="menu-icon"/> 在新窗口打开</li>
                <div className="menu-separator"></div>
                <li onClick={() => executeMenuAction('edit')}><FontAwesomeIcon icon={faPen} className="menu-icon"/> 编辑项目名称</li>
                <li onClick={() => executeMenuAction('changeAddress')}><FontAwesomeIcon icon={faLocationDot} className="menu-icon"/> 更换地址</li>
                {contextMenu.payload.isRemote && <li onClick={() => executeMenuAction('switchBranch')}><FontAwesomeIcon icon={faCodeBranch} className="menu-icon"/> 切换分支</li>}
                <div className="menu-separator"></div>
                <li onClick={() => executeMenuAction('copyText', contextMenu.payload.originalName)}><FontAwesomeIcon icon={faCopy} className="menu-icon"/> 复制文件名</li>
                <li onClick={() => executeMenuAction('updateBranch')}><FontAwesomeIcon icon={faRotateRight} className="menu-icon"/> 更新分支</li>
                {contextMenu.payload.customName && <li onClick={() => executeMenuAction('copyText', contextMenu.payload.customName)}><FontAwesomeIcon icon={faCopy} className="menu-icon"/> 复制项目名</li>}
                <li onClick={() => executeMenuAction('copyText', contextMenu.payload.path)}><FontAwesomeIcon icon={faLink} className="menu-icon"/> 复制地址链接</li>
                {contextMenu.payload.isRemote ? 
                  <li onClick={() => executeMenuAction('openLink')}><FontAwesomeIcon icon={faGlobe} className="menu-icon"/> 在浏览器中打开</li> : 
                  <li onClick={() => executeMenuAction('revealInExplorer')}><FontAwesomeIcon icon={faFolderOpenReg} className="menu-icon"/> 在访达/资源管理器中显示</li>
                }
                {!contextMenu.payload.isActiveProject && (
                  <>
                    <div className="menu-separator"></div>
                    <li onClick={() => executeMenuAction('delete')} style={{ color: 'var(--vscode-errorForeground)' }}><FontAwesomeIcon icon={faTrash} className="menu-icon"/> 移除该项目</li>
                  </>
                )}
              </>
            )}
            
            {contextMenu.type === 'sub' && (
              <>
                {!contextMenu.payload.isFolder && (
                  <>
                    <li onClick={() => executeMenuAction('openFileToSide')}><FontAwesomeIcon icon={faColumns} className="menu-icon"/> 在侧边打开</li>
                    <li onClick={() => executeMenuAction('copyFile')}><FontAwesomeIcon icon={faCopy} className="menu-icon"/> 复制文件</li>
                    <div className="menu-separator"></div>
                    <li onClick={() => executeMenuAction('selectForCompare')}><FontAwesomeIcon icon={faSquareCheck} className="menu-icon"/> 选择以进行比较</li>
                    <li onClick={() => executeMenuAction('compareWithSelected')}><FontAwesomeIcon icon={faCodeCompare} className="menu-icon"/> 与已选项目进行比较</li>
                    <div className="menu-separator"></div>
                  </>
                )}
                <li onClick={() => executeMenuAction('copyText', contextMenu.payload.name)}><FontAwesomeIcon icon={faClone} className="menu-icon"/> 复制名称</li>
                <li onClick={() => executeMenuAction('copyText', contextMenu.payload.path)}><FontAwesomeIcon icon={faLink} className="menu-icon"/> 复制路径</li>
                {!contextMenu.payload.path.startsWith('vscode-vfs') && !contextMenu.payload.path.startsWith('http') && (
                  <>
                    <div className="menu-separator"></div>
                    <li onClick={() => executeMenuAction('revealInExplorer', contextMenu.payload.path)}><FontAwesomeIcon icon={faFolderOpenReg} className="menu-icon"/> 在访达/资源管理器中显示</li>
                  </>
                )}
              </>
            )}
          </ul>
        </div>
      )}

      {/* 搜索框 */}
      {projects.length > 0 && (
        <div className="search-container">
          <div className="search-box">
            <FontAwesomeIcon icon={faMagnifyingGlass} style={{ color: 'var(--vscode-input-placeholderForeground)', fontSize: '12px' }} />
            <input type="text" value={searchQuery} onChange={handleSearch} placeholder="搜索标题、文件夹、地址..." autoComplete="off" spellCheck="false" />
          </div>
        </div>
      )}

      {/* 列表区域 */}
      <div className="list-container" onScroll={() => setContextMenu(p => ({...p, visible:false}))}>
        {projects.length === 0 ? (
          <div className="empty-state">
            <div className="empty-text">暂无项目记录，请添加：</div>
            <button className="action-btn" onClick={() => vscode.postMessage({ type: 'addLocal' })}><FontAwesomeIcon icon={faFolderPlus} /> 添加本地项目</button>
            <button className="action-btn secondary" onClick={() => vscode.postMessage({ type: 'addRemote' })}><FontAwesomeIcon icon={faGithub} /> 添加远程仓库</button>
          </div>
        ) : (
          <>
            {/* 当前活动项目 */}
            {isCurrentVisible && currentProject && (() => {
               const p = currentProject;
               const isRemote = p.fsPath.startsWith('vscode-vfs') || p.fsPath.startsWith('http');
               const isGitlab = p.platform === 'gitlab' || p.fsPath.startsWith('vscode-vfs://gitlab');
               const icon = isRemote ? (isGitlab ? faGitlab : faGithub) : faFolderOpen;
               const title = p.customName || p.name;
               const displayPath = getDisplayPath(p);
               const finalPath = p.customName ? `${p.name} • ${displayPath}` : displayPath;
               const branch = branchMap[p.fsPath] || p.branch;

               return (
                 <div key="active-top">
                   <div className={`active-top-project ${selectedId === 'active-top' ? 'selected' : ''}`}
                        title="当前窗口正在运行的项目"
                        onContextMenu={(e) => handleContextMenu(e, 'top', { path: p.fsPath, isRemote, originalName: p.name, customName: p.customName, platform: p.platform || 'github', customDomain: p.customDomain, isActiveProject: true }, 'active-top')}
                        onClick={() => setSelectedId('active-top')}>
                     <div className="item-left">
                       <div className="tree-chevron" style={{ visibility: 'hidden' }}></div>
                       <div className="info">
                         <div className="title">
                           <FontAwesomeIcon icon={icon} className="project-icon icon-opened" />
                           {title}
                           {branch && <span className="branch-tag"><FontAwesomeIcon icon={faCodeBranch} style={{ fontSize:'10px' }}/> {branch}</span>}
                         </div>
                         <div className="path">{finalPath}</div>
                       </div>
                     </div>
                   </div>
                   <div className="top-divider"></div>
                 </div>
               );
            })()}

            {/* 其他历史项目 */}
            <ul>
              {filteredOtherProjects.map(p => {
                const rootId = `root_${p.timestamp}`;
                const isJustOpened = p.fsPath === lastOpenedPath;
                const isRemote = p.fsPath.startsWith('vscode-vfs') || p.fsPath.startsWith('http');
                const isGitlab = p.platform === 'gitlab' || p.fsPath.startsWith('vscode-vfs://gitlab');
                const icon = isRemote ? (isGitlab ? faGitlab : faGithub) : faFolder;
                const title = p.customName || p.name;
                const displayPath = getDisplayPath(p);
                const finalPath = p.customName ? `${p.name} • ${displayPath}` : displayPath;
                const isExpanded = expandedNodes.has(rootId);
                const branch = branchMap[p.fsPath] || p.branch;

                return (
                  <li key={rootId} className="tree-node">
                    <div className={`project-item ${isJustOpened ? 'just-opened' : ''} ${selectedId === rootId ? 'selected' : ''}`}
                         onDoubleClick={() => handleOpenProject(p.fsPath)}
                         title={isJustOpened ? '刚刚在此窗口中唤起过' : ''}
                         onContextMenu={(e) => handleContextMenu(e, 'top', { path: p.fsPath, isRemote, originalName: p.name, customName: p.customName, platform: p.platform || 'github', customDomain: p.customDomain, isActiveProject: false }, rootId)}
                         onClick={() => setSelectedId(rootId)}>
                      
                      <div className="item-left clickable-expand" onClick={(e) => handleToggleExpand(rootId, p.fsPath, title, isRemote, e)}>
                        <div className="tree-chevron">
                          <FontAwesomeIcon icon={isExpanded ? faChevronDown : faChevronRight} style={{ fontSize: '10px' }} />
                        </div>
                        <div className="info">
                          <div className="title">
                            <FontAwesomeIcon icon={icon} className="project-icon icon-closed" />
                            {title}
                            {branch && <span className="branch-tag"><FontAwesomeIcon icon={faCodeBranch} style={{ fontSize:'10px' }}/> {branch}</span>}
                          </div>
                          <div className="path">{finalPath}</div>
                        </div>
                      </div>

                      <div className="item-actions">
                        <button className="action-btn-icon open-btn" onClick={(e) => handleOpenCurrent(p.fsPath, e)} title="在当前窗口打开">
                          <FontAwesomeIcon icon={faArrowRightToBracket} />
                        </button>
                      </div>
                    </div>
                    {isExpanded && <div className="tree-children">{renderTreeChildren(rootId, title)}</div>}
                  </li>
                );
              })}
            </ul>
            
            {(searchQuery && filteredOtherProjects.length === 0 && !isCurrentVisible) && (
              <div style={{ textAlign: 'center', padding: '20px', fontSize: '12px', color: 'var(--vscode-descriptionForeground)' }}>
                没有找到匹配的项目...
              </div>
            )}
          </>
        )}
      </div>

      {/* 底部按钮 */}
      {projects.length > 0 && (
        <div className="bottom-bar">
          <button className="action-btn" onClick={() => vscode.postMessage({ type: 'addLocal' })} style={{ marginBottom: 0 }}>
            <FontAwesomeIcon icon={faFolderPlus} /> 添加本地
          </button>
          <button className="action-btn secondary" onClick={() => vscode.postMessage({ type: 'addRemote' })} style={{ marginBottom: 0 }}>
            <FontAwesomeIcon icon={faGithub} /> 添加远程
          </button>
        </div>
      )}
    </div>
  );
}