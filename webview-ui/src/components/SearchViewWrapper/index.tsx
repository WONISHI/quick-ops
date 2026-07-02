import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChevronDown, faChevronRight, faFolder, faFolderOpen, faSpinner } from '@fortawesome/free-solid-svg-icons';

import { vscode } from '../../utils/vscode';
import FileIcon from '../FileIcon';
import HighlightText from '../HighlightText';
import Tooltip from '../Tooltip';
import Scrollbar, { type ScrollbarInstance } from '../Scrollbar';
import type { ContextMenuPayload, DirChild, SearchMatch, SearchResult } from '../../types/RecentProjectsApp';

import styles from './index.module.css';

type FolderSearchType = 'content' | 'name';

type FlatMatchItem = {
  fileIndex: number;
  matchIndex: number;
  lineGlobalIndex: number;
  fullPath: string;
  lineNum: number;
};

interface SearchViewWrapperProps {
  searchTargetProject: ContextMenuPayload;

  focusMode?: boolean;
  focusLocked?: boolean;
  focusTree?: React.ReactNode;
  onBack?: () => void;
  onLockFocusMode?: () => void;
  onExitLockedFocusMode?: () => void;

  folderSearchQuery: string;
  setFolderSearchQuery: React.Dispatch<React.SetStateAction<string>>;

  folderSearchType: FolderSearchType;
  setFolderSearchType: React.Dispatch<React.SetStateAction<FolderSearchType>>;

  folderSearchResults: SearchResult[];
  setFolderSearchResults: React.Dispatch<React.SetStateAction<SearchResult[]>>;

  fileNameSearchResults: DirChild[];
  setFileNameSearchResults: React.Dispatch<React.SetStateAction<DirChild[]>>;

  folderSearchError: string;
  setFolderSearchError: React.Dispatch<React.SetStateAction<string>>;

  isSearchingFolder: boolean;

  totalMatches: number;
  currentActiveMatch: number;
  setCurrentActiveMatch: React.Dispatch<React.SetStateAction<number>>;

  lineStartIndexMap: Map<string, number>;
  flatMatchesList: FlatMatchItem[];

  expandedPaths: Set<string>;
  selectedPath: string;

  setIsSearchMode: React.Dispatch<React.SetStateAction<boolean>>;

  handlePrevSearchMatch: () => void;
  handleNextSearchMatch: () => void;

  handleToggleExpand: (path: string, projectName: string, isRemote: boolean, e: React.MouseEvent) => void;

  handleOpenFile: (path: string, projectName: string, isActiveProject: boolean, e: React.MouseEvent) => void;

  renderTreeChildren: (parentPath: string, projectName: string, isActiveProject?: boolean, highlightQuery?: string) => React.ReactNode;
}

interface ExtensionTagOption {
  ext: string;
  count: number;
}

const EXTENSION_TAG_PRIORITY = ['js', 'ts', 'json', 'jsx', 'tsx', 'vue', 'css', 'scss', 'less', 'html', 'htm', 'md', 'mdx', 'yml', 'yaml', 'xml', 'svg', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'txt'];

const EXTENSION_TAG_COLOR_MAP: Record<string, string> = {
  js: '#f1e05a',
  jsx: '#f1e05a',
  ts: '#3178c6',
  tsx: '#3178c6',
  json: '#cbcb41',
  vue: '#41b883',
  css: '#563d7c',
  scss: '#c6538c',
  less: '#1d365d',
  html: '#e34c26',
  htm: '#e34c26',
  md: '#5dade2',
  mdx: '#5dade2',
  yml: '#cb171e',
  yaml: '#cb171e',
  xml: '#e37933',
  svg: '#ffb13b',
  png: '#a074c4',
  jpg: '#a074c4',
  jpeg: '#a074c4',
  webp: '#a074c4',
  gif: '#a074c4',
  txt: '#8b949e',
};

const EXTENSION_TAG_FALLBACK_COLORS = ['#007acc', '#4ec9b0', '#c586c0', '#dcdcaa', '#ce9178', '#9cdcfe', '#b5cea8', '#d7ba7d'];

function getFileExtensionTag(fileName: string) {
  const purePath = String(fileName || '')
    .split('?')[0]
    .replace(/\\/g, '/');
  const baseName = purePath.split('/').pop() || purePath || '未知文件';
  const dotIndex = baseName.lastIndexOf('.');

  if (dotIndex <= 0 || dotIndex === baseName.length - 1) {
    return baseName;
  }

  return baseName.slice(dotIndex + 1).toLowerCase();
}

