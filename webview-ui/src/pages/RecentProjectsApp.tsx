import React, { useEffect, useState, useRef, useMemo } from 'react';
import { vscode } from '../utils/vscode';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faMagnifyingGlass, faFolderOpen, faFolderPlus, faCodeBranch, faChevronRight, faChevronDown, faArrowRightToBracket, faFolder, faSpinner } from '@fortawesome/free-solid-svg-icons';
import { faGithub, faGitlab } from '@fortawesome/free-brands-svg-icons';

import styles from '../assets/css/RecentProjectsApp.module.css';
import FileIcon from '../components/FileIcon';
import RecentProjectContextMenu from '../components/RecentProjectContextMenu/index';
import type { Project, DirChild, SearchMatch, SearchResult, ContextMenuPayload } from '../types/RecentProjectsApp';

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

  const [searchQuery, setSearchQuery] = useState<string>((vscode.getState() as any)?.searchQuery || '');
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

  const [folderSearchType, setFolderSearchType] = useState<'content' | 'name'>('content');
  const [fileNameSearchResults, setFileNameSearchResults] = useState<DirChild[]>([]);

  const [folderSearchResults, setFolderSearchResults] = useState<SearchResult[]>([]);
  const [isSearchingFolder, setIsSearchingFolder] = useState(false);
  const [folderSearchError, setFolderSearchError] = useState('');
  const [currentActiveMatch, setCurrentActiveMatch] = useState(0);

  const { lineStartIndexMap, totalMatches, flatMatchesList } = useMemo(() => {
    const map = new Map<string, number>();
    const list: { fileIndex: number; matchIndex: number; lineGlobalIndex: number; fullPath: string; lineNum: number }[] = [];
    let idx = 0;

    if (!folderSearchQuery || folderSearchType === 'name') return { lineStartIndexMap: map, totalMatches: 0, flatMatchesList: list };

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
  }, [folderSearchResults, folderSearchQuery, folderSearchType]);

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
      } else if (msg.type === 'searchFileNameResult') {
        setIsSearchingFolder(false);
        if (msg.error) {
          setFolderSearchError(msg.error as string);
          setFileNameSearchResults([]);
        } else {
          setFolderSearchError('');
          setFileNameSearchResults((msg.results as DirChild[]) || []);
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

  useEffect(() => {
    if (!isSearchMode || !searchTargetProject) return;

    if (!folderSearchQuery.trim()) {
      setFolderSearchResults([]);
      setFileNameSearchResults([]);
      setFolderSearchError('');
      setIsSearchingFolder(false);
      return;
    }

    const timeoutId = setTimeout(() => {
      setIsSearchingFolder(true);
      if (folderSearchType === 'content') {
        vscode.postMessage({
          type: 'searchInFolder',
          fsPath: searchTargetProject.path,
          query: folderSearchQuery,
          isRemote: searchTargetProject.isRemote,
        });
      } else {
        vscode.postMessage({
          type: 'searchFileName',
          fsPath: searchTargetProject.path,
          query: folderSearchQuery,
          isRemote: searchTargetProject.isRemote,
        });
      }
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [folderSearchQuery, isSearchMode, searchTargetProject, folderSearchType]);

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
    return full.includes(String(searchQuery).toLowerCase().trim());
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
    if (path.toLowerCase().endsWith('.md')) {
      vscode.postMessage({ type: 'previewWithVditor', fsPath: path, projectName, isActiveProject });
    } else {
      vscode.postMessage({ type: isActiveProject ? 'openFileNormal' : 'openFile', fsPath: path, projectName });
    }
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
        setFileNameSearchResults([]);
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
                  title={isActiveProject ? '点击打开文件' : '点击预览'}
                >
                  <div className={styles['chevron-placeholder']}></div>
                  <FileIcon fileName={child.name} className={styles['sub-icon']} />
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
      {/* 🌟 抽离出去的右键菜单组件 */}
      <RecentProjectContextMenu
        visible={contextMenu.visible}
        x={contextMenu.x}
        y={contextMenu.y}
        type={contextMenu.type}
        payload={contextMenu.payload}
        menuRef={menuRef}
        onAction={executeMenuAction}
      />

      {isSearchMode && searchTargetProject ? (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
          <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--vscode-panel-border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                {/* 🌟 使用 Codicon 替换了原生返回图标 */}
                <button className={styles['action-btn-icon']} onClick={() => setIsSearchMode(false)} title="返回项目列表" style={{ padding: '4px', flexShrink: 0 }}>
                  <span className="codicon codicon-arrow-small-left" style={{ fontSize: '16px' }}></span>
                </button>

                {/* 🌟 动态拼接父级项目名称的标题栏 */}
                <span
                  style={{
                    fontSize: '13px',
                    fontWeight: 'bold',
                    color: 'var(--vscode-foreground)',
                    flexShrink: 0,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                  title={
                    searchTargetProject.projectName
                      ? `${searchTargetProject.projectName} / ${searchTargetProject.name}`
                      : searchTargetProject.customName || searchTargetProject.originalName || searchTargetProject.name
                  }
                >
                  {searchTargetProject.projectName ? (
                    <>
                      {searchTargetProject.projectName} <span style={{ opacity: 0.6, fontWeight: 'normal' }}>/ {searchTargetProject.name}</span>
                    </>
                  ) : (
                    searchTargetProject.customName || searchTargetProject.originalName || searchTargetProject.name
                  )}
                </span>
              </div>

              {folderSearchType === 'content' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                  {/* 🌟 使用 Codicon 替换了上下查找箭头 */}
                  <button className={styles['action-btn-icon']} style={{ padding: '2px 4px' }} onClick={handlePrevSearchMatch} disabled={totalMatches === 0} title="上一个匹配项">
                    <span className="codicon codicon-arrow-small-up" style={{ fontSize: '16px' }}></span>
                  </button>
                  <button className={styles['action-btn-icon']} style={{ padding: '2px 4px' }} onClick={handleNextSearchMatch} disabled={totalMatches === 0} title="下一个匹配项">
                    <span className="codicon codicon-arrow-small-down" style={{ fontSize: '16px' }}></span>
                  </button>
                </div>
              )}
            </div>

            <div className={styles['search-box']} style={{ padding: '2px 4px', display: 'flex', alignItems: 'center' }}>
              {/* 🌟 使用 Codicon 替换了文件/文件内容类型切换图标 */}
              <span
                className={`codicon ${folderSearchType === 'content' ? 'codicon-file-text' : 'codicon-file'}`}
                onClick={() => {
                  const newType = folderSearchType === 'content' ? 'name' : 'content';
                  setFolderSearchType(newType);
                  setFolderSearchQuery('');
                  setFolderSearchResults([]);
                  setFileNameSearchResults([]);
                  setFolderSearchError('');
                }}
                style={{ cursor: 'pointer', color: 'var(--vscode-textLink-foreground)', fontSize: '14px', marginLeft: '6px', marginRight: '6px' }}
                title={folderSearchType === 'content' ? '当前：文件内容检索。点击切换为「文件名/文件夹」检索' : '当前：文件名/文件夹检索。点击切换为「文件内容」检索'}
              ></span>

              <input
                autoFocus
                style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', color: 'var(--vscode-input-foreground)', outline: 'none', padding: '4px 6px', fontSize: '12px' }}
                placeholder={folderSearchType === 'content' ? '输入关键字自动检索文件内容...' : '输入关键字自动检索文件或文件夹名称...'}
                value={folderSearchQuery}
                onChange={(e) => setFolderSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Backspace' && folderSearchQuery === '') {
                    setIsSearchMode(false);
                  }
                }}
              />

              {folderSearchType === 'content' && (
                <span style={{ fontSize: '11px', color: 'var(--vscode-descriptionForeground)', minWidth: '40px', textAlign: 'center', paddingRight: '4px', flexShrink: 0 }}>
                  {totalMatches > 0 ? currentActiveMatch + 1 : 0} / {totalMatches}
                </span>
              )}
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '10px' }}>
            {isSearchingFolder ? (
              <div style={{ textAlign: 'center', padding: '20px', opacity: 0.7 }}>
                <FontAwesomeIcon icon={faSpinner} spin /> 正在高速检索中...
              </div>
            ) : folderSearchError ? (
              <div style={{ color: 'var(--vscode-errorForeground)', fontSize: '12px', padding: '10px', textAlign: 'center' }}>{folderSearchError}</div>
            ) : folderSearchType === 'content' ? (
              folderSearchResults.length === 0 && folderSearchQuery ? (
                <div style={{ textAlign: 'center', opacity: 0.6, fontSize: '12px', padding: '20px' }}>没有找到符合条件的代码内容</div>
              ) : (
                <ul>
                  {folderSearchResults.map((res, i) => (
                    <li key={i} style={{ marginBottom: '8px' }}>
                      <div
                        style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--vscode-textLink-foreground)', marginBottom: '2px', wordBreak: 'break-all', display: 'flex', alignItems: 'center' }}
                      >
                        <FileIcon fileName={res.file} style={{ marginRight: '6px' }} />
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
                                  projectName: searchTargetProject.projectName || searchTargetProject.name || searchTargetProject.originalName,
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
              )
            ) : fileNameSearchResults.length === 0 && folderSearchQuery ? (
              <div style={{ textAlign: 'center', opacity: 0.6, fontSize: '12px', padding: '20px' }}>没有找到匹配的文件或文件夹</div>
            ) : (
              <ul>
                {fileNameSearchResults.map((child, idx) => {
                  const childId = `name_search_${idx}_${child.path}`;
                  const isExpanded = expandedNodes.has(childId);
                  const isRemote = child.path.startsWith('vscode-vfs') || child.path.startsWith('http');
                  const targetProjName = searchTargetProject.projectName || searchTargetProject.name || searchTargetProject.originalName || '';

                  if (child.isFolder) {
                    return (
                      <li key={childId} style={{ marginBottom: '2px' }}>
                        <div
                          className={`${styles['sub-item']} ${styles['clickable-sub']} ${selectedId === childId ? styles['selected'] : ''}`}
                          onClick={(e) => handleToggleExpand(childId, child.path, targetProjName, isRemote, e)}
                          style={{ paddingLeft: '4px' }}
                        >
                          <div className={styles['tree-chevron']}>
                            <FontAwesomeIcon icon={isExpanded ? faChevronDown : faChevronRight} style={{ fontSize: '10px' }} />
                          </div>
                          <FontAwesomeIcon icon={faFolder} className={`${styles['icon-closed']} ${styles['sub-icon']}`} />
                          <span className={styles['sub-name']}>
                            <HighlightText text={child.name} query={folderSearchQuery} globalStartIndex={-2} currentActiveMatch={-1} isLineActive={false} />
                          </span>
                        </div>
                        {isExpanded && (
                          <div className={styles['tree-children']} style={{ paddingLeft: '8px' }}>
                            {renderTreeChildren(childId, targetProjName, searchTargetProject.isActiveProject)}
                          </div>
                        )}
                      </li>
                    );
                  } else {
                    return (
                      <li key={childId} style={{ marginBottom: '2px' }}>
                        <div
                          className={`${styles['sub-item']} ${selectedId === childId ? styles['selected'] : ''}`}
                          onClick={(e) => handleOpenFile(child.path, targetProjName, childId, !!searchTargetProject.isActiveProject, e)}
                          style={{ cursor: 'pointer', paddingLeft: '4px' }}
                        >
                          <div className={styles['chevron-placeholder']}></div>
                          <FileIcon fileName={child.name} className={styles['sub-icon']} />
                          <span className={styles['sub-name']}>
                            <HighlightText text={child.name} query={folderSearchQuery} globalStartIndex={-2} currentActiveMatch={-1} isLineActive={false} />
                          </span>
                        </div>
                      </li>
                    );
                  }
                })}
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
                    <FontAwesomeIcon icon={faFolderPlus} /> 添加本地项目
                  </button>
                  <button className={`${styles['action-btn']} ${styles['secondary']}`} onClick={() => vscode.postMessage({ type: 'addRemote' })}>
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
                                <span className={styles['project-name']} title={title}>
                                  {title}
                                </span>
                                {branch && (
                                  <span className={styles['branch-tag']} title={branch}>
                                    <FontAwesomeIcon icon={faCodeBranch} style={{ fontSize: '10px', flexShrink: 0 }} />
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
                                <span className={styles['project-name']} title={title}>
                                  {title}
                                </span>
                                {branch && (
                                  <span className={styles['branch-tag']} title={branch}>
                                    <FontAwesomeIcon icon={faCodeBranch} style={{ fontSize: '10px', flexShrink: 0 }} />
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
