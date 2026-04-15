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

// 🌟 1. 定义所有核心数据结构的 TypeScript 接口
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

// 🌟 2. 移除任何 any 声明，使用强类型
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
      return <FontAwesomeIcon icon={faJs} className="file-icon-js sub-icon" />;
    case 'ts':
    case 'tsx':
      return <FontAwesomeIcon icon={faJs} className="file-icon-ts sub-icon" />;
    case 'vue':
      return <FontAwesomeIcon icon={faVuejs} className="file-icon-vue sub-icon" />;
    case 'html':
      return <FontAwesomeIcon icon={faHtml5} className="file-icon-html sub-icon" />;
    case 'css':
    case 'scss':
    case 'less':
      return <FontAwesomeIcon icon={faCss3Alt} className="file-icon-css sub-icon" />;
    case 'json':
      return <FontAwesomeIcon icon={faFileCode} className="file-icon-json sub-icon" />;
    case 'md':
      return <FontAwesomeIcon icon={faMarkdown} className="file-icon-md sub-icon" />;
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg':
    case 'ico':
      return <FontAwesomeIcon icon={faImage} className="file-icon-img sub-icon" />;
    default:
      return <FontAwesomeIcon icon={faFileCode} className="file-icon-default sub-icon" />;
  }
}

// 🌟 修复：能够识别当前激活的关键词，并支持一行多关键词精准高亮
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

  // 文件夹内容搜索机制状态
  const [isSearchMode, setIsSearchMode] = useState(false);
  const [searchTargetProject, setSearchTargetProject] = useState<ContextMenuPayload | null>(null);
  const [folderSearchQuery, setFolderSearchQuery] = useState('');
  const [folderSearchResults, setFolderSearchResults] = useState<SearchResult[]>([]);
  const [isSearchingFolder, setIsSearchingFolder] = useState(false);
  const [folderSearchError, setFolderSearchError] = useState('');
  const [currentActiveMatch, setCurrentActiveMatch] = useState(0);

  // 🌟 核心修复：按“关键字出现次数”统计总数并映射导航索引，而不是按“行”
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

        // 统计本行出现了多少次关键字
        let occurrencesCount = 0;
        const parts = m.text.split(regex);
        parts.forEach((part: string) => {
          if (part.toLowerCase() === folderSearchQuery.toLowerCase()) occurrencesCount++;
        });

        const count = Math.max(1, occurrencesCount);
        for (let k = 0; k < count; k++) {
          list.push({ fileIndex, matchIndex, lineGlobalIndex: startIdx, fullPath: res.fullPath, lineNum: m.line });
        }
        idx += count; // 累加真实关键字数量
      });
    });

    return { lineStartIndexMap: map, totalMatches: idx, flatMatchesList: list };
  }, [folderSearchResults, folderSearchQuery]);

  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      // 禁用 eslint 检测 e.data 的隐式 any，或者在内部使用类型断言
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

  // 修复 useRef 的类型
  const clickTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleOpenProject = (path: string) => {
    if (clickTimeout.current) clearTimeout(clickTimeout.current);
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
        vscode.postMessage({ type: 'openFileToSide', fsPath: payload.path, projectName: payload.projectName });
        break;
      case 'openFileInNewTab':
        vscode.postMessage({ type: 'openFileInNewTab', fsPath: payload.path, projectName: payload.projectName });
        break;
      case 'updateBranch':
        vscode.postMessage({ type: 'updateSingleBranch', fsPath: payload.path });
        break;
      case 'selectForCompare':
        vscode.postMessage({ type: 'selectForCompare', fsPath: payload.path, projectName: payload.projectName });
        break;
      case 'compareWithSelected':
        vscode.postMessage({ type: 'compareWithSelected', fsPath: payload.path, projectName: payload.projectName });
        break;

      case 'searchInFolder':
        setSearchTargetProject(payload);
        setIsSearchMode(true);
        setFolderSearchQuery('');
        setFolderSearchResults([]);
        setFolderSearchError('');
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

  const renderTreeChildren = (parentId: string, projectName: string) => {
    const children = dirChildren[parentId];
    if (loadingNodes.has(parentId)) {
      return (
        <div className="empty-node">
          <FontAwesomeIcon icon={faSpinner} spin /> 加载中...
        </div>
      );
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
                <div
                  className={`sub-item clickable-sub ${selectedId === childId ? 'selected' : ''}`}
                  onClick={(e) => handleToggleExpand(childId, child.path, projectName, isRemote, e)}
                  onContextMenu={(e) => handleContextMenu(e, 'sub', { path: child.path, name: child.name, isFolder: true, projectName }, childId)}
                >
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
                <div
                  className={`sub-item ${selectedId === childId ? 'selected' : ''}`}
                  onClick={(e) => handleOpenFile(child.path, projectName, childId, e)}
                  onContextMenu={(e) => handleContextMenu(e, 'sub', { path: child.path, name: child.name, isFolder: false, projectName }, childId)}
                  style={{ cursor: 'pointer' }}
                  title="点击以只读模式预览"
                >
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

        .info { gap:2px; overflow: hidden; display: flex; flex-direction: column; flex: 1; padding: 2px 0; pointer-events: none; }
        .title { line-height:1; font-size: 13px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: flex; align-items: center; pointer-events: auto; }
        .path { line-height:1; font-size: 10px; opacity: 0.6; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;text-align:left }
        
        .branch-tag { line-height:1; font-size: 10px; background: var(--vscode-badge-background, rgba(128, 128, 128, 0.15)); color: var(--vscode-badge-foreground, var(--vscode-descriptionForeground)); padding: 2px 6px; border-radius: 10px; display: inline-flex; align-items: center; gap: 3px; margin-left: 8px; border: 1px solid var(--vscode-panel-border);}
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
        .empty-state { height: 100%;display: flex;flex-direction: column;text-align: center; }
        .empty-text { display:flex;justify-content: center;align-items: center;flex:1;opacity: 0.6; font-size: 13px; margin-bottom: 20px; }
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

        .search-tag {
            position: relative;
            max-width: 80px;
            min-width: 60px;
            background: var(--vscode-badge-background, #4d4d4d);
            color: var(--vscode-badge-foreground, #ffffff);
            padding: 2px 6px;
            border-radius: 2px;
            font-size: 11px;
            display: flex;
            align-items: center;
            cursor: pointer;
            line-height: 14px;
            margin-right: 4px;
            overflow: visible;
            text-align:center;
        }
        .search-tag .tag-text {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            width: 100%;
            transition: opacity 0.1s;
        }
        
        .search-tag .close-icon {
            position: absolute;
            top: -5px;   
            right: -4px; 
            font-size: 11px; 
            color: #ffffff;
            background: transparent;
            border: none;
            box-shadow: none;
            display: flex;
            align-items: center;
            justify-content: center;
            opacity: 0;
            transform: scale(0.8);
            transition: all 0.15s ease-in-out;
            filter: drop-shadow(0 1px 2px rgba(0,0,0,0.6));
        }
        
        .search-tag:hover .close-icon {
            opacity: 1;
            transform: scale(1);
        }
        
        .search-tag .close-icon:hover {
            color: var(--vscode-errorForeground, #f14c4c);
            background: transparent;
            transform: scale(1.2); 
        }
        
        .search-tag:hover .tag-text {
            opacity: 0.6;
        }
      `}</style>

      {contextMenu.visible && (
        <div id="context-menu" ref={menuRef} style={{ left: contextMenu.x, top: contextMenu.y }}>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {contextMenu.type === 'top' && (
              <>
                <li onClick={() => executeMenuAction('openInNewWindow')}>
                  <FontAwesomeIcon icon={faArrowUpRightFromSquare} className="menu-icon" /> 在新窗口打开
                </li>
                <div className="menu-separator"></div>
                <li onClick={() => executeMenuAction('searchInFolder')}>
                  <FontAwesomeIcon icon={faMagnifyingGlass} className="menu-icon" /> 查找文件内容...
                </li>
                <div className="menu-separator"></div>

                <li onClick={() => executeMenuAction('edit')}>
                  <FontAwesomeIcon icon={faPen} className="menu-icon" /> 编辑项目名称
                </li>
                <li onClick={() => executeMenuAction('changeAddress')}>
                  <FontAwesomeIcon icon={faLocationDot} className="menu-icon" /> 更换地址
                </li>
                {contextMenu.payload.isRemote && (
                  <li onClick={() => executeMenuAction('switchBranch')}>
                    <FontAwesomeIcon icon={faCodeBranch} className="menu-icon" /> 切换分支
                  </li>
                )}
                <div className="menu-separator"></div>
                <li onClick={() => executeMenuAction('copyText', contextMenu.payload.originalName)}>
                  <FontAwesomeIcon icon={faCopy} className="menu-icon" /> 复制文件名
                </li>
                <li onClick={() => executeMenuAction('updateBranch')}>
                  <FontAwesomeIcon icon={faRotateRight} className="menu-icon" /> 更新分支
                </li>
                {contextMenu.payload.customName && (
                  <li onClick={() => executeMenuAction('copyText', contextMenu.payload.customName)}>
                    <FontAwesomeIcon icon={faCopy} className="menu-icon" /> 复制项目名
                  </li>
                )}
                <li onClick={() => executeMenuAction('copyText', contextMenu.payload.path)}>
                  <FontAwesomeIcon icon={faLink} className="menu-icon" /> 复制地址链接
                </li>
                {contextMenu.payload.isRemote ? (
                  <li onClick={() => executeMenuAction('openLink')}>
                    <FontAwesomeIcon icon={faGlobe} className="menu-icon" /> 在浏览器中打开
                  </li>
                ) : (
                  <li onClick={() => executeMenuAction('revealInExplorer')}>
                    <FontAwesomeIcon icon={faFolderOpenReg} className="menu-icon" /> 在访达/资源管理器中显示
                  </li>
                )}
                {!contextMenu.payload.isActiveProject && (
                  <>
                    <div className="menu-separator"></div>
                    <li onClick={() => executeMenuAction('delete')} style={{ color: 'var(--vscode-errorForeground)' }}>
                      <FontAwesomeIcon icon={faTrash} className="menu-icon" /> 移除该项目
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
                      <FontAwesomeIcon icon={faColumns} className="menu-icon" /> 向右拆分
                    </li>
                    <li onClick={() => executeMenuAction('openFileInNewTab')}>
                      <FontAwesomeIcon icon={faWindowRestore} className="menu-icon" /> 在新标签页打开
                    </li>
                    <li onClick={() => executeMenuAction('copyFile')}>
                      <FontAwesomeIcon icon={faCopy} className="menu-icon" /> 复制文件
                    </li>
                    <div className="menu-separator"></div>
                    <li onClick={() => executeMenuAction('selectForCompare')}>
                      <FontAwesomeIcon icon={faSquareCheck} className="menu-icon" /> 选择以进行比较
                    </li>
                    <li onClick={() => executeMenuAction('compareWithSelected')}>
                      <FontAwesomeIcon icon={faCodeCompare} className="menu-icon" /> 与已选项目进行比较
                    </li>
                    <div className="menu-separator"></div>
                  </>
                )}
                {contextMenu.payload.isFolder && (
                  <>
                    <li onClick={() => executeMenuAction('searchInFolder')}>
                      <FontAwesomeIcon icon={faMagnifyingGlass} className="menu-icon" /> 查找文件内容...
                    </li>
                    <div className="menu-separator"></div>
                  </>
                )}
                <li onClick={() => executeMenuAction('copyText', contextMenu.payload.name)}>
                  <FontAwesomeIcon icon={faClone} className="menu-icon" /> 复制名称
                </li>
                <li onClick={() => executeMenuAction('copyText', contextMenu.payload.path)}>
                  <FontAwesomeIcon icon={faLink} className="menu-icon" /> 复制路径
                </li>
                {!contextMenu.payload.path.startsWith('vscode-vfs') && !contextMenu.payload.path.startsWith('http') && (
                  <>
                    <div className="menu-separator"></div>
                    <li onClick={() => executeMenuAction('revealInExplorer', contextMenu.payload.path)}>
                      <FontAwesomeIcon icon={faFolderOpenReg} className="menu-icon" /> 在访达/资源管理器中显示
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
              <button className="action-btn-icon" onClick={() => setIsSearchMode(false)} title="返回项目列表" style={{ padding: '4px' }}>
                <FontAwesomeIcon icon={faArrowLeft} />
              </button>
              <span style={{ fontSize: '13px', fontWeight: 'bold' }}>在文件夹中查找</span>
            </div>
            <div className="search-box" style={{ padding: '2px 4px' }}>
              <div className="search-tag" onClick={() => setIsSearchMode(false)} title="取消检索">
                <span className="tag-text">{searchTargetProject.originalName || searchTargetProject.name}</span>
                <FontAwesomeIcon icon={faTimes} className="close-icon" />
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
                <button className="action-btn-icon" style={{ padding: '2px 4px' }} onClick={handlePrevSearchMatch} disabled={totalMatches === 0}>
                  <FontAwesomeIcon icon={faArrowUp} />
                </button>
                <button className="action-btn-icon" style={{ padding: '2px 4px' }} onClick={handleNextSearchMatch} disabled={totalMatches === 0}>
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
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {folderSearchResults.map((res, i) => (
                  <li key={i} style={{ marginBottom: '8px' }}>
                    <div style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--vscode-textLink-foreground)', marginBottom: '2px', wordBreak: 'break-all' }}>
                      <FontAwesomeIcon icon={faFileCode} style={{ marginRight: '6px' }} />
                      {res.file}
                    </div>
                    <ul style={{ listStyle: 'none', padding: 0, margin: 0, borderLeft: '1px solid var(--vscode-panel-border)', marginLeft: '6px' }}>
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
                              vscode.postMessage({ type: 'openFileAtLine', fsPath: res.fullPath, line: m.line });
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
            <div className="search-container">
              <div className="search-box">
                <FontAwesomeIcon icon={faMagnifyingGlass} style={{ color: 'var(--vscode-input-placeholderForeground)', fontSize: '12px' }} />
                <input type="text" value={searchQuery} onChange={handleSearch} placeholder="搜索标题、文件夹、地址..." autoComplete="off" spellCheck="false" />
              </div>
            </div>
          )}

          <div className="list-container" onScroll={() => setContextMenu((p) => ({ ...p, visible: false }))}>
            {projects.length === 0 ? (
              <div className="empty-state">
                <div className="empty-text">暂无项目记录，请添加：</div>
                <div className="bottom-bar">
                  <button className="action-btn" onClick={() => vscode.postMessage({ type: 'addLocal' })}>
                    <FontAwesomeIcon icon={faFolderPlus} /> 添加本地项目
                  </button>
                  <button className="action-btn secondary" onClick={() => vscode.postMessage({ type: 'addRemote' })}>
                    <FontAwesomeIcon icon={faGithub} /> 添加远程仓库
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

                    return (
                      <div key="active-top">
                        <div
                          className={`active-top-project ${selectedId === 'active-top' ? 'selected' : ''}`}
                          title="当前窗口正在运行的项目"
                          onContextMenu={(e) =>
                            handleContextMenu(
                              e,
                              'top',
                              { path: p.fsPath, isRemote, originalName: p.name, customName: p.customName, platform: p.platform || 'github', customDomain: p.customDomain, isActiveProject: true },
                              'active-top',
                            )
                          }
                          onClick={() => setSelectedId('active-top')}
                        >
                          <div className="item-left">
                            <div className="tree-chevron" style={{ visibility: 'hidden' }}></div>
                            <div className="info">
                              <div className="title">
                                <FontAwesomeIcon icon={icon} className="project-icon icon-opened" />
                                {title}
                                {branch && (
                                  <span className="branch-tag">
                                    <FontAwesomeIcon icon={faCodeBranch} style={{ fontSize: '10px' }} /> {branch}
                                  </span>
                                )}
                              </div>
                              <div className="path">{finalPath}</div>
                            </div>
                          </div>
                        </div>
                        <div className="top-divider"></div>
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
                      <li key={rootId} className="tree-node">
                        <div
                          className={`project-item ${isJustOpened ? 'just-opened' : ''} ${selectedId === rootId ? 'selected' : ''}`}
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
                          <div className="item-left clickable-expand" onClick={(e) => handleToggleExpand(rootId, p.fsPath, title, isRemote, e)}>
                            <div className="tree-chevron">
                              <FontAwesomeIcon icon={isExpanded ? faChevronDown : faChevronRight} style={{ fontSize: '10px' }} />
                            </div>
                            <div className="info">
                              <div className="title">
                                <FontAwesomeIcon icon={icon} className="project-icon icon-closed" />
                                {title}
                                {branch && (
                                  <span className="branch-tag">
                                    <FontAwesomeIcon icon={faCodeBranch} style={{ fontSize: '10px' }} /> {branch}
                                  </span>
                                )}
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

                {searchQuery && filteredOtherProjects.length === 0 && !isCurrentVisible && (
                  <div style={{ textAlign: 'center', padding: '20px', fontSize: '12px', color: 'var(--vscode-descriptionForeground)' }}>没有找到匹配的项目...</div>
                )}
              </>
            )}
          </div>

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
        </>
      )}
    </div>
  );
}