function getExtensionTagPriority(ext: string) {
  const index = EXTENSION_TAG_PRIORITY.indexOf(ext.toLowerCase());

  return index === -1 ? EXTENSION_TAG_PRIORITY.length + 1 : index;
}

function getExtensionTagColor(ext: string) {
  const lowerExt = ext.toLowerCase();
  const mappedColor = EXTENSION_TAG_COLOR_MAP[lowerExt];

  if (mappedColor) {
    return mappedColor;
  }

  let hash = 0;

  for (let i = 0; i < lowerExt.length; i++) {
    hash = (hash * 31 + lowerExt.charCodeAt(i)) >>> 0;
  }

  return EXTENSION_TAG_FALLBACK_COLORS[hash % EXTENSION_TAG_FALLBACK_COLORS.length];
}

function normalizeFallbackPath(pathValue: string) {
  return decodeURIComponent(pathValue.split('?')[0])
    .replace(/^file:\/\//, '')
    .replace(/\\/g, '/')
    .replace(/\/+$/, '');
}

function normalizeTooltipPath(pathValue: string) {
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

      return decodeURIComponent(url.pathname || pathValue)
        .replace(/\\/g, '/')
        .replace(/\/+$/, '');
    }
  } catch {
    return normalizeFallbackPath(pathValue);
  }

  return normalizeFallbackPath(pathValue);
}

function formatSearchNameTooltipPath(pathValue: string) {
  const normalizedPath = normalizeTooltipPath(pathValue);

  if (!normalizedPath) return '';

  const macHomeMatch = normalizedPath.match(/^\/Users\/[^/]+(\/.*)?$/);

  if (macHomeMatch) {
    return `~${macHomeMatch[1] || ''}`;
  }

  const windowsHomeMatch = normalizedPath.match(/^[a-zA-Z]:\/Users\/[^/]+(\/.*)?$/);

  if (windowsHomeMatch) {
    return `~${windowsHomeMatch[1] || ''}`;
  }

  return normalizedPath;
}

function getSearchResultFileDisplayInfo(pathValue: string) {
  const normalizedPath = String(pathValue || '')
    .split('?')[0]
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/\/+$/, '');

  if (!normalizedPath) {
    return {
      fileName: '未知文件',
      folderPath: '',
    };
  }

  const parts = normalizedPath.split('/').filter(Boolean);
  const fileName = parts.pop() || normalizedPath;
  const folderPath = parts.join('/');

  return {
    fileName,
    folderPath,
  };
}

