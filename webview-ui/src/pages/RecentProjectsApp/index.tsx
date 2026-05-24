import React, { useEffect, useState, useRef, useMemo } from 'react';
import { vscode } from '../../utils/vscode';
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
  faSpinner,
} from '@fortawesome/free-solid-svg-icons';
import { faGithub, faGitlab } from '@fortawesome/free-brands-svg-icons';
import styles from './index.module.css';
import FileIcon from '../../components/FileIcon';
import RecentProjectContextMenu from '../../components/RecentProjectContextMenu';
import SearchViewWrapper from '../../components/SearchViewWrapper';
import { isImageFile, isExcelFile, isPdfFile, getDisplayPath } from '../../utils';
import type {
  Project,
  DirChild,
  SearchMatch,
  SearchResult,
  ContextMenuPayload,
} from '../../types/RecentProjectsApp';

export default function RecentProjectsApp() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentUri, setCurrentUri] = useState('');
  const [currentWorkspace, setCurrentWorkspace] = useState<Project | null>(null);
  const [isInitLoading, setIsInitLoading] = useState(true);

  const [lastOpenedPath, setLastOpenedPath] = useState('');

  const getInitialSearchQuery = () => {
    const state = vscode.getState() as { searchQuery?: string } | undefined;

    if (!state) {
      return '';
    }

    return state.searchQuery || '';
  };

  const [searchQuery, setSearchQuery] = useState<string>(getInitialSearchQuery);

  const [selectedPath, setSelectedPath] = useState<string>('');
  const autoScrollTarget = useRef<string | null>(null);

  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set());
  const [dirChildren, setDirChildren] = useState<Record<string, DirChild[]>>({});
  const dirChildrenRef = useRef<Record<string, DirChild[]>>({});

  useEffect(() => {
    dirChildrenRef.current = dirChildren;
  }, [dirChildren]);

  const [branchMap, setBranchMap] = useState<Record<string, string>>({});
  const [contextMenu, setContextMenu] = useState<{
    visible: boolean;
    x: number;
    y: number;
    type: 'top' | 'sub';
    payload: ContextMenuPayload;
  }>({
    visible: false,
    x: 0,
    y: 0,
    type: 'top',
    payload: { path: '' },
  });

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
    const list: {
      fileIndex: number;
      matchIndex: number;
      lineGlobalIndex: number;
      fullPath: string;
      lineNum: number;
    }[] = [];

    let idx = 0;

    if (!folderSearchQuery || folderSearchType === 'name') {
      return {
        lineStartIndexMap: map,
        totalMatches: 0,
        flatMatchesList: list,
      };
    }

    const safeQuery = folderSearchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${safeQuery})`, 'gi');

    folderSearchResults.forEach((res, fileIndex) => {
      res.matches.forEach((m: SearchMatch, matchIndex: number) => {
        const startIdx = idx;
        map.set(`${fileIndex}-${matchIndex}`, startIdx);

        let occurrencesCount = 0;
        const parts = m.text.split(regex);

        parts.forEach((part: string) => {
          if (part.toLowerCase() === folderSearchQuery.toLowerCase()) {
            occurrencesCount++;
          }
        });

        const count = Math.max(1, occurrencesCount);

        for (let k = 0; k < count; k++) {
          list.push({
            fileIndex,
            matchIndex,
            lineGlobalIndex: startIdx,
            fullPath: res.fullPath,
            lineNum: m.line,
          });
        }

        idx += count;
      });
    });

    return {
      lineStartIndexMap: map,
      totalMatches: idx,
      flatMatchesList: list,
    };
  }, [folderSearchResults, folderSearchQuery, folderSearchType]);

  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      const msg = e.data as Record<string, unknown>;

      if (msg.type === 'updateProjects') {
        const data = (msg.data as Project[]) || [];

        setProjects(data);
        setCurrentUri((msg.currentUriStr as string) || '');
        setLastOpenedPath((msg.lastOpenedPath as string) || '');
        setCurrentWorkspace((msg.currentWorkspace as Project) || null);
        setIsInitLoading(false);

        if (msg.activeFilePath) {
          setSelectedPath(msg.activeFilePath as string);
        }

        setBranchMap((prev) => {
          const newMap = { ...prev };
          const validPaths = new Set(data.map((p) => p.fsPath));

          if (msg.currentUriStr) {
            validPaths.add(msg.currentUriStr as string);
          }

          Object.keys(newMap).forEach((key) => {
            if (!validPaths.has(key)) {
              delete newMap[key];
            }
          });

          data.forEach((p: Project) => {
            if (p.branch) {
              newMap[p.fsPath] = p.branch;
            }
          });

          return newMap;
        });
      } else if (msg.type === 'activeEditorChanged') {
        setSelectedPath(msg.fsPath as string);
      } else if (msg.type === 'updateBranchTag') {
        setBranchMap((prev) => ({
          ...prev,
          [msg.fsPath as string]: msg.branch as string,
        }));
      } else if (msg.type === 'readDirResult') {
        const pathKey = msg.fsPath as string;

        setLoadingPaths((prev) => {
          const n = new Set(prev);
          n.delete(pathKey);
          return n;
        });

        setDirChildren((prev) => ({
          ...prev,
          [pathKey]: (msg.children as DirChild[]) || [],
        }));
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
      } else if (msg.type === 'revealPath') {
        const { targetPath, parentPaths, projectName } = msg as any;

        setSelectedPath(targetPath);
        autoScrollTarget.current = targetPath;

        setExpandedPaths((prev) => {
          const next = new Set(prev);
          parentPaths.forEach((p: string) => next.add(p));
          return next;
        });

        parentPaths.forEach((p: string) => {
          if (!dirChildrenRef.current[p]) {
            setLoadingPaths((l) => new Set(l).add(p));
            vscode.postMessage({
              type: 'readDir',
              fsPath: p,
              projectName,
            });
          }
        });
      }
    };

    window.addEventListener('message', handleMessage);
    vscode.postMessage({ type: 'refresh' });

    const handleClickOutside = () => {
      setContextMenu((prev) => ({
        ...prev,
        visible: false,
      }));
    };

    window.addEventListener('click', handleClickOutside);
    window.addEventListener('blur', handleClickOutside);

    return () => {
      window.removeEventListener('message', handleMessage);
      window.removeEventListener('click', handleClickOutside);
      window.removeEventListener('blur', handleClickOutside);
    };
  }, []);

  useEffect(() => {
    if (autoScrollTarget.current && !isSearchMode) {
      const target = autoScrollTarget.current;
      const safeId = `tree-node-${encodeURIComponent(target)}`;
      const el = document.getElementById(safeId);

      if (el) {
        setTimeout(() => {
          el.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
          });
        }, 100);

        autoScrollTarget.current = null;
      }
    }
  }, [expandedPaths, isSearchMode, dirChildren, selectedPath]);

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

    const prevState = vscode.getState() as Record<string, unknown> | undefined;

    vscode.setState({
      ...(prevState || {}),
      searchQuery: val,
    });
  };

  const currentBaseUri = currentUri.split('?')[0];
  const projectInHistory = projects.find((p) => p.fsPath.split('?')[0] === currentBaseUri);
  const inHistory = !!projectInHistory;

  const activeProjectToRender =
    projectInHistory ||
    (currentWorkspace
      ? ({
        ...currentWorkspace,
        timestamp: Date.now(),
      } as Project)
      : null);

  const otherProjects = projects.filter((p) => p.fsPath.split('?')[0] !== currentBaseUri);

  const matchSearch = (p: Project) => {
    if (!searchQuery) return true;

    const title = p.customName || p.name;
    const displayPath = getDisplayPath(p);
    const full = `${title} ${p.name} ${displayPath} ${p.fsPath}`.toLowerCase();

    return full.includes(String(searchQuery).toLowerCase().trim());
  };

  const filteredOtherProjects = otherProjects.filter(matchSearch);
  const isCurrentVisible = activeProjectToRender && matchSearch(activeProjectToRender);

  const revealVisibleProjectPaths = useMemo(() => {
    const paths: string[] = [];

    if (isSearchMode && searchTargetProject && searchTargetProject.path) {
      paths.push(searchTargetProject.path);
    } else {
      paths.push(...filteredOtherProjects.map((p) => p.fsPath));

      if (isCurrentVisible && activeProjectToRender) {
        paths.unshift(activeProjectToRender.fsPath);
      }
    }

    return paths;
  }, [
    isSearchMode,
    searchTargetProject,
    filteredOtherProjects,
    isCurrentVisible,
    activeProjectToRender,
  ]);

  const revealVisibleProjectPathKey = revealVisibleProjectPaths.join('\n');

  useEffect(() => {
    vscode.postMessage({
      type: 'updateRevealVisibility',
      visibleProjectPaths: revealVisibleProjectPaths,
    });
  }, [revealVisibleProjectPathKey]);

  const clickTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const getFileStatusClassName = (status?: string) => {
    if (!status) return '';

    const safeStatus = status.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    return styles[`file-status-${safeStatus}`] || '';
  };

  const getFileStatusText = (status?: string) => {
    if (!status) return '';

    const normalizedStatus = status.toLowerCase();

    if (normalizedStatus === 'u') return 'U';
    if (normalizedStatus === 'a') return 'A';
    if (normalizedStatus === 'm') return 'M';
    if (normalizedStatus === 'd') return 'D';
    if (normalizedStatus === 'r') return 'R';
    if (normalizedStatus === 'c') return 'C';

    return '';
  };

  const getStatusTitle = (name: string, status?: string) => {
    const text = getFileStatusText(status);

    return text ? `${name} [${text}]` : name;
  };

  const renderFolderStatusDot = (status?: string) => {
    const text = getFileStatusText(status);

    if (!text) return null;

    return (
      <span
        className={`${styles['folder-status-dot']} ${getFileStatusClassName(status)}`}
        title={`状态: ${text}`}
      />
    );
  };

  const handleOpenProject = (pathValue: string) => {
    if (clickTimeout.current) clearTimeout(clickTimeout.current);

    vscode.postMessage({
      type: 'openProject',
      fsPath: pathValue,
    });
  };

  const handleOpenCurrent = (pathValue: string, e: React.MouseEvent) => {
    e.stopPropagation();

    vscode.postMessage({
      type: 'openProjectCurrent',
      fsPath: pathValue,
    });
  };

  const handleOpenFile = (
    pathValue: string,
    projectName: string,
    isActiveProject: boolean,
    e: React.MouseEvent
  ) => {
    e.stopPropagation();

    setSelectedPath(pathValue);
    setContextMenu((prev) => ({
      ...prev,
      visible: false,
    }));

    if (pathValue.toLowerCase().endsWith('.md')) {
      vscode.postMessage({
        type: 'previewWithVditor',
        fsPath: pathValue,
        projectName,
        isActiveProject,
      });
    } else if (isImageFile(pathValue)) {
      vscode.postMessage({
        type: 'openImageNative',
        fsPath: pathValue,
      });
    } else if (isExcelFile(pathValue)) {
      vscode.postMessage({
        type: 'previewWithExcel',
        fsPath: pathValue,
        projectName,
        isActiveProject,
      });
    } else if (isPdfFile(pathValue)) {
      vscode.postMessage({
        type: 'previewWithPdf',
        fsPath: pathValue,
        projectName,
        isActiveProject,
      });
    } else {
      vscode.postMessage({
        type: isActiveProject ? 'openFileNormal' : 'openFile',
        fsPath: pathValue,
        projectName,
      });
    }
  };

  const handleToggleExpand = (
    pathValue: string,
    projectName: string,
    _: boolean,
    e: React.MouseEvent
  ) => {
    e.stopPropagation();

    setContextMenu((prev) => ({
      ...prev,
      visible: false,
    }));

    if (clickTimeout.current) clearTimeout(clickTimeout.current);

    clickTimeout.current = setTimeout(() => {
      setExpandedPaths((prev) => {
        const next = new Set(prev);
        const isExpanding = !next.has(pathValue);

        if (isExpanding) {
          next.add(pathValue);

          if (!dirChildrenRef.current[pathValue]) {
            setLoadingPaths((l) => new Set(l).add(pathValue));

            vscode.postMessage({
              type: 'readDir',
              fsPath: pathValue,
              projectName,
            });
          }
        } else {
          next.delete(pathValue);
        }

        return next;
      });
    }, 250);
  };

  const handleContextMenu = (
    e: React.MouseEvent,
    type: 'top' | 'sub',
    payload: ContextMenuPayload
  ) => {
    e.preventDefault();
    e.stopPropagation();

    setSelectedPath(payload.path);

    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      type,
      payload,
    });
  };

  const executeMenuAction = (action: string, arg?: string) => {
    setContextMenu((prev) => ({
      ...prev,
      visible: false,
    }));

    const { payload } = contextMenu;

    switch (action) {
      case 'addToHistory':
        vscode.postMessage({
          type: 'addToHistory',
          fsPath: payload.path,
          projectName: payload.originalName || payload.name,
        });
        break;

      case 'addToGitList':
        vscode.postMessage({
          type: 'addToGitList',
          fsPath: payload.path,
        });
        break;

      case 'openInVsCode':
        vscode.postMessage({
          type: 'openInVsCode',
          fsPath: payload.path,
        });
        break;

      case 'openWith':
        vscode.postMessage({
          type: 'openWith',
          fsPath: payload.path,
          projectName: payload.projectName || '未知项目',
        });
        break;

      case 'openProjectCurrent':
        vscode.postMessage({
          type: 'openProjectCurrent',
          fsPath: payload.path,
        });
        break;

      case 'openInNewWindow':
        vscode.postMessage({
          type: 'openInNewWindow',
          fsPath: payload.path,
        });
        break;

      case 'edit':
        vscode.postMessage({
          type: 'editProjectName',
          fsPath: payload.path,
        });
        break;

      case 'changeAddress':
        vscode.postMessage({
          type: 'changeAddress',
          fsPath: payload.path,
        });
        break;

      case 'switchBranch':
        vscode.postMessage({
          type: 'switchBranch',
          fsPath: payload.path,
        });
        break;

      case 'copyText':
        vscode.postMessage({
          type: 'copyToClipboard',
          text: arg,
        });
        break;

      case 'copyFile':
        vscode.postMessage({
          type: 'copyFile',
          fsPath: payload.path,
        });
        break;

      case 'openLink':
        vscode.postMessage({
          type: 'openExternalLink',
          fsPath: payload.path,
          platform: payload.platform,
          customDomain: payload.customDomain,
        });
        break;

      case 'revealInExplorer':
        vscode.postMessage({
          type: 'revealInExplorer',
          fsPath: arg || payload.path,
        });
        break;

      case 'delete':
        vscode.postMessage({
          type: 'removeProject',
          fsPath: payload.path,
        });
        break;

      case 'openFileToSide':
        if (isImageFile(payload.path)) {
          vscode.postMessage({
            type: 'openImageNativeToSide',
            fsPath: payload.path,
          });
        } else if (isExcelFile(payload.path)) {
          vscode.postMessage({
            type: 'previewWithExcelToSide',
            fsPath: payload.path,
            projectName: payload.projectName || '未知项目',
            isActiveProject: !!payload.isActiveProject,
          });
        } else if (isPdfFile(payload.path)) {
          vscode.postMessage({
            type: 'previewWithPdfToSide',
            fsPath: payload.path,
            projectName: payload.projectName || '未知项目',
          });
        } else {
          vscode.postMessage({
            type: payload.isActiveProject ? 'openFileNormalToSide' : 'openFileToSide',
            fsPath: payload.path,
            projectName: payload.projectName,
          });
        }
        break;

      case 'openFileInNewTab':
        if (isImageFile(payload.path)) {
          vscode.postMessage({
            type: 'openImageNative',
            fsPath: payload.path,
          });
        } else if (isExcelFile(payload.path)) {
          vscode.postMessage({
            type: 'previewWithExcel',
            fsPath: payload.path,
            projectName: payload.projectName || '未知项目',
            isActiveProject: !!payload.isActiveProject,
          });
        } else if (isPdfFile(payload.path)) {
          vscode.postMessage({
            type: 'previewWithPdf',
            fsPath: payload.path,
            projectName: payload.projectName || '未知项目',
          });
        } else {
          vscode.postMessage({
            type: payload.isActiveProject ? 'openFileNormalInNewTab' : 'openFileInNewTab',
            fsPath: payload.path,
            projectName: payload.projectName,
          });
        }
        break;

      case 'updateBranch':
        vscode.postMessage({
          type: 'updateSingleBranch',
          fsPath: payload.path,
        });
        break;

      case 'selectForCompare':
        vscode.postMessage({
          type: 'selectForCompare',
          fsPath: payload.path,
          projectName: payload.isActiveProject ? undefined : payload.projectName,
        });
        break;

      case 'compareWithSelected':
        vscode.postMessage({
          type: 'compareWithSelected',
          fsPath: payload.path,
          projectName: payload.isActiveProject ? undefined : payload.projectName,
        });
        break;

      case 'searchInFolder':
        setSearchTargetProject(payload);
        setIsSearchMode(true);
        setFolderSearchQuery('');
        setFolderSearchResults([]);
        setFileNameSearchResults([]);
        setFolderSearchError('');
        break;

      default:
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
      const el = document.getElementById(
        `search-line-${matchInfo.fileIndex}-${matchInfo.matchIndex}`
      );

      if (el) {
        el.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });
      }
    }
  }, [currentActiveMatch, totalMatches, isSearchMode, flatMatchesList]);

  const renderTreeChildren = (
    parentPath: string,
    projectName: string,
    isActiveProject: boolean = false
  ) => {
    const children = dirChildren[parentPath];
    const isLoading = loadingPaths.has(parentPath);

    if (isLoading && !children) {
      return (
        <div className={styles['empty-node']}>
          <FontAwesomeIcon
            icon={faSpinner}
            spin
            style={{
              marginRight: '6px',
            }}
          />
          正在读取目录...
        </div>
      );
    }

    if (!children) return null;

    if (children.length === 0) {
      return <div className={styles['empty-node']}>（空文件夹/无读取权限）</div>;
    }

    return (
      <>
        {children.map((child) => {
          const childPath = child.path;
          const isExpanded = expandedPaths.has(childPath);
          const childLoading = loadingPaths.has(childPath);
          const isRemote = childPath.startsWith('vscode-vfs') || childPath.startsWith('http');
          const elementId = `tree-node-${encodeURIComponent(childPath)}`;
          const statusClassName = getFileStatusClassName(child.status);

          if (child.isFolder) {
            return (
              <div key={childPath}>
                <div
                  id={elementId}
                  className={`${styles['sub-item']} ${styles['clickable-sub']} ${selectedPath === childPath ? styles['selected'] : ''
                    } ${styles['search-name-sub-item']}`}
                  onClick={(e) => handleToggleExpand(childPath, projectName, isRemote, e)}
                  onContextMenu={(e) =>
                    handleContextMenu(e, 'sub', {
                      path: childPath,
                      name: child.name,
                      isFolder: true,
                      projectName,
                      isActiveProject,
                    })
                  }
                >
                  <div className={styles['tree-chevron']}>
                    {childLoading ? (
                      <FontAwesomeIcon
                        icon={faSpinner}
                        spin
                        className={styles['chevron-icon']}
                        style={{
                          opacity: 1,
                          color: 'var(--vscode-textLink-foreground)',
                        }}
                      />
                    ) : (
                      <FontAwesomeIcon
                        icon={isExpanded ? faChevronDown : faChevronRight}
                        className={styles['chevron-icon']}
                      />
                    )}
                  </div>

                  <FontAwesomeIcon
                    icon={faFolder}
                    className={`${styles['icon-closed']} ${styles['sub-icon']}`}
                  />

                  <span
                    className={`${styles['sub-name']} ${statusClassName}`}
                    title={getStatusTitle(child.name, child.status)}
                  >
                    {child.name}
                  </span>

                  {renderFolderStatusDot(child.status)}
                </div>

                {isExpanded && (
                  <div
                    className={`${styles['tree-children']} ${styles['search-name-tree-children']}`}
                  >
                    {renderTreeChildren(childPath, projectName, isActiveProject)}
                  </div>
                )}
              </div>
            );
          }

          return (
            <div key={childPath}>
              <div
                id={elementId}
                className={`${styles['sub-item']} ${selectedPath === childPath ? styles['selected'] : ''
                  } ${styles['search-name-sub-item-clickable']}`}
                onClick={(e) => handleOpenFile(childPath, projectName, isActiveProject, e)}
                onContextMenu={(e) =>
                  handleContextMenu(e, 'sub', {
                    path: childPath,
                    name: child.name,
                    isFolder: false,
                    projectName,
                    isActiveProject,
                  })
                }
                title={isActiveProject ? '点击打开文件' : '点击预览'}
              >
                <div className={styles['chevron-placeholder']}></div>

                <FileIcon
                  fileName={child.name}
                  status={child.status}
                  className={styles['sub-icon']}
                />

                <span
                  className={`${styles['sub-name']} ${statusClassName}`}
                  title={getStatusTitle(child.name, child.status)}
                >
                  {child.name}
                </span>

                {renderFolderStatusDot(child.status)}
              </div>
            </div>
          );
        })}
      </>
    );
  };

  if (isInitLoading) {
    return (
      <div
        className={styles['app-wrapper']}
        style={{
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <FontAwesomeIcon
          icon={faSpinner}
          spin
          style={{
            fontSize: '24px',
            opacity: 0.5,
            marginBottom: '10px',
          }}
        />
        <span
          style={{
            fontSize: '13px',
            opacity: 0.7,
          }}
        >
          正在加载项目视图...
        </span>
      </div>
    );
  }

  return (
    <div className={styles['app-wrapper']}>
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
        <SearchViewWrapper
          searchTargetProject={searchTargetProject}
          folderSearchQuery={folderSearchQuery}
          setFolderSearchQuery={setFolderSearchQuery}
          folderSearchType={folderSearchType}
          setFolderSearchType={setFolderSearchType}
          folderSearchResults={folderSearchResults}
          setFolderSearchResults={setFolderSearchResults}
          fileNameSearchResults={fileNameSearchResults}
          setFileNameSearchResults={setFileNameSearchResults}
          folderSearchError={folderSearchError}
          setFolderSearchError={setFolderSearchError}
          isSearchingFolder={isSearchingFolder}
          totalMatches={totalMatches}
          currentActiveMatch={currentActiveMatch}
          setCurrentActiveMatch={setCurrentActiveMatch}
          lineStartIndexMap={lineStartIndexMap}
          flatMatchesList={flatMatchesList}
          expandedPaths={expandedPaths}
          selectedPath={selectedPath}
          setIsSearchMode={setIsSearchMode}
          handlePrevSearchMatch={handlePrevSearchMatch}
          handleNextSearchMatch={handleNextSearchMatch}
          handleToggleExpand={handleToggleExpand}
          handleOpenFile={handleOpenFile}
          renderTreeChildren={renderTreeChildren}
        />
      ) : (
        <>
          {projects.length > 0 && (
            <div className={styles['search-container']}>
              <div className={styles['search-box']}>
                <FontAwesomeIcon
                  icon={faMagnifyingGlass}
                  className={styles['search-magnify-icon']}
                />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={handleSearch}
                  placeholder="搜索标题、文件夹、地址..."
                  autoComplete="off"
                  spellCheck="false"
                />
              </div>
            </div>
          )}

          <div className={styles['list-container']}>
            {projects.length === 0 && !activeProjectToRender ? (
              <div className={styles['empty-state']}>
                <div className={styles['empty-text']}>暂无项目记录，请添加：</div>

                <div className={styles['bottom-bar']}>
                  <button
                    className={styles['action-btn']}
                    onClick={() =>
                      vscode.postMessage({
                        type: 'addLocal',
                      })
                    }
                  >
                    <FontAwesomeIcon icon={faFolderPlus} />
                    添加本地项目
                  </button>

                  <button
                    className={`${styles['action-btn']} ${styles['secondary']}`}
                    onClick={() =>
                      vscode.postMessage({
                        type: 'addRemote',
                      })
                    }
                  >
                    <FontAwesomeIcon icon={faGithub} />
                    添加远程仓库
                  </button>
                </div>
              </div>
            ) : (
              <>
                {isCurrentVisible &&
                  activeProjectToRender &&
                  (() => {
                    const p = activeProjectToRender;
                    const rootPath = p.fsPath;
                    const isRemote = p.fsPath.startsWith('vscode-vfs') || p.fsPath.startsWith('http');
                    const isGitlab = p.platform === 'gitlab' || p.fsPath.startsWith('vscode-vfs://gitlab');
                    const icon = isRemote ? (isGitlab ? faGitlab : faGithub) : faFolderOpen;
                    const title = p.customName || p.name;
                    const displayPath = getDisplayPath(p);
                    const finalPath = p.customName ? `${p.name} • ${displayPath}` : displayPath;
                    const branch = branchMap[p.fsPath] || p.branch;
                    const isExpanded = expandedPaths.has(rootPath);
                    const rootLoading = loadingPaths.has(rootPath);
                    const elementId = `tree-node-${encodeURIComponent(rootPath)}`;

                    return (
                      <div key={rootPath}>
                        <div
                          id={elementId}
                          className={`${styles['active-top-project']} ${selectedPath === rootPath ? styles['selected'] : ''
                            } ${inHistory ? styles['in-history'] : styles['not-in-history']}`}
                          title={
                            inHistory
                              ? '当前窗口正在运行的项目'
                              : '当前正在运行的项目（未在历史记录中）'
                          }
                          onContextMenu={(e) =>
                            handleContextMenu(e, 'top', {
                              path: rootPath,
                              isRemote,
                              originalName: p.name,
                              customName: p.customName,
                              platform: p.platform || 'github',
                              customDomain: p.customDomain,
                              isActiveProject: true,
                              inHistory,
                            })
                          }
                          onClick={() => setSelectedPath(rootPath)}
                        >
                          <div
                            className={`${styles['item-left']} ${styles['clickable-expand']}`}
                            onClick={(e) => handleToggleExpand(rootPath, title, isRemote, e)}
                          >
                            <div className={styles['tree-chevron']}>
                              {rootLoading ? (
                                <FontAwesomeIcon
                                  icon={faSpinner}
                                  spin
                                  className={styles['chevron-icon']}
                                  style={{
                                    opacity: 1,
                                    color: 'inherit',
                                  }}
                                />
                              ) : (
                                <FontAwesomeIcon
                                  icon={isExpanded ? faChevronDown : faChevronRight}
                                  className={styles['chevron-icon']}
                                />
                              )}
                            </div>

                            <div className={styles['info']}>
                              <div className={styles['title']}>
                                <FontAwesomeIcon
                                  icon={icon}
                                  className={`${styles['project-icon']} ${inHistory ? styles['icon-opened'] : ''
                                    }`}
                                />

                                <span className={styles['project-name']} title={title}>
                                  {title}
                                </span>

                                {branch && (
                                  <span className={styles['branch-tag']} title={branch}>
                                    <FontAwesomeIcon
                                      icon={faCodeBranch}
                                      className={styles['branch-icon']}
                                    />
                                    <span className={styles['branch-text']}>{branch}</span>
                                  </span>
                                )}
                              </div>

                              <div className={styles['path']}>{finalPath}</div>
                            </div>
                          </div>
                        </div>

                        {isExpanded && (
                          <div className={styles['tree-children']}>
                            {renderTreeChildren(rootPath, title, true)}
                          </div>
                        )}

                        <div className={styles['top-divider']}></div>
                      </div>
                    );
                  })()}

                <ul>
                  {filteredOtherProjects.map((p) => {
                    const rootPath = p.fsPath;
                    const isJustOpened = p.fsPath === lastOpenedPath;
                    const isRemote = p.fsPath.startsWith('vscode-vfs') || p.fsPath.startsWith('http');
                    const isGitlab = p.platform === 'gitlab' || p.fsPath.startsWith('vscode-vfs://gitlab');
                    const icon = isRemote ? (isGitlab ? faGitlab : faGithub) : faFolder;
                    const title = p.customName || p.name;
                    const displayPath = getDisplayPath(p);
                    const finalPath = p.customName ? `${p.name} • ${displayPath}` : displayPath;
                    const isExpanded = expandedPaths.has(rootPath);
                    const itemLoading = loadingPaths.has(rootPath);
                    const branch = branchMap[p.fsPath] || p.branch;
                    const elementId = `tree-node-${encodeURIComponent(rootPath)}`;

                    return (
                      <li key={rootPath}>
                        <div
                          id={elementId}
                          className={`${styles['project-item']} ${isJustOpened ? styles['just-opened'] : ''
                            } ${selectedPath === rootPath ? styles['selected'] : ''}`}
                          onDoubleClick={() => handleOpenProject(p.fsPath)}
                          title={isJustOpened ? '刚刚在此窗口中唤起过' : ''}
                          onContextMenu={(e) =>
                            handleContextMenu(e, 'top', {
                              path: rootPath,
                              isRemote,
                              originalName: p.name,
                              customName: p.customName,
                              platform: p.platform || 'github',
                              customDomain: p.customDomain,
                              isActiveProject: false,
                            })
                          }
                          onClick={() => setSelectedPath(rootPath)}
                        >
                          <div
                            className={`${styles['item-left']} ${styles['clickable-expand']}`}
                            onClick={(e) => handleToggleExpand(rootPath, title, isRemote, e)}
                          >
                            <div className={styles['tree-chevron']}>
                              {itemLoading ? (
                                <FontAwesomeIcon
                                  icon={faSpinner}
                                  spin
                                  className={styles['chevron-icon']}
                                  style={{
                                    opacity: 1,
                                    color: 'var(--vscode-textLink-foreground)',
                                  }}
                                />
                              ) : (
                                <FontAwesomeIcon
                                  icon={isExpanded ? faChevronDown : faChevronRight}
                                  className={styles['chevron-icon']}
                                />
                              )}
                            </div>

                            <div className={styles['info']}>
                              <div className={styles['title']}>
                                <FontAwesomeIcon
                                  icon={icon}
                                  className={`${styles['project-icon']} ${styles['icon-closed']}`}
                                />

                                <span className={styles['project-name']} title={title}>
                                  {title}
                                </span>

                                {branch && (
                                  <span className={styles['branch-tag']} title={branch}>
                                    <FontAwesomeIcon
                                      icon={faCodeBranch}
                                      className={styles['branch-icon']}
                                    />
                                    <span className={styles['branch-text']}>{branch}</span>
                                  </span>
                                )}
                              </div>

                              <div className={styles['path']}>{finalPath}</div>
                            </div>
                          </div>

                          <div className={styles['item-actions']}>
                            <button
                              className={`${styles['action-btn-icon']} ${styles['open-btn']}`}
                              onClick={(e) => handleOpenCurrent(p.fsPath, e)}
                              title="在当前窗口打开"
                            >
                              <FontAwesomeIcon icon={faArrowRightToBracket} />
                            </button>
                          </div>
                        </div>

                        {isExpanded && (
                          <div className={styles['tree-children']}>
                            {renderTreeChildren(rootPath, title)}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>

                {searchQuery && filteredOtherProjects.length === 0 && !isCurrentVisible && (
                  <div className={styles['no-match-msg']}>没有找到匹配的项目...</div>
                )}
              </>
            )}
          </div>

          {(projects.length > 0 || activeProjectToRender) && (
            <div className={styles['bottom-bar']}>
              <button
                className={styles['action-btn']}
                onClick={() =>
                  vscode.postMessage({
                    type: 'addLocal',
                  })
                }
                style={{
                  marginBottom: 0,
                }}
              >
                <FontAwesomeIcon icon={faFolderPlus} />
                添加本地
              </button>

              <button
                className={`${styles['action-btn']} ${styles['secondary']}`}
                onClick={() =>
                  vscode.postMessage({
                    type: 'addRemote',
                  })
                }
                style={{
                  marginBottom: 0,
                }}
              >
                <FontAwesomeIcon icon={faGithub} />
                添加远程
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}