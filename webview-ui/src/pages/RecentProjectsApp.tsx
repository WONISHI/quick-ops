import React, { useEffect, useState, useRef, useMemo } from 'react';
import { vscode } from '../utils/vscode';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faMagnifyingGlass,
  faFolderOpen,
  faFolderPlus,
  faCodeBranch,
  faChevronRight,
  faChevronDown,
  faArrowRightToBracket,
  faFolder,
  faArrowUpRightFromSquare,
  faPen,
  faLocationDot,
  faRotateRight,
  faLink,
  faGlobe,
  faTrash,
  faColumns,
  faCodeCompare,
  faSpinner,
  faFileCode,
  faArrowLeft,
  faArrowUp,
  faArrowDown,
  faTimes,
} from '@fortawesome/free-solid-svg-icons';
import { faCopy, faSquareCheck, faClone, faImage, faFolderOpen as faFolderOpenReg, faWindowRestore } from '@fortawesome/free-regular-svg-icons';
import { faGithub, faGitlab, faJs, faVuejs, faHtml5, faCss3Alt, faMarkdown } from '@fortawesome/free-brands-svg-icons';

import styles from '../assets/css/RecentProjectsApp.module.css';

interface Project {
  fsPath: string;
  name: string;
  customName?: string;
  customDomain?: string;
  platform?: string;
  branch?: string;
  timestamp: number;
}

interface DirChild {
  path: string;
  name: string;
  isFolder: boolean;
}

interface SearchMatch {
  line: number;
  text: string;
}

interface SearchResult {
  file: string;
  fullPath: string;
  matches: SearchMatch[];
}

interface ContextMenuPayload {
  path: string;
  name?: string;
  originalName?: string;
  customName?: string;
  isRemote?: boolean;
  platform?: string;
  customDomain?: string;
  isActiveProject?: boolean;
  isFolder?: boolean;
  projectName?: string;
}