function getSearchNameHighlightTokens(query: string) {
  const value = String(query || '').trim();

  if (!value) return [] as string[];

  const tokenSet = new Set<string>();
  const parts = value
    .replace(/\\/g, '/')
    .split(/[\s/]+/)
    .map((item) => item.trim())
    .filter(Boolean);

  const rawTokens = parts.length > 0 ? parts : [value];

  rawTokens.forEach((item) => {
    tokenSet.add(item);

    const withoutDot = item.replace(/^\.+/, '');

    if (withoutDot) {
      tokenSet.add(withoutDot);
    }
  });

  const compactValue = value.replace(/[\s\/_.-]+/g, '');

  if (compactValue && compactValue !== value) {
    tokenSet.add(compactValue);
  }

  return Array.from(tokenSet)
    .map((item) => item.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
}

function renderSearchNameHighlightText(text: string, query: string) {
  const value = String(text || '');
  const tokens = getSearchNameHighlightTokens(query);

  if (!value || tokens.length === 0) {
    return value;
  }

  const lowerValue = value.toLowerCase();
  const ranges: Array<{ start: number; end: number }> = [];

  tokens.forEach((token) => {
    const lowerToken = token.toLowerCase();

    if (!lowerToken) return;

    let start = 0;

    while (start < lowerValue.length) {
      const index = lowerValue.indexOf(lowerToken, start);

      if (index === -1) break;

      ranges.push({
        start: index,
        end: index + lowerToken.length,
      });
      start = index + Math.max(1, lowerToken.length);
    }
  });

  if (ranges.length === 0) {
    return value;
  }

  const mergedRanges: Array<{ start: number; end: number }> = [];

  ranges
    .sort((a, b) => (a.start === b.start ? b.end - a.end : a.start - b.start))
    .forEach((range) => {
      const lastRange = mergedRanges[mergedRanges.length - 1];

      if (!lastRange || range.start >= lastRange.end) {
        mergedRanges.push(range);
      } else if (range.end > lastRange.end) {
        lastRange.end = range.end;
      }
    });

  const nodes: React.ReactNode[] = [];
  let cursor = 0;

  mergedRanges.forEach((range, index) => {
    if (range.start > cursor) {
      nodes.push(value.slice(cursor, range.start));
    }

    nodes.push(
      <mark
        key={`${range.start}-${range.end}-${index}`}
        style={{
          padding: '0 1px',
          borderRadius: 2,
          color: 'inherit',
          background: 'var(--vscode-editor-findMatchHighlightBackground, rgba(234, 179, 8, 0.35))',
        }}
      >
        {value.slice(range.start, range.end)}
      </mark>,
    );
    cursor = range.end;
  });

  if (cursor < value.length) {
    nodes.push(value.slice(cursor));
  }

  return nodes;
}

function getContentSearchHighlightTokens(query: string) {
  const value = String(query || '').trim();

  if (!value) return [] as string[];

  const tokenSet = new Set<string>();

  tokenSet.add(value);

  value
    .replace(/\\/g, '/')
    .split(/[\s/]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .forEach((item) => {
      tokenSet.add(item);

      const withoutDot = item.replace(/^\.+/, '');

      if (withoutDot) {
        tokenSet.add(withoutDot);
      }
    });

  return Array.from(tokenSet)
    .map((item) => item.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
}

function findFirstContentKeywordIndex(text: string, query: string) {
  const value = String(text || '');
  const lowerValue = value.toLowerCase();
  const tokens = getContentSearchHighlightTokens(query);

  let firstIndex = -1;

  tokens.forEach((token) => {
    const lowerToken = token.toLowerCase();

    if (!lowerToken) return;

    const index = lowerValue.indexOf(lowerToken);

    if (index === -1) return;

    if (firstIndex === -1 || index < firstIndex) {
      firstIndex = index;
    }
  });

  return firstIndex;
}

/**
 * 内容搜索结果单行预览：
 * - 关键词在前面：直接展示原文本；
 * - 关键词在中间 / 后面：截取关键词附近内容，前面补 ...
 * - 这样既能保持单行，又不会把关键词埋到省略号后面。
 */
function getContentSearchPreviewText(text: string, query: string) {
  const value = String(text || '').replace(/\r?\n/g, ' ');
  const keywordIndex = findFirstContentKeywordIndex(value, query);

  if (keywordIndex === -1) {
    return value.trimStart();
  }

  const keepBeforeKeyword = 18;

  if (keywordIndex <= keepBeforeKeyword) {
    return value.trimStart();
  }

  const start = Math.max(0, keywordIndex - keepBeforeKeyword);

  return `... ${value.slice(start).trimStart()}`;
}

export default function SearchViewWrapper(props: SearchViewWrapperProps) {
  const {
    searchTargetProject,
    focusMode,
    focusLocked,
    focusTree,
    onBack,
    onLockFocusMode,
    onExitLockedFocusMode,

    folderSearchQuery,
    setFolderSearchQuery,

    folderSearchType,
    setFolderSearchType,

    folderSearchResults,
    setFolderSearchResults,

    fileNameSearchResults,
    setFileNameSearchResults,

    folderSearchError,
    setFolderSearchError,

    isSearchingFolder,

    totalMatches,
    currentActiveMatch,
    setCurrentActiveMatch,

    lineStartIndexMap,
    flatMatchesList,

    expandedPaths,
    selectedPath,

    setIsSearchMode,

    handlePrevSearchMatch,
    handleNextSearchMatch,
    handleToggleExpand,
    handleOpenFile,
    renderTreeChildren,
  } = props;

  const [activeExtensionTags, setActiveExtensionTags] = useState<Set<string>>(new Set());
  const resultScrollbarRef = useRef<ScrollbarInstance>(null);
  const resultScrollTopRef = useRef(0);
  const previousResultSearchKeyRef = useRef('');

  /**
   * 只有真正处于“专注模式 + 锁定模式”这一层时，返回按钮才显示锁。
   * 如果只是从锁定专注模式里右键进入“查找文件内容”，当前层是搜索页，
   * 这里应该显示返回箭头，并返回上一层，而不是先退出锁定模式。
   */
  const isLockedFocusView = !!focusMode && !!focusLocked;

  const resetSearchData = (options?: { keepQuery?: boolean }) => {
    if (!options?.keepQuery) {
      setFolderSearchQuery('');
    }

    setFolderSearchResults([]);
    setFileNameSearchResults([]);
    setFolderSearchError('');
    setActiveExtensionTags(new Set());
  };

  const handleBack = () => {
    if (isLockedFocusView) {
      onExitLockedFocusMode?.();
      return;
    }

    if (onBack) {
      onBack();
    } else {
      setIsSearchMode(false);
    }
  };

  const handleSearchTitleDoubleClick = () => {
    if (!focusMode || focusLocked) {
      return;
    }

    onLockFocusMode?.();
  };

  const switchSearchType = (nextType?: FolderSearchType, options?: { keepQuery?: boolean }) => {
    const targetType = nextType || (folderSearchType === 'content' ? 'name' : 'content');

    if (targetType === folderSearchType) {
      return;
    }

    setFolderSearchType(targetType);
    resetSearchData({
      keepQuery: !!options?.keepQuery,
    });
    setCurrentActiveMatch(0);
  };

  const handleToggleSearchType = () => {
    switchSearchType();
  };

  const handleSearchInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const key = e.key.toLowerCase();
    const isCommandKey = e.ctrlKey || e.metaKey;

    if (isCommandKey && e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      switchSearchType();
      return;
    }

    if (isCommandKey && e.shiftKey && key === 'f') {
      e.preventDefault();
      e.stopPropagation();
      switchSearchType('name');
      return;
    }

    if (isCommandKey && e.shiftKey && key === 'c') {
      e.preventDefault();
      e.stopPropagation();
      switchSearchType('content');
      return;
    }

    /**
     * 搜索输入框为空时，Backspace / Delete 只拦截事件，不退出搜索 / 专注模式。
     * 退出搜索 / 专注模式只能点击左上角 search-back-btn。
     */
    if ((e.key === 'Backspace' || e.key === 'Delete') && e.currentTarget.value === '') {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const getSearchTargetTitle = () => {
    const projectName = searchTargetProject.projectName || '';
    const currentName = searchTargetProject.name || '';
    const title = searchTargetProject.customName || searchTargetProject.originalName || currentName || projectName || '';

    if (projectName && currentName && projectName !== currentName) {
      return `${projectName} / ${currentName}`;
    }

    return title;
  };

  const getTargetProjectName = () => {
    return searchTargetProject.projectName || searchTargetProject.name || searchTargetProject.originalName || '';
  };

  const getFileStatusClassName = (status?: string) => {
    if (!status) return '';

    const safeStatus = status.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    return styles[`file-status-${safeStatus}`] || styles['file-status-xxx'] || '';
  };

  const extensionTagOptions = useMemo<ExtensionTagOption[]>(() => {
    if (folderSearchType !== 'content' || folderSearchResults.length === 0) {
      return [];
    }

    const countMap = new Map<string, number>();

    folderSearchResults.forEach((item) => {
      const ext = getFileExtensionTag(item.file || item.fullPath || '');
      countMap.set(ext, (countMap.get(ext) || 0) + 1);
    });

    return Array.from(countMap.entries())
      .map(([ext, count]) => ({ ext, count }))
      .sort((a, b) => {
        const aPriority = getExtensionTagPriority(a.ext);
        const bPriority = getExtensionTagPriority(b.ext);

        if (aPriority !== bPriority) return aPriority - bPriority;
        if (b.count !== a.count) return b.count - a.count;

        return a.ext.localeCompare(b.ext);
      });
  }, [folderSearchResults, folderSearchType]);

  const defaultActiveExtensionTags = useMemo(() => {
    if (folderSearchType !== 'content' || isSearchingFolder || folderSearchError) {
      return new Set<string>();
    }

    return new Set(extensionTagOptions.map((item) => item.ext));
  }, [extensionTagOptions, folderSearchType, folderSearchError, isSearchingFolder]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setActiveExtensionTags(defaultActiveExtensionTags);
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [defaultActiveExtensionTags]);

  const filteredContentResults = useMemo(() => {
    if (folderSearchType !== 'content') {
      return [] as Array<{ result: SearchResult; originalIndex: number }>;
    }

    if (extensionTagOptions.length === 0) {
      return folderSearchResults.map((result, originalIndex) => ({
        result,
        originalIndex,
      }));
    }

    return folderSearchResults.map((result, originalIndex) => ({ result, originalIndex })).filter(({ result }) => activeExtensionTags.has(getFileExtensionTag(result.file || result.fullPath || '')));
  }, [activeExtensionTags, extensionTagOptions.length, folderSearchResults, folderSearchType]);

  const visibleContentFileIndexSet = useMemo(() => {
    return new Set(filteredContentResults.map((item) => item.originalIndex));
  }, [filteredContentResults]);

  const filteredFlatMatchesList = useMemo(() => {
    if (folderSearchType !== 'content' || extensionTagOptions.length === 0) {
      return flatMatchesList.map((item, actualIndex) => ({
        ...item,
        actualIndex,
      }));
    }

    return flatMatchesList
      .map((item, actualIndex) => ({
        ...item,
        actualIndex,
      }))
      .filter((item) => visibleContentFileIndexSet.has(item.fileIndex));
  }, [extensionTagOptions.length, flatMatchesList, folderSearchType, visibleContentFileIndexSet]);

  const filteredCurrentActiveIndex = useMemo(() => {
    return filteredFlatMatchesList.findIndex((item) => item.actualIndex === currentActiveMatch);
  }, [currentActiveMatch, filteredFlatMatchesList]);

  const effectiveTotalMatches = folderSearchType === 'content' && extensionTagOptions.length > 0 ? filteredFlatMatchesList.length : totalMatches;

  const effectiveCurrentActiveMatch = folderSearchType === 'content' && extensionTagOptions.length > 0 ? Math.max(0, filteredCurrentActiveIndex) : currentActiveMatch;

  const handlePrevEffectiveSearchMatch = () => {
    if (folderSearchType !== 'content' || extensionTagOptions.length === 0) {
      handlePrevSearchMatch();
      return;
    }

    if (filteredFlatMatchesList.length === 0) return;

    const currentIndex = filteredCurrentActiveIndex >= 0 ? filteredCurrentActiveIndex : 0;
    const prevIndex = (currentIndex - 1 + filteredFlatMatchesList.length) % filteredFlatMatchesList.length;
    setCurrentActiveMatch(filteredFlatMatchesList[prevIndex].actualIndex);
  };

  const handleNextEffectiveSearchMatch = () => {
    if (folderSearchType !== 'content' || extensionTagOptions.length === 0) {
      handleNextSearchMatch();
      return;
    }

    if (filteredFlatMatchesList.length === 0) return;

    const currentIndex = filteredCurrentActiveIndex >= 0 ? filteredCurrentActiveIndex : -1;
    const nextIndex = (currentIndex + 1) % filteredFlatMatchesList.length;
    setCurrentActiveMatch(filteredFlatMatchesList[nextIndex].actualIndex);
  };

  useEffect(() => {
    if (folderSearchType !== 'content' || extensionTagOptions.length === 0) return;
    if (filteredFlatMatchesList.length === 0) return;
    if (filteredCurrentActiveIndex >= 0) return;

    const timer = window.setTimeout(() => {
      setCurrentActiveMatch(filteredFlatMatchesList[0].actualIndex);
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [extensionTagOptions.length, filteredCurrentActiveIndex, filteredFlatMatchesList, folderSearchType, setCurrentActiveMatch]);

  const handleToggleExtensionTag = (ext: string) => {
    setActiveExtensionTags((prev) => {
      const next = new Set(prev);

      if (next.has(ext)) {
        next.delete(ext);
      } else {
        next.add(ext);
      }

      return next;
    });
  };

  const shouldShowExtensionTags = folderSearchType === 'content' && !isSearchingFolder && !folderSearchError && folderSearchQuery.trim() && extensionTagOptions.length > 0;

  useEffect(() => {
    const searchKey = `${folderSearchType}
${folderSearchQuery.trim()}
${searchTargetProject.path || ''}`;
    const shouldRestoreScroll = previousResultSearchKeyRef.current === searchKey;

    previousResultSearchKeyRef.current = searchKey;

    window.requestAnimationFrame(() => {
      const scrollbar = resultScrollbarRef.current;

      if (!scrollbar) return;

      if (shouldRestoreScroll) {
        scrollbar.setScrollTop(resultScrollTopRef.current);
      } else {
        resultScrollTopRef.current = 0;
        scrollbar.setScrollTop(0);
      }
    });
  }, [folderSearchResults, fileNameSearchResults, folderSearchQuery, folderSearchType, searchTargetProject.path]);

  return (
    <div className={styles['search-view-wrapper']}>
      <div className={styles['search-header']}>
        <div className={styles['search-header-top']}>
          <div className={styles['search-header-title-box']}>
            <button
              className={`${styles['action-btn-icon']} ${styles['search-back-btn']} ${isLockedFocusView ? styles['search-back-btn-locked'] : ''}`}
              onClick={handleBack}
              title={isLockedFocusView ? '退出锁定模式下的专注模式' : '返回上一层'}
            >
              <span className={`codicon ${isLockedFocusView ? 'codicon-lock' : 'codicon-arrow-left'} ${styles['search-back-icon']}`}></span>
            </button>

            <span
              className={`${styles['search-target-title']} ${focusMode ? styles['search-target-title-focus'] : ''} ${isLockedFocusView ? styles['search-target-title-locked'] : ''}`}
              title={focusMode ? (isLockedFocusView ? `${getSearchTargetTitle()} · 已锁定，下次打开该项目会自动进入专注模式` : `${getSearchTargetTitle()} · 双击进入锁定模式`) : getSearchTargetTitle()}
              onDoubleClick={handleSearchTitleDoubleClick}
            >
              {(() => {
                const projectName = searchTargetProject.projectName || '';
                const currentName = searchTargetProject.name || '';
                const title = searchTargetProject.customName || searchTargetProject.originalName || currentName || projectName;
                const shouldShowSubTitle = projectName && currentName && projectName !== currentName;

                return (
                  <>
                    {shouldShowSubTitle ? projectName : title}
                    {shouldShowSubTitle && <span className={styles['search-target-subtitle']}>/ {currentName}</span>}
                    {focusMode && <span className={styles['search-target-subtitle']}>{focusLocked ? ' · 锁定模式 · 专注模式' : ' · 专注模式'}</span>}
                  </>
                );
              })()}
            </span>
          </div>

          {folderSearchType === 'content' && (
            <div className={styles['search-nav-btns']}>
              <button className={`${styles['action-btn-icon']} ${styles['search-nav-btn']}`} onClick={handlePrevEffectiveSearchMatch} disabled={effectiveTotalMatches === 0} title="上一个匹配项">
                <span className={`codicon codicon-arrow-up ${styles['search-nav-icon']}`}></span>
              </button>

              <button className={`${styles['action-btn-icon']} ${styles['search-nav-btn']}`} onClick={handleNextEffectiveSearchMatch} disabled={effectiveTotalMatches === 0} title="下一个匹配项">
                <span className={`codicon codicon-arrow-down ${styles['search-nav-icon']}`}></span>
              </button>
            </div>
          )}
        </div>

        <div className={`${styles['search-box']} ${styles['search-box-compact']}`}>
          <span
            className={`codicon ${folderSearchType === 'content' ? 'codicon-output' : 'codicon-library'} ${styles['search-type-icon']}`}
            onClick={handleToggleSearchType}
            title={
              folderSearchType === 'content'
                ? '当前：文件内容检索。点击切换为「文件名/文件夹」检索。快捷键：Ctrl/Cmd + Enter'
                : '当前：文件名/文件夹检索。点击切换为「文件内容」检索。快捷键：Ctrl/Cmd + Enter'
            }
          ></span>

          <input
            autoFocus
            className={styles['search-input-compact']}
            placeholder={folderSearchType === 'content' ? '输入关键字自动检索文件内容...' : '输入文件名 / 文件夹名 / 路径片段，支持模糊搜索...'}
            value={folderSearchQuery}
            onChange={(e) => setFolderSearchQuery(e.target.value)}
            onKeyDown={handleSearchInputKeyDown}
            title={
              folderSearchType === 'content'
                ? '快捷键：Ctrl/Cmd + Enter 切换文件名搜索；Ctrl/Cmd + Shift + F 进入文件名搜索，切换时清空关键词'
                : '快捷键：Ctrl/Cmd + Enter 切换内容搜索；Ctrl/Cmd + Shift + C 进入内容搜索，切换时清空关键词'
            }
          />

          {folderSearchQuery && (
            <button
              className={`${styles['action-btn-icon']} ${styles['search-clear-btn'] || ''}`}
              style={{
                marginLeft: 4,
                flex: '0 0 auto',
              }}
              onClick={() => {
                resetSearchData();
                setCurrentActiveMatch(0);
              }}
              title="清除搜索内容"
              type="button"
            >
              <span className="codicon codicon-close"></span>
            </button>
          )}

          {folderSearchType === 'content' && (
            <span className={styles['search-match-count']}>
              {effectiveTotalMatches > 0 ? effectiveCurrentActiveMatch + 1 : 0} / {effectiveTotalMatches}
            </span>
          )}
        </div>

        {shouldShowExtensionTags && (
          <Scrollbar className={styles['search-extension-tags']} viewClassName={styles['search-extension-tags-view']} direction="horizontal" barSize={4}>
            {extensionTagOptions.map((item) => {
              const checked = activeExtensionTags.has(item.ext);

              return (
                <button
                  key={item.ext}
                  type="button"
                  className={`${styles['search-extension-tag']} ${checked ? styles['active'] : ''}`}
                  style={
                    {
                      '--search-extension-tag-color': getExtensionTagColor(item.ext),
                    } as React.CSSProperties
                  }
                  onClick={() => handleToggleExtensionTag(item.ext)}
                  title={checked ? `点击隐藏 ${item.ext} 文件结果` : `点击显示 ${item.ext} 文件结果`}
                >
                  <span className={styles['search-extension-tag-name']}>{item.ext}</span>
                  <span className={styles['search-extension-tag-count']}>{item.count}</span>
                </button>
              );
            })}
          </Scrollbar>
        )}
      </div>

      <Scrollbar
        ref={resultScrollbarRef}
        className={styles['search-results-container']}
        viewClassName={styles['search-results-view']}
        onScroll={({ scrollTop }) => {
          if (!isSearchingFolder) {
            resultScrollTopRef.current = scrollTop;
          }
        }}
      >
        {focusMode && !folderSearchQuery.trim() ? (
          focusTree || <div className={styles['search-empty-msg']}>当前项目没有文件或文件夹</div>
        ) : isSearchingFolder ? (
          <div className={styles['search-status-msg']}>
            <FontAwesomeIcon icon={faSpinner} spin /> 正在高速检索中...
          </div>
        ) : folderSearchError ? (
          <div className={styles['search-error-msg']}>{folderSearchError}</div>
        ) : folderSearchType === 'content' ? (
          folderSearchResults.length === 0 && folderSearchQuery ? (
            <div className={styles['search-empty-msg']}>没有找到符合条件的代码内容</div>
          ) : filteredContentResults.length === 0 && folderSearchResults.length > 0 ? (
            <div className={styles['search-empty-msg']}>没有找到符合当前文件格式筛选的结果</div>
          ) : (
            <ul>
              {filteredContentResults.map(({ result: res, originalIndex }) => {
                const fileDisplayInfo = getSearchResultFileDisplayInfo(res.file || res.fullPath || '');
                const fileTitle = fileDisplayInfo.folderPath
                  ? `${fileDisplayInfo.fileName} ${fileDisplayInfo.folderPath}`
                  : fileDisplayInfo.fileName;

                return (
                  <li key={`${originalIndex}-${res.fullPath || res.file}`} className={styles['search-file-list-item']}>
                    <Tooltip content={res.file} placement="bottom" textAlign="left" delay={2000}>
                      <div className={styles['search-file-title']} title={res.file}>
                        <FileIcon fileName={fileDisplayInfo.fileName} status={res.status} className={styles['search-file-icon']} />

                        <span className={`${styles['search-file-name']} ${getFileStatusClassName(res.status)}`} title={fileTitle}>
                          {fileDisplayInfo.fileName}
                        </span>

                        {fileDisplayInfo.folderPath && (
                          <span className={styles['search-file-folder']} title={fileDisplayInfo.folderPath}>
                            {fileDisplayInfo.folderPath}
                          </span>
                        )}
                      </div>
                    </Tooltip>

                    <ul className={styles['search-matches-list']}>
                      {res.matches.map((m: SearchMatch, j: number) => {
                      const globalStartIndex = lineStartIndexMap.get(`${originalIndex}-${j}`) || 0;
                      const matchInfo = flatMatchesList[currentActiveMatch];
                      const isLineActive = matchInfo && matchInfo.fileIndex === originalIndex && matchInfo.matchIndex === j;
                      const previewText = getContentSearchPreviewText(m.text, folderSearchQuery);

                      return (
                        <li
                          key={j}
                          id={`search-line-${originalIndex}-${j}`}
                          onClick={() => {
                            setCurrentActiveMatch(globalStartIndex);

                            const targetProjectName = getTargetProjectName();
                            const targetPath = res.fullPath;

                            if (targetPath.toLowerCase().endsWith('.md')) {
                              vscode.postMessage({
                                type: 'previewWithVditor',
                                fsPath: targetPath,
                                projectName: targetProjectName,
                                isActiveProject: searchTargetProject.isActiveProject,
                                line: m.line,
                              });
                            } else {
                              vscode.postMessage({
                                type: 'openFileAtLine',
                                fsPath: targetPath,
                                line: m.line,
                                isActiveProject: searchTargetProject.isActiveProject,
                                projectName: targetProjectName,
                              });
                            }
                          }}
                          className={`${styles['search-match-item']} ${isLineActive ? styles['active'] : ''}`}
                        >
                          <span className={styles['search-match-line-num']}>{m.line}</span>

                          <span className={styles['search-match-text']} title={m.text}>
                            <HighlightText text={previewText} query={folderSearchQuery} globalStartIndex={globalStartIndex} currentActiveMatch={currentActiveMatch} isLineActive={!!isLineActive} />
                          </span>
                        </li>
                      );
                      })}
                    </ul>
                  </li>
                );
              })}
            </ul>
          )
        ) : fileNameSearchResults.length === 0 && folderSearchQuery ? (
          <div className={styles['search-empty-msg']}>没有找到匹配的文件或文件夹</div>
        ) : (
          <ul>
            {fileNameSearchResults.map((child) => {
              const childPath = child.path;
              const isExpanded = expandedPaths.has(childPath);
              const isRemote = childPath.startsWith('vscode-vfs') || childPath.startsWith('http');
              const targetProjName = getTargetProjectName();
              const statusClassName = getFileStatusClassName(child.status);

              if (child.isFolder) {
                return (
                  <li key={childPath} className={styles['search-name-list-item']}>
                    <Tooltip content={formatSearchNameTooltipPath(childPath)} placement="bottom" textAlign="left" delay={2000}>
                      <div
                        className={`${styles['sub-item']} ${styles['clickable-sub']} ${selectedPath === childPath ? styles['selected'] : ''} ${styles['search-name-sub-item']}`}
                        onClick={(e) => handleToggleExpand(childPath, targetProjName, isRemote, e)}
                      >
                        <div className={styles['tree-chevron']}>
                          <FontAwesomeIcon icon={isExpanded ? faChevronDown : faChevronRight} className={styles['chevron-icon']} />
                        </div>

                        <FontAwesomeIcon icon={isExpanded ? faFolderOpen : faFolder} className={`${styles['icon-closed']} ${styles['sub-icon']}`} />

                        <span className={`${styles['sub-name']} ${statusClassName}`} title={child.status ? `${child.name} [${child.status}]` : child.name}>
                          {renderSearchNameHighlightText(child.name, folderSearchQuery)}
                        </span>
                      </div>
                    </Tooltip>

                    {isExpanded && (
                      <div className={`${styles['tree-children']} ${styles['search-name-tree-children']}`}>
                        {renderTreeChildren(childPath, targetProjName, searchTargetProject.isActiveProject, folderSearchQuery)}
                      </div>
                    )}
                  </li>
                );
              }

              return (
                <li key={childPath} className={styles['search-name-list-item']}>
                  <Tooltip content={formatSearchNameTooltipPath(childPath)} placement="bottom" textAlign="left" delay={2000}>
                    <div
                      className={`${styles['sub-item']} ${selectedPath === childPath ? styles['selected'] : ''} ${styles['search-name-sub-item-clickable']}`}
                      onClick={(e) => handleOpenFile(childPath, targetProjName, !!searchTargetProject.isActiveProject, e)}
                    >
                      <div className={styles['chevron-placeholder']}></div>

                      <FileIcon fileName={child.name} status={child.status} className={styles['sub-icon']} />

                      <span className={`${styles['sub-name']} ${statusClassName}`} title={child.status ? `${child.name} [${child.status}]` : child.name}>
                        {renderSearchNameHighlightText(child.name, folderSearchQuery)}
                      </span>
                    </div>
                  </Tooltip>
                </li>
              );
            })}
          </ul>
        )}
      </Scrollbar>
    </div>
  );
}
