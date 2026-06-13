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
import ProjectInitLoading from '../../components/ProjectInitLoading';
import RecentProjectContextMenu from '../../components/RecentProjectContextMenu';
import SearchViewWrapper from '../../components/SearchViewWrapper';
import Tooltip from '../../components/Tooltip';
import Scrollbar from '../../components/Scrollbar';
import { isImageFile, isExcelFile, isPdfFile, getDisplayPath } from '../../utils';
import {
  FileGitStatusBadge,
  FolderGitStatusDot,
  getGitStatusClassName,
  getGitStatusTitle,
} from '../../components/GitStatusMark';
import type {
  Project,
  DirChild,
  SearchMatch,
  SearchResult,
  ContextMenuPayload,
} from '../../types/RecentProjectsApp';

interface DiagnosticSummary {
  errors: number;
  warnings: number;
}

interface MetadataPatchItem {
  path: string;
  status?: string;
  diagnostics?: DiagnosticSummary;
}

interface PendingCreateEntity {
  parentPath: string;
  type: 'file' | 'folder';
  projectName: string;
  isActiveProject: boolean;
}

interface DraggingEntity {
  path: string;
  name: string;
  isFolder: boolean;
  projectName: string;
}

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
  const normalDirChildrenBeforeFocusRef = useRef<Record<string, DirChild[]>>({});

  useEffect(() => {
    dirChildrenRef.current = dirChildren;
  }, [dirChildren]);

  const expandedPathsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    expandedPathsRef.current = expandedPaths;
  }, [expandedPaths]);

  const projectsRef = useRef<Project[]>([]);

  useEffect(() => {
    projectsRef.current = projects;
  }, [projects]);

  const currentWorkspaceRef = useRef<Project | null>(null);

  useEffect(() => {
    currentWorkspaceRef.current = currentWorkspace;
  }, [currentWorkspace]);

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
  const isSearchModeRef = useRef(false);
  const [searchTargetProject, setSearchTargetProject] = useState<ContextMenuPayload | null>(null);
  const [folderSearchQuery, setFolderSearchQuery] = useState('');
  const [folderSearchType, setFolderSearchType] = useState<'content' | 'name'>('content');
  const [fileNameSearchResults, setFileNameSearchResults] = useState<DirChild[]>([]);
  const [folderSearchResults, setFolderSearchResults] = useState<SearchResult[]>([]);
  const [isSearchingFolder, setIsSearchingFolder] = useState(false);
  const [folderSearchError, setFolderSearchError] = useState('');
  const [currentActiveMatch, setCurrentActiveMatch] = useState(0);
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [focusRootPath, setFocusRootPath] = useState('');
  const [focusRootName, setFocusRootName] = useState('');
  const isFocusModeRef = useRef(false);
  const focusRootPathRef = useRef('');
  const focusRootNameRef = useRef('');

  const [pendingCreateEntity, setPendingCreateEntity] = useState<PendingCreateEntity | null>(null);
  const [pendingCreateName, setPendingCreateName] = useState('');
  const pendingCreateInputRef = useRef<HTMLInputElement>(null);

  const [draggingEntity, setDraggingEntity] = useState<DraggingEntity | null>(null);
  const [dragOverPath, setDragOverPath] = useState('');
  const [invalidDragOverPath, setInvalidDragOverPath] = useState('');

  useEffect(() => {
    isSearchModeRef.current = isSearchMode;
  }, [isSearchMode]);

  useEffect(() => {
    isFocusModeRef.current = isFocusMode;
  }, [isFocusMode]);

  useEffect(() => {
    focusRootPathRef.current = focusRootPath;
  }, [focusRootPath]);

  useEffect(() => {
    focusRootNameRef.current = focusRootName;
  }, [focusRootName]);

  useEffect(() => {
    if (!pendingCreateEntity) return;

    window.setTimeout(() => {
      pendingCreateInputRef.current?.focus();
      pendingCreateInputRef.current?.select();
    }, 0);
  }, [pendingCreateEntity]);

  const normalizePatchPath = (pathValue: string) => {
    if (!pathValue) return '';

    try {
      if (pathValue.includes('://')) {
        const url = new URL(pathValue);

        if (url.protocol === 'file:') {
          let decoded = decodeURIComponent(url.pathname || '');

          if (/^\/[a-zA-Z]:\//.test(decoded)) {
            decoded = decoded.slice(1);
          }

          return decoded.replace(/\\/g, '/').replace(/\/+$/, '');
        }

        return decodeURIComponent(url.pathname || pathValue).replace(/\\/g, '/').replace(/\/+$/, '');
      }
    } catch { }

    return decodeURIComponent(pathValue.split('?')[0]).replace(/^file:\/\//, '').replace(/\\/g, '/').replace(/\/+$/, '');
  };

  const applyMetadataPatchToItem = <T extends Record<string, any>>(item: T, patchMap: Map<string, MetadataPatchItem>): T => {
    const itemPath = item.path || item.fullPath || item.fsPath;
    const patch = patchMap.get(normalizePatchPath(itemPath || ''));

    if (!patch) return item;

    return {
      ...item,
      status: patch.status,
      diagnostics: patch.diagnostics || { errors: 0, warnings: 0 },
    };
  };

  const getDiagnosticSummary = (item: any): DiagnosticSummary => {
    const diagnostics = item?.diagnostics || {};

    return {
      errors: Math.max(0, Number(diagnostics.errors) || 0),
      warnings: Math.max(0, Number(diagnostics.warnings) || 0),
    };
  };

  const getDiagnosticsTitle = (item: any) => {
    const diagnostics = getDiagnosticSummary(item);

    if (!diagnostics.errors && !diagnostics.warnings) {
      return '';
    }

    return `错误 ${diagnostics.errors}，警告 ${diagnostics.warnings}`;
  };

  const getFolderDiagnosticsStyle = (item: any): React.CSSProperties | undefined => {
    const diagnostics = getDiagnosticSummary(item);

    if (diagnostics.errors > 0) {
      return {
        color: 'var(--vscode-editorError-foreground)',
      };
    }

    if (diagnostics.warnings > 0) {
      return {
        color: 'var(--vscode-editorWarning-foreground)',
      };
    }

    return undefined;
  };

  const formatTooltipPath = (pathValue: string) => {
    const normalizedPath = normalizePatchPath(pathValue || '');

    if (!normalizedPath) return '';

    const normalized = normalizedPath.replace(/\\/g, '/');
    const userHomeMatch = normalized.match(/^\/Users\/[^/]+(\/.*)?$/);

    if (userHomeMatch) {
      return `~${userHomeMatch[1] || ''}`;
    }

    const windowsHomeMatch = normalized.match(/^[a-zA-Z]:\/Users\/[^/]+(\/.*)?$/);

    if (windowsHomeMatch) {
      return `~${windowsHomeMatch[1] || ''}`;
    }

    return normalized;
  };

  const getSimpleGitStatusText = (status?: string, isFolder: boolean = false) => {
    const rawStatus = String(status || '').trim();

    if (!rawStatus) return '';

    if (isFolder) {
      return '包含强调项';
    }

    const statusTextMap: Record<string, string> = {
      U: '未跟踪的',
      '?': '未跟踪的',
      M: '已修改',
      A: '已添加',
      D: '已删除',
      R: '已重命名',
      C: '已复制',
      I: '已忽略',
      '!': '已忽略',
      X: '存在冲突',
      T: '类型已变更',
    };

    const cleanStatus = rawStatus
      .replace(/[\[\]]/g, '')
      .replace(/^\s*[·•-]?\s*/, '')
      .trim();

    const statusTokens = cleanStatus
      .split(/[\s,|/]+/)
      .map((item) => item.trim())
      .filter(Boolean);

    const matchedToken = statusTokens.find((item) => {
      const key = item[0]?.toUpperCase();

      return !!key && Object.prototype.hasOwnProperty.call(statusTextMap, key);
    });

    if (matchedToken) {
      return statusTextMap[matchedToken[0].toUpperCase()];
    }

    const compactStatus = cleanStatus.replace(/\s+/g, '');
    const matchedKey = Object.keys(statusTextMap).find((key) => {
      return key === '?' ? compactStatus.includes('?') : compactStatus.toUpperCase().includes(key);
    });

    if (matchedKey) {
      return statusTextMap[matchedKey];
    }

    const fallbackText = getGitStatusTitle('', cleanStatus || rawStatus)
      .replace(/[\[\]]/g, '')
      .replace(/^\s*[·•-]?\s*/, '')
      .trim();

    const fallbackKey = fallbackText[0]?.toUpperCase();

    if (fallbackKey && Object.prototype.hasOwnProperty.call(statusTextMap, fallbackKey)) {
      return statusTextMap[fallbackKey];
    }

    return fallbackText || cleanStatus || rawStatus;
  };

  const getProblemTooltipText = (item: any, isFolder: boolean = false) => {
    const diagnostics = getDiagnosticSummary(item);
    const total = diagnostics.errors + diagnostics.warnings;

    if (!total) return '';

    if (isFolder) {
      if (diagnostics.errors > 0) return '包含错误';
      return '包含警告';
    }

    return `此文件存在 ${total} 个问题`;
  };

  const getTreeTooltipContent = (pathValue: string, item: any, isFolder: boolean = false) => {
    const displayPath = formatTooltipPath(pathValue || item?.path || item?.fsPath || '');
    const meta = [
      getProblemTooltipText(item, isFolder),
      getSimpleGitStatusText(item?.status, isFolder),
    ].filter(Boolean);

    if (!displayPath && meta.length === 0) return null;

    if (meta.length === 0) return displayPath;

    return `${displayPath} · ${meta.join(' · ')}`;
  };

  const getRootProjectTooltipContent = (pathValue: string, item: any) => {
    const displayPath = formatTooltipPath(pathValue || item?.fsPath || '');
    const meta = [getProblemTooltipText(item, true)].filter(Boolean);

    if (!displayPath && meta.length === 0) return null;

    if (meta.length === 0) return displayPath;

    return `${displayPath} · ${meta.join(' · ')}`;
  };


  const renderDiagnosticsBadge = (item: any) => {
    const diagnostics = getDiagnosticSummary(item);

    if (!diagnostics.errors && !diagnostics.warnings) {
      return null;
    }

    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          marginLeft: 6,
          flexShrink: 0,
          fontSize: 11,
          lineHeight: '14px',
          fontVariantNumeric: 'tabular-nums',
        }}
        title={getDiagnosticsTitle(item)}
      >
        {diagnostics.errors > 0 && (
          <span
            style={{
              minWidth: 14,
              height: 14,
              padding: '0 4px',
              boxSizing: 'border-box',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 999,
              color: 'var(--vscode-editorError-foreground)',
              background: 'color-mix(in srgb, var(--vscode-editorError-foreground) 18%, transparent)',
            }}
          >
            {diagnostics.errors}
          </span>
        )}

        {diagnostics.warnings > 0 && (
          <span
            style={{
              minWidth: 14,
              height: 14,
              padding: '0 4px',
              boxSizing: 'border-box',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 999,
              color: 'var(--vscode-editorWarning-foreground)',
              background: 'color-mix(in srgb, var(--vscode-editorWarning-foreground) 18%, transparent)',
            }}
          >
            {diagnostics.warnings}
          </span>
        )}
      </span>
    );
  };

  const getFallbackProjectName = (pathValue: string) => {
    const clean = decodeURIComponent(pathValue.split('?')[0]).replace(/\\/g, '/');
    const parts = clean.split('/').filter(Boolean);

    return parts[parts.length - 1] || '未知项目';
  };

  const isPathInside = (childPath: string, parentPath: string) => {
    if (!childPath || !parentPath) return false;

    const child = childPath.split('?')[0].replace(/\\/g, '/').replace(/\/+$/, '');
    const parent = parentPath.split('?')[0].replace(/\\/g, '/').replace(/\/+$/, '');
    const parentWithSlash = parent.endsWith('/') ? parent : `${parent}/`;

    return child === parent || child.startsWith(parentWithSlash);
  };

  // const isPathDescendant = (childPath: string, parentPath: string) => {
  //   if (!childPath || !parentPath) return false;

  //   const child = childPath.split('?')[0].replace(/\\/g, '/').replace(/\/+$/, '');
  //   const parent = parentPath.split('?')[0].replace(/\\/g, '/').replace(/\/+$/, '');
  //   const parentWithSlash = parent.endsWith('/') ? parent : `${parent}/`;

  //   return child.startsWith(parentWithSlash);
  // };

  const cacheNormalDirChildrenBeforeFocus = (rootPath: string) => {
    const snapshot: Record<string, DirChild[]> = {}
    Object.keys(dirChildrenRef.current).forEach((key) => {
      if (isPathInside(key, rootPath)) {
        snapshot[key] = dirChildrenRef.current[key];
      }
    })
    normalDirChildrenBeforeFocusRef.current = snapshot;
  }

  const getProjectNameByPath = (pathValue: string) => {
    if (isFocusModeRef.current && focusRootPathRef.current && isPathInside(pathValue, focusRootPathRef.current)) {
      return focusRootNameRef.current || getFallbackProjectName(focusRootPathRef.current);
    }

    const currentWorkspaceValue = currentWorkspaceRef.current;

    if (currentWorkspaceValue && isPathInside(pathValue, currentWorkspaceValue.fsPath)) {
      return currentWorkspaceValue.customName || currentWorkspaceValue.name || getFallbackProjectName(currentWorkspaceValue.fsPath);
    }

    const project = projectsRef.current.find((item) => isPathInside(pathValue, item.fsPath));

    return project?.customName || project?.name || getFallbackProjectName(pathValue);
  };

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
      } else if (msg.type === 'metadataPatch') {
        const items = (msg.items as MetadataPatchItem[]) || [];
        const patchMap = new Map<string, MetadataPatchItem>();

        items.forEach((item) => {
          const key = normalizePatchPath(item.path);

          if (key) {
            patchMap.set(key, item);
          }
        });

        if (patchMap.size === 0) return;

        setProjects((prev) => prev.map((project) => applyMetadataPatchToItem(project as any, patchMap) as Project));
        setCurrentWorkspace((prev) => (prev ? applyMetadataPatchToItem(prev as any, patchMap) as Project : prev));
        setFileNameSearchResults((prev) => prev.map((item) => applyMetadataPatchToItem(item as any, patchMap) as DirChild));
        setFolderSearchResults((prev) => prev.map((item) => applyMetadataPatchToItem(item as any, patchMap) as SearchResult));
        setDirChildren((prev) => {
          const next: Record<string, DirChild[]> = {};

          Object.keys(prev).forEach((key) => {
            next[key] = prev[key].map((item) => applyMetadataPatchToItem(item as any, patchMap) as DirChild);
          });

          return next;
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
        const children = (msg.children as DirChild[]) || [];
        const focusOnly = !!msg.focusOnly;

        setLoadingPaths((prev) => {
          const n = new Set(prev);
          n.delete(pathKey);
          return n;
        });

        if (focusOnly) {
          if (!isFocusModeRef.current || !focusRootPathRef.current || !isPathInside(pathKey, focusRootPathRef.current)) {
            return;
          }

          setDirChildren((prev) => ({
            ...prev,
            [pathKey]: children,
          }));

          return;
        }

        setDirChildren((prev) => ({
          ...prev,
          [pathKey]: children,
        }));
      } else if (msg.type === 'deleteFileEntityResult') {
        const deletedPath = msg.fsPath as string;
        const parentPath = msg.parentPath as string;

        setExpandedPaths((prev) => {
          const next = new Set(prev);

          Array.from(next).forEach((itemPath) => {
            if (isPathInside(itemPath, deletedPath)) {
              next.delete(itemPath);
            }
          });

          return next;
        });

        setLoadingPaths((prev) => {
          const next = new Set(prev);

          Array.from(next).forEach((itemPath) => {
            if (isPathInside(itemPath, deletedPath)) {
              next.delete(itemPath);
            }
          });

          return next;
        });

        setDirChildren((prev) => {
          const next = { ...prev };

          Object.keys(next).forEach((key) => {
            if (isPathInside(key, deletedPath)) {
              delete next[key];
            }
          });

          if (next[parentPath]) {
            next[parentPath] = next[parentPath].filter((item) => !isPathInside(item.path, deletedPath));
          }

          return next;
        });

        setSelectedPath((prev) => {
          if (isPathInside(prev, deletedPath)) {
            return parentPath;
          }

          return prev;
        });
      } else if (msg.type === 'createFileEntityResult' || msg.type === 'createFolderEntityResult') {
        const createdPath = msg.fsPath as string;
        const parentPath = msg.parentPath as string;

        setPendingCreateEntity(null);
        setPendingCreateName('');
        setSelectedPath(createdPath);
        setExpandedPaths((prev) => new Set(prev).add(parentPath));
        setLoadingPaths((prev) => new Set(prev).add(parentPath));

        vscode.postMessage({
          type: 'readDir',
          fsPath: parentPath,
          projectName: getProjectNameByPath(parentPath),
          forceRefresh: true,
        });
      } else if (msg.type === 'moveFileEntityResult') {
        const sourcePath = msg.sourcePath as string;
        const targetPath = msg.targetPath as string;
        const oldParentPath = msg.oldParentPath as string;
        const targetParentPath = msg.targetParentPath as string;

        setDraggingEntity(null);
        setDragOverPath('');
        setInvalidDragOverPath('');
        setSelectedPath(targetPath);

        setExpandedPaths((prev) => {
          const next = new Set(prev);

          Array.from(next).forEach((itemPath) => {
            if (isPathInside(itemPath, sourcePath)) {
              next.delete(itemPath);
            }
          });

          next.add(targetParentPath);
          return next;
        });

        setDirChildren((prev) => {
          const next = { ...prev };

          Object.keys(next).forEach((key) => {
            if (isPathInside(key, sourcePath)) {
              delete next[key];
            }
          });

          if (next[oldParentPath]) {
            next[oldParentPath] = next[oldParentPath].filter((item) => item.path !== sourcePath);
          }

          return next;
        });

        [oldParentPath, targetParentPath].forEach((pathValue) => {
          if (!pathValue) return;

          setLoadingPaths((prev) => new Set(prev).add(pathValue));
          vscode.postMessage({
            type: 'readDir',
            fsPath: pathValue,
            projectName: getProjectNameByPath(pathValue),
            forceRefresh: true,
          });
        });
      } else if (msg.type === 'refreshExpandedDirs') {
        const expandedList = Array.from(expandedPathsRef.current).filter((itemPath) => {
          if (!itemPath) return false;

          const hasParentLoaded = Object.keys(dirChildrenRef.current).some((parentPath) => {
            const children = dirChildrenRef.current[parentPath] || [];

            return children.some((child) => child.path === itemPath);
          });

          const isRootProject = projectsRef.current.some((project) => project.fsPath === itemPath);
          const isCurrentWorkspaceRoot = currentWorkspaceRef.current?.fsPath === itemPath;

          return hasParentLoaded || isRootProject || isCurrentWorkspaceRoot;
        });

        if (expandedList.length === 0) {
          return;
        }

        setLoadingPaths((prev) => {
          const next = new Set(prev);

          expandedList.forEach((itemPath) => {
            if (!dirChildrenRef.current[itemPath]) {
              next.add(itemPath);
            }
          });

          return next;
        });

        expandedList.forEach((itemPath) => {
          vscode.postMessage({
            type: 'readDir',
            fsPath: itemPath,
            projectName: getProjectNameByPath(itemPath),
            forceRefresh: true,
          });
        });
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

        window.setTimeout(() => {
          scrollTreeNodeIntoView(targetPath);
        }, 0);

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

  const scrollTreeNodeIntoView = (targetPath: string, retryCount: number = 0) => {
    if (!targetPath || isSearchModeRef.current) return;

    const safeId = `tree-node-${encodeURIComponent(targetPath)}`;
    const el = document.getElementById(safeId);

    if (!el) {
      if (retryCount >= 30) return;

      window.setTimeout(() => {
        scrollTreeNodeIntoView(targetPath, retryCount + 1);
      }, 80);
      return;
    }

    window.requestAnimationFrame(() => {
      el.scrollIntoView({
        behavior: retryCount > 0 ? 'auto' : 'smooth',
        block: 'center',
        inline: 'nearest',
      });

      autoScrollTarget.current = null;
    });
  };

  useEffect(() => {
    if (!autoScrollTarget.current || isSearchMode) return;

    scrollTreeNodeIntoView(autoScrollTarget.current);
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
          focusOnly: false,
        });
      } else {
        vscode.postMessage({
          type: 'searchFileName',
          fsPath: searchTargetProject.path,
          query: folderSearchQuery,
          isRemote: searchTargetProject.isRemote,
          focusOnly: false,
        });
      }
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [folderSearchQuery, isSearchMode, searchTargetProject, folderSearchType, isFocusMode]);

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

  const normalizeTreePath = (pathValue: string) => {
    if (!pathValue) return '';

    return decodeURIComponent(pathValue.split('?')[0])
      .replace(/\\/g, '/')
      .replace(/\/+$/, '');
  };

  const getParentTreePath = (pathValue: string) => {
    const normalizedPath = normalizeTreePath(pathValue);

    if (!normalizedPath) return '';

    const index = normalizedPath.lastIndexOf('/');

    if (index <= 0) return '';

    return normalizedPath.slice(0, index);
  };

  const isSelectedDirectParentPath = (parentPath: string) => {
    if (!selectedPath || !parentPath) return false;

    const normalizedParentPath = normalizeTreePath(parentPath);
    const selectedParentPath = getParentTreePath(selectedPath);

    return normalizedParentPath === selectedParentPath;
  };

  const getTreeChildrenClassName = (parentPath: string, extraClassName: string = '') => {
    return [
      styles['tree-children'],
      isSelectedDirectParentPath(parentPath) ? styles['active-tree-guide'] : '',
      extraClassName,
    ]
      .filter(Boolean)
      .join(' ');
  };

  const requestReadDir = (pathValue: string, projectName: string, forceRefresh: boolean = false) => {
    vscode.postMessage({
      type: 'readDir',
      fsPath: pathValue,
      projectName,
      forceRefresh,
    });
  };

  const isSameTreePath = (leftPath: string, rightPath: string) => {
    return normalizePatchPath(leftPath) === normalizePatchPath(rightPath);
  };

  const getCurrentWorkspacePath = () => {
    return currentWorkspaceRef.current?.fsPath || currentUri || '';
  };

  const isRemoteTreePath = (pathValue: string) => {
    return pathValue.startsWith('vscode-vfs://') || /^https?:\/\//i.test(pathValue);
  };

  const isInsideCurrentWorkspacePath = (pathValue: string) => {
    const workspacePath = getCurrentWorkspacePath();

    if (!workspacePath || isRemoteTreePath(pathValue) || isRemoteTreePath(workspacePath)) {
      return false;
    }

    return isPathInside(normalizePatchPath(pathValue), normalizePatchPath(workspacePath));
  };

  const getParentUriString = (pathValue: string) => {
    if (!pathValue) return '';

    try {
      if (pathValue.includes('://')) {
        const url = new URL(pathValue);
        const pathname = url.pathname.replace(/\/[^/]*$/, '') || '/';
        url.pathname = pathname;
        url.search = '';
        url.hash = '';
        return url.toString().replace(/\/$/, '');
      }
    } catch { }

    const normalized = pathValue.replace(/\\/g, '/').replace(/\/[^/]*$/, '');
    return normalized || pathValue;
  };

  const getCreateParentPath = (payload: ContextMenuPayload) => {
    if (payload.isFolder === false) {
      return getParentUriString(payload.path);
    }

    return payload.path;
  };

  const canCreateInPayload = (payload: ContextMenuPayload) => {
    const targetPath = getCreateParentPath(payload);

    return !!payload.isActiveProject && isInsideCurrentWorkspacePath(targetPath);
  };

  const beginCreateEntity = (type: 'file' | 'folder', payload: ContextMenuPayload) => {
    const parentPath = getCreateParentPath(payload);

    if (!canCreateInPayload(payload)) {
      return;
    }

    const projectName = payload.projectName || getProjectNameByPath(parentPath) || '当前项目';

    setPendingCreateEntity({
      parentPath,
      type,
      projectName,
      isActiveProject: true,
    });
    setPendingCreateName('');
    setSelectedPath(parentPath);
    setExpandedPaths((prev) => new Set(prev).add(parentPath));
    setDirChildren((prev) => {
      if (prev[parentPath]) return prev;

      return {
        ...prev,
        [parentPath]: [],
      };
    });
  };

  const cancelPendingCreateEntity = () => {
    setPendingCreateEntity(null);
    setPendingCreateName('');
  };

  const commitPendingCreateEntity = () => {
    if (!pendingCreateEntity) return;

    const name = pendingCreateName.trim();

    if (!name) {
      cancelPendingCreateEntity();
      return;
    }

    vscode.postMessage({
      type: pendingCreateEntity.type === 'file' ? 'createFile' : 'createFolder',
      fsPath: pendingCreateEntity.parentPath,
      name,
    });

    setPendingCreateEntity(null);
    setPendingCreateName('');
  };

  const canDragEntity = (pathValue: string, isActiveProject: boolean) => {
    const workspacePath = getCurrentWorkspacePath();

    return (
      !!isActiveProject &&
      !!workspacePath &&
      !isRemoteTreePath(pathValue) &&
      isInsideCurrentWorkspacePath(pathValue) &&
      !isSameTreePath(pathValue, workspacePath)
    );
  };

  const getDragEntityFromEvent = (e: React.DragEvent): DraggingEntity | null => {
    if (draggingEntity) return draggingEntity;

    try {
      const raw = e.dataTransfer.getData('application/quickops-tree-item');
      return raw ? JSON.parse(raw) as DraggingEntity : null;
    } catch {
      return null;
    }
  };

  const canDropEntityToFolder = (entity: DraggingEntity | null, targetFolderPath: string, isActiveProject: boolean) => {
    if (!entity || !targetFolderPath || !isActiveProject) return false;
    if (!canDragEntity(entity.path, true)) return false;
    if (!isInsideCurrentWorkspacePath(targetFolderPath)) return false;
    if (isSameTreePath(entity.path, targetFolderPath)) return false;

    const sourceParentPath = getParentUriString(entity.path);

    if (isSameTreePath(sourceParentPath, targetFolderPath)) {
      return false;
    }

    if (entity.isFolder && isPathInside(normalizePatchPath(targetFolderPath), normalizePatchPath(entity.path))) {
      return false;
    }

    return true;
  };

  const handleDragStart = (e: React.DragEvent, child: DirChild, projectName: string, isActiveProject: boolean) => {
    if (!canDragEntity(child.path, isActiveProject)) {
      e.preventDefault();
      return;
    }

    const entity: DraggingEntity = {
      path: child.path,
      name: child.name,
      isFolder: !!child.isFolder,
      projectName,
    };

    setDraggingEntity(entity);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/quickops-tree-item', JSON.stringify(entity));
    e.dataTransfer.setData('text/plain', child.path);
  };

  const handleDragEnd = () => {
    setDraggingEntity(null);
    setDragOverPath('');
    setInvalidDragOverPath('');
  };

  const handleDragOverFolder = (e: React.DragEvent, targetFolderPath: string, isActiveProject: boolean) => {
    const entity = getDragEntityFromEvent(e);
    const canDrop = canDropEntityToFolder(entity, targetFolderPath, isActiveProject);

    if (!entity) return;

    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = canDrop ? 'move' : 'none';

    if (canDrop) {
      setDragOverPath(targetFolderPath);
      setInvalidDragOverPath('');
    } else {
      setDragOverPath('');
      setInvalidDragOverPath(targetFolderPath);
    }
  };

  const handleDragLeaveFolder = (e: React.DragEvent, targetFolderPath: string) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) {
      return;
    }

    setDragOverPath((prev) => (prev === targetFolderPath ? '' : prev));
    setInvalidDragOverPath((prev) => (prev === targetFolderPath ? '' : prev));
  };

  const handleDropOnFolder = (e: React.DragEvent, targetFolderPath: string, isActiveProject: boolean) => {
    const entity = getDragEntityFromEvent(e);

    e.preventDefault();
    e.stopPropagation();

    setDragOverPath('');
    setInvalidDragOverPath('');

    if (!canDropEntityToFolder(entity, targetFolderPath, isActiveProject) || !entity) {
      return;
    }

    setExpandedPaths((prev) => new Set(prev).add(targetFolderPath));
    setLoadingPaths((prev) => new Set(prev).add(targetFolderPath));

    vscode.postMessage({
      type: 'moveFileEntity',
      sourceFsPath: entity.path,
      targetFolderFsPath: targetFolderPath,
      isFolder: entity.isFolder,
    });
  };

  const getDropClassName = (targetFolderPath: string) => {
    if (dragOverPath === targetFolderPath) {
      return styles['drop-target'];
    }

    if (invalidDragOverPath === targetFolderPath) {
      return styles['drop-target-invalid'];
    }

    return '';
  };

  const renderPendingCreateRow = (parentPath: string, _projectName: string, isActiveProject: boolean) => {
    if (!pendingCreateEntity || !isSameTreePath(pendingCreateEntity.parentPath, parentPath)) {
      return null;
    }

    if (!pendingCreateEntity.isActiveProject || !isActiveProject) {
      return null;
    }

    const isFolder = pendingCreateEntity.type === 'folder';

    return (
      <div className={styles['new-entity-wrapper']} key={`pending-${parentPath}`}>
        <div className={`${styles['sub-item']} ${styles['new-entity-row']} ${styles['selected']}`}>
          <div className={styles['chevron-placeholder']}></div>

          {isFolder ? (
            <FontAwesomeIcon
              icon={faFolder}
              className={`${styles['icon-closed']} ${styles['sub-icon']} ${styles['folder-icon']}`}
            />
          ) : (
            <FileIcon
              fileName={pendingCreateName || 'untitled'}
              className={styles['sub-icon']}
            />
          )}

          <input
            ref={pendingCreateInputRef}
            className={styles['new-entity-input']}
            value={pendingCreateName}
            placeholder={isFolder ? '新建文件夹' : '新建文件'}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setPendingCreateName(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onBlur={cancelPendingCreateEntity}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitPendingCreateEntity();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                cancelPendingCreateEntity();
              }
            }}
          />
        </div>
      </div>
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
          }

          requestReadDir(pathValue, projectName, true);
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

      case 'createFile':
        beginCreateEntity('file', payload);
        break;

      case 'createFolder':
        beginCreateEntity('folder', payload);
        break;
      case 'deleteFileEntity':
        vscode.postMessage({
          type: 'deleteFileEntity',
          fsPath: payload.path,
          isFolder: !!payload.isFolder,
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

      case 'compareWithOldCode':
        vscode.postMessage({
          type: 'compareWithOldCode',
          fsPath: payload.path,
          projectName: payload.projectName || getProjectNameByPath(payload.path),
          status: (payload as any).status,
        });
        break;

      case 'discardFileChanges':
        vscode.postMessage({
          type: 'discardFileChanges',
          fsPath: payload.path,
          status: (payload as any).status,
        });
        break;

      case 'collapseFolderChildren': {
        const targetPath = payload.path;

        setExpandedPaths((prev) => {
          const next = new Set(prev);

          Array.from(next).forEach((itemPath) => {
            if (isPathInside(itemPath, targetPath)) {
              next.delete(itemPath);
            }
          });

          return next;
        });

        setLoadingPaths((prev) => {
          const next = new Set(prev);

          Array.from(next).forEach((itemPath) => {
            if (isPathInside(itemPath, targetPath)) {
              next.delete(itemPath);
            }
          });

          return next;
        });

        break;
      }

      case 'searchInFolder':
        setSearchTargetProject(payload);
        setIsSearchMode(true);
        setIsFocusMode(false);
        setFocusRootPath('');
        setFocusRootName('');
        setFolderSearchQuery('');
        setFolderSearchResults([]);
        setFileNameSearchResults([]);
        setFolderSearchError('');
        break;

      case 'focusMode': {
        const currentWorkspaceValue = currentWorkspaceRef.current;
        const targetPath = currentWorkspaceValue?.fsPath || payload.path;
        const title =
          currentWorkspaceValue?.customName ||
          currentWorkspaceValue?.name ||
          payload.customName ||
          payload.originalName ||
          payload.name ||
          '当前项目';

        if (!targetPath) {
          break;
        }

        cacheNormalDirChildrenBeforeFocus(targetPath);

        const focusRefreshPaths = Array.from(new Set([
          targetPath,
          ...Array.from(expandedPathsRef.current).filter((itemPath) =>
            !!itemPath && isPathInside(itemPath, targetPath)
          ),
        ]));

        setSearchTargetProject({
          ...payload,
          path: targetPath,
          name: title,
          projectName: title,
          isActiveProject: true,
        });
        setIsSearchMode(true);
        setIsFocusMode(true);
        setFocusRootPath(targetPath);
        setFocusRootName(title);
        setFolderSearchQuery('');
        setFolderSearchResults([]);
        setFileNameSearchResults([]);
        setFolderSearchError('');
        setCurrentActiveMatch(0);

        setExpandedPaths((prev) => {
          const next = new Set(prev);
          next.add(targetPath);
          return next;
        });

        setLoadingPaths((prev) => {
          const next = new Set(prev);

          focusRefreshPaths.forEach((itemPath) => {
            if (!dirChildrenRef.current[itemPath]) {
              next.add(itemPath);
            }
          });

          return next;
        });

        focusRefreshPaths.forEach((itemPath) => {
          vscode.postMessage({
            type: 'readDir',
            fsPath: itemPath,
            projectName: title,
            forceRefresh: true,
          });
        });

        break;
      }

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

  const exitSearchOrFocusMode = () => {
    const exitingFocusMode = isFocusModeRef.current;
    const exitingFocusRootPath = focusRootPathRef.current;
    const exitingFocusRootName = focusRootNameRef.current || getProjectNameByPath(exitingFocusRootPath);
    const normalSnapshot = normalDirChildrenBeforeFocusRef.current;

    setIsSearchMode(false);
    setIsFocusMode(false);
    setSearchTargetProject(null);
    setFocusRootPath('');
    setFocusRootName('');
    setFolderSearchQuery('');
    setFolderSearchResults([]);
    setFileNameSearchResults([]);
    setFolderSearchError('');
    setIsSearchingFolder(false);
    setCurrentActiveMatch(0);

    if (!exitingFocusMode || !exitingFocusRootPath) {
      normalDirChildrenBeforeFocusRef.current = {};
      return;
    }

    setDirChildren((prev) => {
      const next = { ...prev };

      Object.keys(next).forEach((key) => {
        if (isPathInside(key, exitingFocusRootPath)) {
          delete next[key];
        }
      });

      Object.keys(normalSnapshot).forEach((key) => {
        next[key] = normalSnapshot[key];
      });

      return next;
    });

    const expandedList = Array.from(expandedPathsRef.current).filter((itemPath) =>
      isPathInside(itemPath, exitingFocusRootPath)
    );

    const refreshList = expandedList.length > 0 ? expandedList : [exitingFocusRootPath];

    setLoadingPaths((prev) => {
      const next = new Set(prev);

      refreshList.forEach((itemPath) => {
        if (!normalSnapshot[itemPath] && !dirChildrenRef.current[itemPath]) {
          next.add(itemPath);
        }
      });

      return next;
    });

    refreshList.forEach((itemPath) => {
      vscode.postMessage({
        type: 'readDir',
        fsPath: itemPath,
        projectName: getProjectNameByPath(itemPath) || exitingFocusRootName || '当前项目',
        forceRefresh: true,
      });
    });

    normalDirChildrenBeforeFocusRef.current = {};
  };


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

    const pendingCreateRow = renderPendingCreateRow(parentPath, projectName, isActiveProject);

    if (children.length === 0 && !pendingCreateRow) {
      return <div className={styles['empty-node']}>（空文件夹/无读取权限）</div>;
    }

    return (
      <>
        {pendingCreateRow}
        {children.map((child) => {
          const childPath = child.path;
          const isExpanded = expandedPaths.has(childPath);
          const childLoading = loadingPaths.has(childPath) && !dirChildren[childPath];
          const isRemote = childPath.startsWith('vscode-vfs') || childPath.startsWith('http');
          const elementId = `tree-node-${encodeURIComponent(childPath)}`;
          const statusClassName = getGitStatusClassName(child.status);

          if (child.isFolder) {
            return (
              <div key={childPath}>
                <div
                  id={elementId}
                  className={`${styles['sub-item']} ${styles['clickable-sub']} ${selectedPath === childPath ? styles['selected'] : ''
                    } ${styles['search-name-sub-item']} ${draggingEntity?.path === childPath ? styles['dragging'] : ''} ${getDropClassName(childPath)}`}
                  draggable={canDragEntity(childPath, isActiveProject)}
                  onDragStart={(e) => handleDragStart(e, child, projectName, isActiveProject)}
                  onDragEnd={handleDragEnd}
                  onDragOver={(e) => handleDragOverFolder(e, childPath, isActiveProject)}
                  onDragLeave={(e) => handleDragLeaveFolder(e, childPath)}
                  onDrop={(e) => handleDropOnFolder(e, childPath, isActiveProject)}
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
                    icon={isExpanded ? faFolderOpen : faFolder}
                    className={`${styles['icon-closed']} ${styles['sub-icon']} ${styles['folder-icon']}`}
                  />

                  <Tooltip
                    content={getTreeTooltipContent(childPath, child, true)}
                    placement="bottom"
                    align="start"
                    delay={2000}
                  >
                    <span
                      className={styles['sub-name']}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        pointerEvents: 'auto',
                      }}
                    >
                      {child.name}
                    </span>
                  </Tooltip>

                  <FolderGitStatusDot status={child.status} />
                </div>

                {isExpanded && (
                  <div
                    className={getTreeChildrenClassName(
                      childPath,
                      styles['search-name-tree-children']
                    )}
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
                  } ${styles['search-name-sub-item-clickable']} ${draggingEntity?.path === childPath ? styles['dragging'] : ''}`}
                draggable={canDragEntity(childPath, isActiveProject)}
                onDragStart={(e) => handleDragStart(e, child, projectName, isActiveProject)}
                onDragEnd={handleDragEnd}
                onClick={(e) => handleOpenFile(childPath, projectName, isActiveProject, e)}
                onContextMenu={(e) =>
                  handleContextMenu(e, 'sub', {
                    path: childPath,
                    name: child.name,
                    isFolder: false,
                    projectName,
                    isActiveProject,
                    isRemote: childPath.startsWith('vscode-vfs://') || /^https?:\/\//i.test(childPath),
                    status: child.status,
                  } as any)
                }
              >
                <div className={styles['chevron-placeholder']}></div>

                <FileIcon
                  fileName={child.name}
                  status={child.status}
                  className={styles['sub-icon']}
                />

                <Tooltip
                  content={getTreeTooltipContent(childPath, child, false)}
                  placement="bottom"
                  align="start"
                  delay={2000}
                >
                  <span className={styles['sub-name']}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      pointerEvents: 'auto',
                    }}
                  >
                    {child.name}
                  </span>
                </Tooltip>

                <FileGitStatusBadge status={child.status} />
                {renderDiagnosticsBadge(child)}
              </div>
            </div>
          );
        })}
      </>
    );
  };

  if (isInitLoading) {
    return <ProjectInitLoading text="正在加载项目视图..." />;
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
          focusMode={isFocusMode}
          focusTree={
            isFocusMode && focusRootPath ? (
              <div className={styles['focus-tree-wrapper']}>
                {renderTreeChildren(focusRootPath, focusRootName || '当前项目', true)}
              </div>
            ) : null
          }
          onBack={exitSearchOrFocusMode}
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

          <Scrollbar className={styles['list-container']} viewClassName={styles['list-view']}>
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
                    const title = p.customName || p.name;
                    const displayPath = getDisplayPath(p);
                    const finalPath = p.customName ? `${p.name} • ${displayPath}` : displayPath;
                    const branch = branchMap[p.fsPath] || p.branch;
                    const isExpanded = expandedPaths.has(rootPath);
                    const projectIcon = isRemote
                      ? (isGitlab ? faGitlab : faGithub)
                      : (isExpanded ? faFolderOpen : faFolder);
                    const rootLoading = loadingPaths.has(rootPath) && !dirChildren[rootPath];
                    const elementId = `tree-node-${encodeURIComponent(rootPath)}`;

                    return (
                      <div key={rootPath}>
                        <div
                          id={elementId}
                          className={`${styles['active-top-project']} ${selectedPath === rootPath ? styles['selected'] : ''
                            } ${inHistory ? styles['in-history'] : styles['not-in-history']} ${getDropClassName(rootPath)}`}
                          onDragOver={(e) => handleDragOverFolder(e, rootPath, true)}
                          onDragLeave={(e) => handleDragLeaveFolder(e, rootPath)}
                          onDrop={(e) => handleDropOnFolder(e, rootPath, true)}
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
                                  icon={projectIcon}
                                  className={`${styles['project-icon']} ${inHistory ? styles['icon-opened'] : ''
                                    }`}
                                />

                                <Tooltip
                                  content={getRootProjectTooltipContent(rootPath, p)}
                                  placement="bottom"
                                  align="start"
                                  delay={2000}
                                >
                                  <span
                                    className={styles['project-name']}
                                    style={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      pointerEvents: 'auto',
                                    }}
                                  >
                                    {title}
                                  </span>
                                </Tooltip>

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
                          <div
                            className={getTreeChildrenClassName(
                              rootPath,
                              styles['root-tree-children']
                            )}
                          >
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
                    const title = p.customName || p.name;
                    const displayPath = getDisplayPath(p);
                    const finalPath = p.customName ? `${p.name} • ${displayPath}` : displayPath;
                    const isExpanded = expandedPaths.has(rootPath);
                    const projectIcon = isRemote
                      ? (isGitlab ? faGitlab : faGithub)
                      : (isExpanded ? faFolderOpen : faFolder);
                    const itemLoading = loadingPaths.has(rootPath) && !dirChildren[rootPath];
                    const branch = branchMap[p.fsPath] || p.branch;
                    const elementId = `tree-node-${encodeURIComponent(rootPath)}`;

                    return (
                      <li key={rootPath}>
                        <div
                          id={elementId}
                          className={`${styles['project-item']} ${isJustOpened ? styles['just-opened'] : ''
                            } ${selectedPath === rootPath ? styles['selected'] : ''}`}
                          onDoubleClick={() => handleOpenProject(p.fsPath)}
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
                                  icon={projectIcon}
                                  className={`${styles['project-icon']} ${styles['icon-closed']}`}
                                />

                                <Tooltip
                                  content={getRootProjectTooltipContent(rootPath, p)}
                                  placement="bottom"
                                  align="start"
                                  delay={2000}
                                >
                                  <span
                                    className={styles['project-name']}
                                    style={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      pointerEvents: 'auto',
                                    }}
                                  >
                                    {title}
                                  </span>
                                </Tooltip>

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
                          <div
                            className={getTreeChildrenClassName(
                              rootPath,
                              styles['root-tree-children']
                            )}
                          >
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
          </Scrollbar>

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