function getDisplayPath(project: Project) {
  let displayPath = project.fsPath;
  try {
    const isFile = !project.fsPath.startsWith('vscode-vfs') && !project.fsPath.startsWith('http');
    if (isFile) {
      let cleanPath = decodeURIComponent(project.fsPath);
      cleanPath = cleanPath.replace(/^file:\/\//i, '');
      cleanPath = cleanPath.replace(/^\/?[a-zA-Z]:[\\/]/i, '/');
      displayPath = cleanPath;
    } else if (project.customDomain) {
      const pathPart = project.fsPath.split('/').slice(3).join('/');
      displayPath = `Self-Hosted: ${project.customDomain}/${pathPart}`;
    } else {
      displayPath = project.fsPath.replace('vscode-vfs://github/', 'GitHub: ').replace('vscode-vfs://gitlab/', 'GitLab: ');
    }
  } catch (e) {
    console.log('e', e);
  }
  return displayPath;
}

function getFileIcon(filename: string) {
  const extMatch = filename.match(/\.([^.]+)$/);
  const ext = extMatch ? extMatch[1].toLowerCase() : '';
  switch (ext) {
    case 'js':
    case 'jsx':
      return <FontAwesomeIcon icon={faJs} className={`${styles['file-icon-js']} ${styles['sub-icon']}`} />;
    case 'ts':
    case 'tsx':
      return <FontAwesomeIcon icon={faJs} className={`${styles['file-icon-ts']} ${styles['sub-icon']}`} />;
    case 'vue':
      return <FontAwesomeIcon icon={faVuejs} className={`${styles['file-icon-vue']} ${styles['sub-icon']}`} />;
    case 'html':
      return <FontAwesomeIcon icon={faHtml5} className={`${styles['file-icon-html']} ${styles['sub-icon']}`} />;
    case 'css':
    case 'scss':
    case 'less':
      return <FontAwesomeIcon icon={faCss3Alt} className={`${styles['file-icon-css']} ${styles['sub-icon']}`} />;
    case 'json':
      return <FontAwesomeIcon icon={faFileCode} className={`${styles['file-icon-json']} ${styles['sub-icon']}`} />;
    case 'md':
      return <FontAwesomeIcon icon={faMarkdown} className={`${styles['file-icon-md']} ${styles['sub-icon']}`} />;
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg':
    case 'ico':
      return <FontAwesomeIcon icon={faImage} className={`${styles['file-icon-img']} ${styles['sub-icon']}`} />;
    default:
      return <FontAwesomeIcon icon={faFileCode} className={`${styles['file-icon-default']} ${styles['sub-icon']}`} />;
  }
}

const HighlightText = ({
  text,
  query,
  globalStartIndex,
  currentActiveMatch,
  isLineActive,
}: {
  text: string;
  query: string;
  globalStartIndex: number;
  currentActiveMatch: number;
  isLineActive: boolean;
}) => {
  if (!query) return <span>{text}</span>;
  const safeQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${safeQuery})`, 'gi'));

  let matchCounter = 0;
  return (
    <span>
      {parts.map((part, index) => {
        const isMatch = part.toLowerCase() === query.toLowerCase();
        if (isMatch) {
          const thisGlobalIndex = globalStartIndex + matchCounter;
          matchCounter++;
          const isKeywordActive = thisGlobalIndex === currentActiveMatch;

          return (
            <span
              key={index}
              style={{
                backgroundColor: isKeywordActive ? 'var(--vscode-editor-findMatchBackground, #515c6a)' : 'var(--vscode-editor-findMatchHighlightBackground, #ea5c0055)',
                color: isKeywordActive ? '#fff' : isLineActive ? 'inherit' : 'var(--vscode-editor-findMatchForeground, inherit)',
                border: isKeywordActive ? '1px solid var(--vscode-editor-findMatchBorder, #f48771)' : 'none',
                borderRadius: '2px',
              }}
            >
              {part}
            </span>
          );
        }
        return <span key={index}>{part}</span>;
      })}
    </span>
  );
};

export default function RecentProjectsApp() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentUri, setCurrentUri] = useState('');
  const [lastOpenedPath, setLastOpenedPath] = useState('');

  const [searchQuery, setSearchQuery] = useState(vscode.getState()?.searchQuery || '');
  const [selectedId, setSelectedId] = useState<string>('');

  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [loadingNodes, setLoadingNodes] = useState<Set<string>>(new Set());
  const [dirChildren, setDirChildren] = useState<Record<string, DirChild[]>>({});
  const [branchMap, setBranchMap] = useState<Record<string, string>>({});

  const [contextMenu, setContextMenu] = useState<{
    visible: boolean;
    x: number;
    y: number;
    type: 'top' | 'sub';
    payload: ContextMenuPayload;
  }>({ visible: false, x: 0, y: 0, type: 'top', payload: { path: '' } });
  const menuRef = useRef<HTMLDivElement>(null);

  const [isSearchMode, setIsSearchMode] = useState(false);
  const [searchTargetProject, setSearchTargetProject] = useState<ContextMenuPayload | null>(null);
  const [folderSearchQuery, setFolderSearchQuery] = useState('');
  const [folderSearchResults, setFolderSearchResults] = useState<SearchResult[]>([]);
  const [isSearchingFolder, setIsSearchingFolder] = useState(false);
  const [folderSearchError, setFolderSearchError] = useState('');
  const [currentActiveMatch, setCurrentActiveMatch] = useState(0);

  const { lineStartIndexMap, totalMatches, flatMatchesList } = useMemo(() => {
    const map = new Map<string, number>();
    const list: { fileIndex: number; matchIndex: number; lineGlobalIndex: number; fullPath: string; lineNum: number }[] = [];
    let idx = 0;

    if (!folderSearchQuery) return { lineStartIndexMap: map, totalMatches: 0, flatMatchesList: list };

    const safeQuery = folderSearchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${safeQuery})`, 'gi');

    folderSearchResults.forEach((res, fileIndex) => {
      res.matches.forEach((m: SearchMatch, matchIndex: number) => {
        const startIdx = idx;
        map.set(`${fileIndex}-${matchIndex}`, startIdx);

        let occurrencesCount = 0;
        const parts = m.text.split(regex);
        parts.forEach((part: string) => {
          if (part.toLowerCase() === folderSearchQuery.toLowerCase()) occurrencesCount++;
        });

        const count = Math.max(1, occurrencesCount);
        for (let k = 0; k < count; k++) {
          list.push({ fileIndex, matchIndex, lineGlobalIndex: startIdx, fullPath: res.fullPath, lineNum: m.line });
        }
        idx += count;
      });
    });

    return { lineStartIndexMap: map, totalMatches: idx, flatMatchesList: list };
  }, [folderSearchResults, folderSearchQuery]);

  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      const msg = e.data as Record<string, unknown>;

      if (msg.type === 'updateProjects') {
        const data = (msg.data as Project[]) || [];
        setProjects(data);
        setCurrentUri((msg.currentUriStr as string) || '');
        setLastOpenedPath((msg.lastOpenedPath as string) || '');
        const initialBranches: Record<string, string> = {};
        data.forEach((p: Project) => {
          if (p.branch) initialBranches[p.fsPath] = p.branch;
        });
        setBranchMap(initialBranches);
      } else if (msg.type === 'updateBranchTag') {
        setBranchMap((prev) => ({ ...prev, [msg.fsPath as string]: msg.branch as string }));
      } else if (msg.type === 'readDirResult') {
        setLoadingNodes((prev) => {
          const n = new Set(prev);
          n.delete(msg.id as string);
          return n;
        });
        setDirChildren((prev) => ({ ...prev, [msg.id as string]: msg.children as DirChild[] }));
      } else if (msg.type === 'searchFolderResult') {
        setIsSearchingFolder(false);
        if (msg.error) {
          setFolderSearchError(msg.error as string);
          setFolderSearchResults([]);
        } else {
          setFolderSearchError('');
          setFolderSearchResults((msg.results as SearchResult[]) || []);
          setCurrentActiveMatch(0);
        }
      }
    };

    window.addEventListener('message', handleMessage);
    vscode.postMessage({ type: 'refresh' });

    const handleClickOutside = () => setContextMenu((prev) => ({ ...prev, visible: false }));
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
  const currentProject = projects.find((p) => p.fsPath.split('?')[0] === currentBaseUri);
  const otherProjects = projects.filter((p) => p !== currentProject);

  const matchSearch = (p: Project) => {
    if (!searchQuery) return true;
    const title = p.customName || p.name;
    const path = getDisplayPath(p);
    const full = `${title} ${p.name} ${path} ${p.fsPath}`.toLowerCase();
    return full.includes(searchQuery.toLowerCase().trim());
  };

  const filteredOtherProjects = otherProjects.filter(matchSearch);
  const isCurrentVisible = currentProject && matchSearch(currentProject);

  const clickTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleOpenProject = (path: string) => {
    if (clickTimeout.current) clearTimeout(clickTimeout.current);
    vscode.postMessage({ type: 'openProject', fsPath: path });
  };

  const handleOpenCurrent = (path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    vscode.postMessage({ type: 'openProjectCurrent', fsPath: path });
  };

  const handleOpenFile = (path: string, projectName: string, id: string, isActiveProject: boolean, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedId(id);
    vscode.postMessage({ type: isActiveProject ? 'openFileNormal' : 'openFile', fsPath: path, projectName });
  };

  const handleToggleExpand = (id: string, path: string, projectName: string, _: boolean, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedId(id);
    if (clickTimeout.current) clearTimeout(clickTimeout.current);
    clickTimeout.current = setTimeout(() => {
      setExpandedNodes((prev) => {
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
          if (!dirChildren[id]) {
            setLoadingNodes((l) => {
              const n = new Set(l);
              n.add(id);
              return n;
            });
            vscode.postMessage({ type: 'readDir', id, fsPath: path, projectName });
          }
        }
        return next;
      });
    }, 250);
  };

  const handleContextMenu = (e: React.MouseEvent, type: 'top' | 'sub', payload: ContextMenuPayload, elementId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedId(elementId);

    let x = e.pageX;
    let y = e.pageY;
    if (x + 200 > window.innerWidth) x = window.innerWidth - 200;
    if (y + 300 > window.innerHeight) y = window.innerHeight - 300;

    setContextMenu({ visible: true, x, y, type, payload });
  };

  const executeMenuAction = (action: string, arg?: string) => {
    setContextMenu((prev) => ({ ...prev, visible: false }));
    const { payload } = contextMenu;

    switch (action) {
      case 'openProjectCurrent':
        vscode.postMessage({ type: 'openProjectCurrent', fsPath: payload.path });
        break;
      case 'openInNewWindow':
        vscode.postMessage({ type: 'openInNewWindow', fsPath: payload.path });
        break;
      case 'edit':
        vscode.postMessage({ type: 'editProjectName', fsPath: payload.path });
        break;
      case 'changeAddress':
        vscode.postMessage({ type: 'changeAddress', fsPath: payload.path });
        break;
      case 'switchBranch':
        vscode.postMessage({ type: 'switchBranch', fsPath: payload.path });
        break;
      case 'copyText':
        vscode.postMessage({ type: 'copyToClipboard', text: arg });
        break;
      case 'copyFile':
        vscode.postMessage({ type: 'copyFile', fsPath: payload.path });
        break;
      case 'openLink':
        vscode.postMessage({ type: 'openExternalLink', fsPath: payload.path, platform: payload.platform, customDomain: payload.customDomain });
        break;
      case 'revealInExplorer':
        vscode.postMessage({ type: 'revealInExplorer', fsPath: arg || payload.path });
        break;
      case 'delete':
        vscode.postMessage({ type: 'removeProject', fsPath: payload.path });
        break;
      case 'openFileToSide':
        vscode.postMessage({ type: payload.isActiveProject ? 'openFileNormalToSide' : 'openFileToSide', fsPath: payload.path, projectName: payload.projectName });
        break;
      case 'openFileInNewTab':
        vscode.postMessage({ type: payload.isActiveProject ? 'openFileNormalInNewTab' : 'openFileInNewTab', fsPath: payload.path, projectName: payload.projectName });
        break;
      case 'updateBranch':
        vscode.postMessage({ type: 'updateSingleBranch', fsPath: payload.path });
        break;
      case 'selectForCompare':
        vscode.postMessage({ type: 'selectForCompare', fsPath: payload.path, projectName: payload.isActiveProject ? undefined : payload.projectName });
        break;
      case 'compareWithSelected':
        vscode.postMessage({ type: 'compareWithSelected', fsPath: payload.path, projectName: payload.isActiveProject ? undefined : payload.projectName });
        break;
      case 'searchInFolder':
        setSearchTargetProject(payload);
        setIsSearchMode(true);
        setFolderSearchQuery('');
        setFolderSearchResults([]);
        setFolderSearchError('');
        break;
      // 🌟 新增：拦截 Vditor 预览指令并发送给后端
      case 'previewWithVditor':
        vscode.postMessage({ type: 'previewWithVditor', fsPath: payload.path, projectName: payload.projectName });
        break;
    }
  };

  const handleNextSearchMatch = () => {
    if (totalMatches === 0) return;
    setCurrentActiveMatch((prev) => (prev + 1) % totalMatches);
  };
  const handlePrevSearchMatch = () => {
    if (totalMatches === 0) return;
    setCurrentActiveMatch((prev) => (prev - 1 + totalMatches) % totalMatches);
  };

  useEffect(() => {
    if (totalMatches > 0 && isSearchMode && flatMatchesList[currentActiveMatch]) {
      const matchInfo = flatMatchesList[currentActiveMatch];
      const el = document.getElementById(`search-line-${matchInfo.fileIndex}-${matchInfo.matchIndex}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [currentActiveMatch, totalMatches, isSearchMode, flatMatchesList]);

  const renderTreeChildren = (parentId: string, projectName: string, isActiveProject: boolean = false) => {
    const children = dirChildren[parentId];
    if (loadingNodes.has(parentId)) {
      return (
        <div className={styles['empty-node']}>
          <FontAwesomeIcon icon={faSpinner} spin /> 加载中...
        </div>
      );
    }
    if (!children) return null;
    if (children.length === 0) return <div className={styles['empty-node']}>（空文件夹/无读取权限）</div>;

    return (
      <>
        {children.map((child, index) => {
          const childId = `${parentId}_${index}`;
          const isExpanded = expandedNodes.has(childId);
          const isRemote = child.path.startsWith('vscode-vfs') || child.path.startsWith('http');

          if (child.isFolder) {
            return (
              <div key={childId}>
                <div
                  className={`${styles['sub-item']} ${styles['clickable-sub']} ${selectedId === childId ? styles['selected'] : ''}`}
                  onClick={(e) => handleToggleExpand(childId, child.path, projectName, isRemote, e)}
                  onContextMenu={(e) => handleContextMenu(e, 'sub', { path: child.path, name: child.name, isFolder: true, projectName, isActiveProject }, childId)}
                >
                  <div className={styles['tree-chevron']}>
                    <FontAwesomeIcon icon={isExpanded ? faChevronDown : faChevronRight} style={{ fontSize: '10px' }} />
                  </div>
                  <FontAwesomeIcon icon={faFolder} className={`${styles['icon-closed']} ${styles['sub-icon']}`} />
                  <span className={styles['sub-name']}>{child.name}</span>
                </div>
                {isExpanded && <div className={styles['tree-children']}>{renderTreeChildren(childId, projectName, isActiveProject)}</div>}
              </div>
            );
          } else {
            return (
              <div key={childId}>
                <div
                  className={`${styles['sub-item']} ${selectedId === childId ? styles['selected'] : ''}`}
                  onClick={(e) => handleOpenFile(child.path, projectName, childId, isActiveProject, e)}
                  onContextMenu={(e) => handleContextMenu(e, 'sub', { path: child.path, name: child.name, isFolder: false, projectName, isActiveProject }, childId)}
                  style={{ cursor: 'pointer' }}
                  title={isActiveProject ? "点击打开文件" : "点击以只读模式预览"}
                >
                  <div className={styles['chevron-placeholder']}></div>
                  {getFileIcon(child.name)}
                  <span className={styles['sub-name']}>{child.name}</span>
                </div>
              </div>
            );
          }
        })}
      </>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--vscode-sideBar-background)', color: 'var(--vscode-foreground)' }}>
      {contextMenu.visible && (
        <div id={styles['context-menu']} ref={menuRef} style={{ left: contextMenu.x, top: contextMenu.y }}>
          <ul>
            {contextMenu.type === 'top' && (
              <>
                {/* 🌟 非当前项目才显示：在当前窗口打开、在新窗口打开、查找文件内容 */}
                {!contextMenu.payload.isActiveProject && (
                  <>
                    <li onClick={() => executeMenuAction('openProjectCurrent')}>
                      <FontAwesomeIcon icon={faArrowRightToBracket} className={styles['menu-icon']} /> 在当前窗口打开
                    </li>
                    <li onClick={() => executeMenuAction('openInNewWindow')}>
                      <FontAwesomeIcon icon={faArrowUpRightFromSquare} className={styles['menu-icon']} /> 在新窗口打开
                    </li>
                    <div className={styles['menu-separator']}></div>
                    <li onClick={() => executeMenuAction('searchInFolder')}>
                      <FontAwesomeIcon icon={faMagnifyingGlass} className={styles['menu-icon']} /> 查找文件内容...
                    </li>
                    <div className={styles['menu-separator']}></div>
                  </>
                )}

                <li onClick={() => executeMenuAction('edit')}>
                  <FontAwesomeIcon icon={faPen} className={styles['menu-icon']} /> 编辑项目名称
                </li>
                <li onClick={() => executeMenuAction('changeAddress')}>
                  <FontAwesomeIcon icon={faLocationDot} className={styles['menu-icon']} /> 更换地址
                </li>
                {contextMenu.payload.isRemote && (
                  <li onClick={() => executeMenuAction('switchBranch')}>
                    <FontAwesomeIcon icon={faCodeBranch} className={styles['menu-icon']} /> 切换分支
                  </li>
                )}
                <div className={styles['menu-separator']}></div>
                <li onClick={() => executeMenuAction('copyText', contextMenu.payload.originalName)}>
                  <FontAwesomeIcon icon={faCopy} className={styles['menu-icon']} /> 复制文件名
                </li>
                <li onClick={() => executeMenuAction('updateBranch')}>
                  <FontAwesomeIcon icon={faRotateRight} className={styles['menu-icon']} /> 更新分支
                </li>
                {contextMenu.payload.customName && (
                  <li onClick={() => executeMenuAction('copyText', contextMenu.payload.customName)}>
                    <FontAwesomeIcon icon={faCopy} className={styles['menu-icon']} /> 复制项目名
                  </li>
                )}
                <li onClick={() => executeMenuAction('copyText', contextMenu.payload.path)}>
                  <FontAwesomeIcon icon={faLink} className={styles['menu-icon']} /> 复制地址链接
                </li>
                {contextMenu.payload.isRemote ? (
                  <li onClick={() => executeMenuAction('openLink')}>
                    <FontAwesomeIcon icon={faGlobe} className={styles['menu-icon']} /> 在浏览器中打开
                  </li>
                ) : (
                  <li onClick={() => executeMenuAction('revealInExplorer')}>
                    <FontAwesomeIcon icon={faFolderOpenReg} className={styles['menu-icon']} /> 在访达/资源管理器中显示
                  </li>
                )}
                {!contextMenu.payload.isActiveProject && (
                  <>
                    <div className={styles['menu-separator']}></div>
                    <li onClick={() => executeMenuAction('delete')} style={{ color: 'var(--vscode-errorForeground)' }}>
                      <FontAwesomeIcon icon={faTrash} className={styles['menu-icon']} /> 移除该项目
                    </li>
                  </>
                )}
              </>
            )}

            {contextMenu.type === 'sub' && (
              <>
                {!contextMenu.payload.isFolder && (
                  <>
                    <li onClick={() => executeMenuAction('openFileToSide')}>
                      <FontAwesomeIcon icon={faColumns} className={styles['menu-icon']} /> 向右拆分
                    </li>
                    <li onClick={() => executeMenuAction('openFileInNewTab')}>
                      <FontAwesomeIcon icon={faWindowRestore} className={styles['menu-icon']} /> 在新标签页打开
                    </li>
                    <li onClick={() => executeMenuAction('copyFile')}>
                      <FontAwesomeIcon icon={faCopy} className={styles['menu-icon']} /> 复制文件
                    </li>
                    <div className={styles['menu-separator']}></div>
                    
                    {/* 🌟 新增：如果是 .md 文件，添加 Vditor 预览按钮 */}
                    {contextMenu.payload.name?.toLowerCase().endsWith('.md') && (
                      <>
                        <li onClick={() => executeMenuAction('previewWithVditor')}>
                          <FontAwesomeIcon icon={faMarkdown} className={styles['menu-icon']} style={{ color: '#5dade2' }} /> 使用 Vditor 查看
                        </li>
                        <div className={styles['menu-separator']}></div>
                      </>
                    )}

                    <li onClick={() => executeMenuAction('selectForCompare')}>
                      <FontAwesomeIcon icon={faSquareCheck} className={styles['menu-icon']} /> 选择以进行比较
                    </li>
                    <li onClick={() => executeMenuAction('compareWithSelected')}>
                      <FontAwesomeIcon icon={faCodeCompare} className={styles['menu-icon']} /> 与已选项目进行比较
                    </li>
                    <div className={styles['menu-separator']}></div>
                  </>
                )}
                {contextMenu.payload.isFolder && (
                  <>
                    {/* 🌟 只有非当前项目的子文件夹才显示查找文件内容 */}
                    {!contextMenu.payload.isActiveProject && (
                      <>
                        <li onClick={() => executeMenuAction('searchInFolder')}>
                          <FontAwesomeIcon icon={faMagnifyingGlass} className={styles['menu-icon']} /> 查找文件内容...
                        </li>
                        <div className={styles['menu-separator']}></div>
                      </>
                    )}
                  </>
                )}
                <li onClick={() => executeMenuAction('copyText', contextMenu.payload.name)}>
                  <FontAwesomeIcon icon={faClone} className={styles['menu-icon']} /> 复制名称
                </li>
                <li onClick={() => executeMenuAction('copyText', contextMenu.payload.path)}>
                  <FontAwesomeIcon icon={faLink} className={styles['menu-icon']} /> 复制路径
                </li>
                {!contextMenu.payload.path.startsWith('vscode-vfs') && !contextMenu.payload.path.startsWith('http') && (
                  <>
                    <div className={styles['menu-separator']}></div>
                    <li onClick={() => executeMenuAction('revealInExplorer', contextMenu.payload.path)}>
                      <FontAwesomeIcon icon={faFolderOpenReg} className={styles['menu-icon']} /> 在访达/资源管理器中显示
                    </li>
                  </>
                )}
              </>
            )}
          </ul>
        </div>
      )}

      {isSearchMode && searchTargetProject ? (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
          <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--vscode-panel-border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              <button className={styles['action-btn-icon']} onClick={() => setIsSearchMode(false)} title="返回项目列表" style={{ padding: '4px' }}>
                <FontAwesomeIcon icon={faArrowLeft} />
              </button>
              <span style={{ fontSize: '13px', fontWeight: 'bold' }}>在文件夹中查找</span>
            </div>
            <div className={styles['search-box']} style={{ padding: '2px 4px' }}>
              <div className={styles['search-tag']} onClick={() => setIsSearchMode(false)} title="取消检索">
                <span className={styles['tag-text']}>{searchTargetProject.originalName || searchTargetProject.name}</span>
                <FontAwesomeIcon icon={faTimes} className={styles['close-icon']} />
              </div>

              <input
                autoFocus
                style={{ flex: 1, background: 'transparent', border: 'none', color: 'var(--vscode-input-foreground)', outline: 'none', padding: '4px 6px', fontSize: '12px', width: '80px' }}
                placeholder="输入关键字按 Enter 搜索"
                value={folderSearchQuery}
                onChange={(e) => setFolderSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Backspace' && folderSearchQuery === '') {
                    setIsSearchMode(false);
                  } else if (e.key === 'Enter' && folderSearchQuery.trim()) {
                    setIsSearchingFolder(true);
                    vscode.postMessage({ type: 'searchInFolder', fsPath: searchTargetProject.path, query: folderSearchQuery, isRemote: searchTargetProject.isRemote });
                  }
                }}
              />

              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', paddingRight: '4px' }}>
                <span style={{ fontSize: '11px', color: 'var(--vscode-descriptionForeground)', minWidth: '40px', textAlign: 'center' }}>
                  {totalMatches > 0 ? currentActiveMatch + 1 : 0} / {totalMatches}
                </span>
                <button className={styles['action-btn-icon']} style={{ padding: '2px 4px' }} onClick={handlePrevSearchMatch} disabled={totalMatches === 0}>
                  <FontAwesomeIcon icon={faArrowUp} />
                </button>
                <button className={styles['action-btn-icon']} style={{ padding: '2px 4px' }} onClick={handleNextSearchMatch} disabled={totalMatches === 0}>
                  <FontAwesomeIcon icon={faArrowDown} />
                </button>
              </div>
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '10px' }}>
            {isSearchingFolder ? (
              <div style={{ textAlign: 'center', padding: '20px', opacity: 0.7 }}>
                <FontAwesomeIcon icon={faSpinner} spin /> 正在高速检索中...
              </div>
            ) : folderSearchError ? (
              <div style={{ color: 'var(--vscode-errorForeground)', fontSize: '12px', padding: '10px', textAlign: 'center' }}>{folderSearchError}</div>
            ) : folderSearchResults.length === 0 && folderSearchQuery ? (
              <div style={{ textAlign: 'center', opacity: 0.6, fontSize: '12px', padding: '20px' }}>没有找到符合条件的代码内容</div>
            ) : (
              <ul>
                {folderSearchResults.map((res, i) => (
                  <li key={i} style={{ marginBottom: '8px' }}>
                    <div style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--vscode-textLink-foreground)', marginBottom: '2px', wordBreak: 'break-all' }}>
                      <FontAwesomeIcon icon={faFileCode} style={{ marginRight: '6px' }} />
                      {res.file}
                    </div>
                    <ul style={{ borderLeft: '1px solid var(--vscode-panel-border)', marginLeft: '6px' }}>
                      {res.matches.map((m: SearchMatch, j: number) => {
                        const globalStartIndex = lineStartIndexMap.get(`${i}-${j}`) || 0;
                        const matchInfo = flatMatchesList[currentActiveMatch];
                        const isLineActive = matchInfo && matchInfo.fileIndex === i && matchInfo.matchIndex === j;

                        return (
                          <li
                            key={j}
                            id={`search-line-${i}-${j}`}
                            onClick={() => {
                              setCurrentActiveMatch(globalStartIndex);
                              vscode.postMessage({ 
                                type: 'openFileAtLine', 
                                fsPath: res.fullPath, 
                                line: m.line,
                                isActiveProject: searchTargetProject.isActiveProject,
                                projectName: searchTargetProject.projectName || searchTargetProject.name || searchTargetProject.originalName
                              });
                            }}
                            style={{
                              fontSize: '12px',
                              padding: '2px 8px',
                              cursor: 'pointer',
                              backgroundColor: isLineActive ? 'var(--vscode-list-activeSelectionBackground)' : 'transparent',
                              color: isLineActive ? 'var(--vscode-list-activeSelectionForeground)' : 'inherit',
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-all',
                              transition: 'background 0.1s',
                              lineHeight: 1.4,
                            }}
                            onMouseEnter={(e) => {
                              if (!isLineActive) e.currentTarget.style.backgroundColor = 'var(--vscode-list-hoverBackground)';
                            }}
                            onMouseLeave={(e) => {
                              if (!isLineActive) e.currentTarget.style.backgroundColor = 'transparent';
                            }}
                          >
                            <span
                              style={{
                                color: isLineActive ? 'inherit' : 'var(--vscode-descriptionForeground)',
                                opacity: 0.8,
                                marginRight: '8px',
                                display: 'inline-block',
                                minWidth: '24px',
                                textAlign: 'right',
                              }}
                            >
                              {m.line}
                            </span>
                            <HighlightText text={m.text} query={folderSearchQuery} globalStartIndex={globalStartIndex} currentActiveMatch={currentActiveMatch} isLineActive={!!isLineActive} />
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : (
        <>
          {projects.length > 0 && (
            <div className={styles['search-container']}>
              <div className={styles['search-box']}>
                <FontAwesomeIcon icon={faMagnifyingGlass} style={{ color: 'var(--vscode-input-placeholderForeground)', fontSize: '12px' }} />
                <input type="text" value={searchQuery} onChange={handleSearch} placeholder="搜索标题、文件夹、地址..." autoComplete="off" spellCheck="false" />
              </div>
            </div>
          )}

          <div className={styles['list-container']} onScroll={() => setContextMenu((p) => ({ ...p, visible: false }))}>
            {projects.length === 0 ? (
              <div className={styles['empty-state']}>
                <div className={styles['empty-text']}>暂无项目记录，请添加：</div>
                <div className={styles['bottom-bar']}>
                  <button className={styles['action-btn']} onClick={() => vscode.postMessage({ type: 'addLocal' })}>
                    <FontAwesomeIcon icon={faFolderPlus} /> 添加本地
                  </button>
                  <button className={`${styles['action-btn']} ${styles['secondary']}`} onClick={() => vscode.postMessage({ type: 'addRemote' })}>
                    <FontAwesomeIcon icon={faGithub} /> 添加远程
                  </button>
                </div>
              </div>
            ) : (
              <>
                {isCurrentVisible &&
                  currentProject &&
                  (() => {
                    const p = currentProject;
                    const isRemote = p.fsPath.startsWith('vscode-vfs') || p.fsPath.startsWith('http');
                    const isGitlab = p.platform === 'gitlab' || p.fsPath.startsWith('vscode-vfs://gitlab');
                    const icon = isRemote ? (isGitlab ? faGitlab : faGithub) : faFolderOpen;
                    const title = p.customName || p.name;
                    const displayPath = getDisplayPath(p);
                    const finalPath = p.customName ? `${p.name} • ${displayPath}` : displayPath;
                    const branch = branchMap[p.fsPath] || p.branch;

                    const rootId = 'active-top';
                    const isExpanded = expandedNodes.has(rootId);

                    return (
                      <div key={rootId}>
                        <div
                          className={`${styles['active-top-project']} ${selectedId === rootId ? styles['selected'] : ''}`}
                          title="当前窗口正在运行的项目"
                          onContextMenu={(e) =>
                            handleContextMenu(
                              e,
                              'top',
                              { path: p.fsPath, isRemote, originalName: p.name, customName: p.customName, platform: p.platform || 'github', customDomain: p.customDomain, isActiveProject: true },
                              rootId,
                            )
                          }
                          onClick={() => setSelectedId(rootId)}
                        >
                          <div className={`${styles['item-left']} ${styles['clickable-expand']}`} onClick={(e) => handleToggleExpand(rootId, p.fsPath, title, isRemote, e)}>
                            <div className={styles['tree-chevron']}>
                              <FontAwesomeIcon icon={isExpanded ? faChevronDown : faChevronRight} style={{ fontSize: '10px' }} />
                            </div>
                            <div className={styles['info']}>
                              <div className={styles['title']}>
                                <FontAwesomeIcon icon={icon} className={`${styles['project-icon']} ${styles['icon-opened']}`} />
                                {/* 🌟 包装项目名称以支持超出省略号 */}
                                <span className={styles['project-name']} title={title}>{title}</span>
                                {branch && (
                                  <span className={styles['branch-tag']} title={branch}>
                                    <FontAwesomeIcon icon={faCodeBranch} style={{ fontSize: '10px', flexShrink: 0 }} /> 
                                    {/* 🌟 包装分支文本以支持超出省略号 */}
                                    <span className={styles['branch-text']}>{branch}</span>
                                  </span>
                                )}
                              </div>
                              <div className={styles['path']}>{finalPath}</div>
                            </div>
                          </div>
                        </div>
                        {isExpanded && <div className={styles['tree-children']}>{renderTreeChildren(rootId, title, true)}</div>}
                        <div className={styles['top-divider']}></div>
                      </div>
                    );
                  })()}

                <ul>
                  {filteredOtherProjects.map((p) => {
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
                      <li key={rootId}>
                        <div
                          className={`${styles['project-item']} ${isJustOpened ? styles['just-opened'] : ''} ${selectedId === rootId ? styles['selected'] : ''}`}
                          onDoubleClick={() => handleOpenProject(p.fsPath)}
                          title={isJustOpened ? '刚刚在此窗口中唤起过' : ''}
                          onContextMenu={(e) =>
                            handleContextMenu(
                              e,
                              'top',
                              { path: p.fsPath, isRemote, originalName: p.name, customName: p.customName, platform: p.platform || 'github', customDomain: p.customDomain, isActiveProject: false },
                              rootId,
                            )
                          }
                          onClick={() => setSelectedId(rootId)}
                        >
                          <div className={`${styles['item-left']} ${styles['clickable-expand']}`} onClick={(e) => handleToggleExpand(rootId, p.fsPath, title, isRemote, e)}>
                            <div className={styles['tree-chevron']}>
                              <FontAwesomeIcon icon={isExpanded ? faChevronDown : faChevronRight} style={{ fontSize: '10px' }} />
                            </div>
                            <div className={styles['info']}>
                              <div className={styles['title']}>
                                <FontAwesomeIcon icon={icon} className={`${styles['project-icon']} ${styles['icon-closed']}`} />
                                {/* 🌟 包装项目名称以支持超出省略号 */}
                                <span className={styles['project-name']} title={title}>{title}</span>
                                {branch && (
                                  <span className={styles['branch-tag']} title={branch}>
                                    <FontAwesomeIcon icon={faCodeBranch} style={{ fontSize: '10px', flexShrink: 0 }} /> 
                                    {/* 🌟 包装分支文本以支持超出省略号 */}
                                    <span className={styles['branch-text']}>{branch}</span>
                                  </span>
                                )}
                              </div>
                              <div className={styles['path']}>{finalPath}</div>
                            </div>
                          </div>

                          <div className={styles['item-actions']}>
                            <button className={`${styles['action-btn-icon']} ${styles['open-btn']}`} onClick={(e) => handleOpenCurrent(p.fsPath, e)} title="在当前窗口打开">
                              <FontAwesomeIcon icon={faArrowRightToBracket} />
                            </button>
                          </div>
                        </div>
                        {isExpanded && <div className={styles['tree-children']}>{renderTreeChildren(rootId, title)}</div>}
                      </li>
                    );
                  })}
                </ul>

                {searchQuery && filteredOtherProjects.length === 0 && !isCurrentVisible && (
                  <div style={{ textAlign: 'center', padding: '20px', fontSize: '12px', color: 'var(--vscode-descriptionForeground)' }}>没有找到匹配的项目...</div>
                )}
              </>
            )}
          </div>

          {projects.length > 0 && (
            <div className={styles['bottom-bar']}>
              <button className={styles['action-btn']} onClick={() => vscode.postMessage({ type: 'addLocal' })} style={{ marginBottom: 0 }}>
                <FontAwesomeIcon icon={faFolderPlus} /> 添加本地
              </button>
              <button className={`${styles['action-btn']} ${styles['secondary']}`} onClick={() => vscode.postMessage({ type: 'addRemote' })} style={{ marginBottom: 0 }}>
                <FontAwesomeIcon icon={faGithub} /> 添加远程
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}