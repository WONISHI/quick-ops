import React, { useEffect, useMemo, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
    faChevronDown,
    faChevronRight,
    faFolder,
    faFolderOpen,
    faSpinner,
} from '@fortawesome/free-solid-svg-icons';

import { vscode } from '../../utils/vscode';
import FileIcon from '../FileIcon';
import HighlightText from '../HighlightText';
import Tooltip from '../Tooltip';
import Scrollbar from '../Scrollbar';
import type {
    ContextMenuPayload,
    DirChild,
    SearchMatch,
    SearchResult,
} from '../../types/RecentProjectsApp';

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
    focusTree?: React.ReactNode;
    onBack?: () => void;

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

    handleToggleExpand: (
        path: string,
        projectName: string,
        isRemote: boolean,
        e: React.MouseEvent
    ) => void;

    handleOpenFile: (
        path: string,
        projectName: string,
        isActiveProject: boolean,
        e: React.MouseEvent
    ) => void;

    renderTreeChildren: (
        parentPath: string,
        projectName: string,
        isActiveProject?: boolean
    ) => React.ReactNode;
}

interface ExtensionTagOption {
    ext: string;
    count: number;
}

const EXTENSION_TAG_PRIORITY = [
    'js',
    'ts',
    'json',
    'jsx',
    'tsx',
    'vue',
    'css',
    'scss',
    'less',
    'html',
    'htm',
    'md',
    'mdx',
    'yml',
    'yaml',
    'xml',
    'svg',
    'png',
    'jpg',
    'jpeg',
    'webp',
    'gif',
    'txt',
];

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

const EXTENSION_TAG_FALLBACK_COLORS = [
    '#007acc',
    '#4ec9b0',
    '#c586c0',
    '#dcdcaa',
    '#ce9178',
    '#9cdcfe',
    '#b5cea8',
    '#d7ba7d',
];

function getFileExtensionTag(fileName: string) {
    const purePath = String(fileName || '').split('?')[0].replace(/\\/g, '/');
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

export default function SearchViewWrapper(props: SearchViewWrapperProps) {
    const {
        searchTargetProject,
        focusMode,
        focusTree,
        onBack,

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
        if (onBack) {
            onBack();
        } else {
            setIsSearchMode(false);
        }
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
        const value = e.currentTarget.value;
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

        if ((e.key === 'Backspace' || e.key === 'Delete') && value === '') {
            e.preventDefault();
            handleBack();
        }
    };

    const getSearchTargetTitle = () => {
        const projectName = searchTargetProject.projectName || '';
        const currentName = searchTargetProject.name || '';
        const title =
            searchTargetProject.customName ||
            searchTargetProject.originalName ||
            currentName ||
            projectName ||
            '';

        if (projectName && currentName && projectName !== currentName) {
            return `${projectName} / ${currentName}`;
        }

        return title;
    };

    const getTargetProjectName = () => {
        return (
            searchTargetProject.projectName ||
            searchTargetProject.name ||
            searchTargetProject.originalName ||
            ''
        );
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

    const extensionTagKey = useMemo(() => {
        return extensionTagOptions.map((item) => `${item.ext}:${item.count}`).join('|');
    }, [extensionTagOptions]);

    useEffect(() => {
        if (folderSearchType !== 'content' || isSearchingFolder || folderSearchError) {
            setActiveExtensionTags(new Set());
            return;
        }

        setActiveExtensionTags(new Set(extensionTagOptions.map((item) => item.ext)));
    }, [extensionTagKey, folderSearchType, folderSearchError, isSearchingFolder]);

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

        return folderSearchResults
            .map((result, originalIndex) => ({ result, originalIndex }))
            .filter(({ result }) => activeExtensionTags.has(getFileExtensionTag(result.file || result.fullPath || '')));
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

    const effectiveTotalMatches = folderSearchType === 'content' && extensionTagOptions.length > 0
        ? filteredFlatMatchesList.length
        : totalMatches;

    const effectiveCurrentActiveMatch = folderSearchType === 'content' && extensionTagOptions.length > 0
        ? Math.max(0, filteredCurrentActiveIndex)
        : currentActiveMatch;

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

        setCurrentActiveMatch(filteredFlatMatchesList[0].actualIndex);
    }, [
        extensionTagOptions.length,
        filteredCurrentActiveIndex,
        filteredFlatMatchesList,
        folderSearchType,
        setCurrentActiveMatch,
    ]);

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

    const shouldShowExtensionTags =
        folderSearchType === 'content' &&
        !isSearchingFolder &&
        !folderSearchError &&
        folderSearchQuery.trim() &&
        extensionTagOptions.length > 0;

    return (
        <div className={styles['search-view-wrapper']}>
            <div className={styles['search-header']}>
                <div className={styles['search-header-top']}>
                    <div className={styles['search-header-title-box']}>
                        <button
                            className={`${styles['action-btn-icon']} ${styles['search-back-btn']}`}
                            onClick={handleBack}
                            title="返回项目列表"
                        >
                            <span className={`codicon codicon-arrow-left ${styles['search-back-icon']}`}></span>
                        </button>

                        <span
                            className={styles['search-target-title']}
                            title={getSearchTargetTitle()}
                        >
                            {(() => {
                                const projectName = searchTargetProject.projectName || '';
                                const currentName = searchTargetProject.name || '';
                                const title =
                                    searchTargetProject.customName ||
                                    searchTargetProject.originalName ||
                                    currentName ||
                                    projectName;
                                const shouldShowSubTitle = projectName && currentName && projectName !== currentName;

                                return (
                                    <>
                                        {shouldShowSubTitle ? projectName : title}
                                        {shouldShowSubTitle && (
                                            <span className={styles['search-target-subtitle']}>
                                                / {currentName}
                                            </span>
                                        )}
                                        {focusMode && (
                                            <span className={styles['search-target-subtitle']}> · 专注模式</span>
                                        )}
                                    </>
                                );
                            })()}
                        </span>
                    </div>

                    {folderSearchType === 'content' && (
                        <div className={styles['search-nav-btns']}>
                            <button
                                className={`${styles['action-btn-icon']} ${styles['search-nav-btn']}`}
                                onClick={handlePrevEffectiveSearchMatch}
                                disabled={effectiveTotalMatches === 0}
                                title="上一个匹配项"
                            >
                                <span className={`codicon codicon-arrow-up ${styles['search-nav-icon']}`}></span>
                            </button>

                            <button
                                className={`${styles['action-btn-icon']} ${styles['search-nav-btn']}`}
                                onClick={handleNextEffectiveSearchMatch}
                                disabled={effectiveTotalMatches === 0}
                                title="下一个匹配项"
                            >
                                <span className={`codicon codicon-arrow-down ${styles['search-nav-icon']}`}></span>
                            </button>
                        </div>
                    )}
                </div>

                <div className={`${styles['search-box']} ${styles['search-box-compact']}`}>
                    <span
                        className={`codicon ${folderSearchType === 'content' ? 'codicon-output' : 'codicon-library'
                            } ${styles['search-type-icon']}`}
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
                        placeholder={
                            folderSearchType === 'content'
                                ? '输入关键字自动检索文件内容...'
                                : '输入文件名 / 文件夹名 / 路径片段，支持模糊搜索...'
                        }
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
                    <Scrollbar
                        className={styles['search-extension-tags']}
                        viewClassName={styles['search-extension-tags-view']}
                        direction="horizontal"
                        barSize={4}
                    >
                        {extensionTagOptions.map((item) => {
                            const checked = activeExtensionTags.has(item.ext);

                            return (
                                <button
                                    key={item.ext}
                                    type="button"
                                    className={`${styles['search-extension-tag']} ${checked ? styles['active'] : ''}`}
                                    style={{
                                        '--search-extension-tag-color': getExtensionTagColor(item.ext),
                                    } as React.CSSProperties}
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
                className={styles['search-results-container']}
                viewClassName={styles['search-results-view']}
            >
                {focusMode && !folderSearchQuery.trim() ? (
                    focusTree || (
                        <div className={styles['search-empty-msg']}>
                            当前项目没有文件或文件夹
                        </div>
                    )
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
                            {filteredContentResults.map(({ result: res, originalIndex }) => (
                                <li key={`${originalIndex}-${res.fullPath || res.file}`} className={styles['search-file-list-item']}>
                                    <Tooltip content={res.file} placement="bottom" textAlign="left">
                                        <div className={styles['search-file-title']} title={res.file}>
                                            <FileIcon fileName={res.file} status={res.status} className={styles['search-file-icon']} />
                                            <span className={getFileStatusClassName(res.status)}>{res.file}</span>
                                        </div>
                                    </Tooltip>

                                    <ul className={styles['search-matches-list']}>
                                        {res.matches.map((m: SearchMatch, j: number) => {
                                            const globalStartIndex = lineStartIndexMap.get(`${originalIndex}-${j}`) || 0;
                                            const matchInfo = flatMatchesList[currentActiveMatch];
                                            const isLineActive =
                                                matchInfo &&
                                                matchInfo.fileIndex === originalIndex &&
                                                matchInfo.matchIndex === j;

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
                                                    className={`${styles['search-match-item']} ${isLineActive ? styles['active'] : ''
                                                        }`}
                                                >
                                                    <span className={styles['search-match-line-num']}>
                                                        {m.line}
                                                    </span>

                                                    <HighlightText
                                                        text={m.text}
                                                        query={folderSearchQuery}
                                                        globalStartIndex={globalStartIndex}
                                                        currentActiveMatch={currentActiveMatch}
                                                        isLineActive={!!isLineActive}
                                                    />
                                                </li>
                                            );
                                        })}
                                    </ul>
                                </li>
                            ))}
                        </ul>
                    )
                ) : fileNameSearchResults.length === 0 && folderSearchQuery ? (
                    <div className={styles['search-empty-msg']}>没有找到匹配的文件或文件夹</div>
                ) : (
                    <ul>
                        {fileNameSearchResults.map((child) => {
                            const childPath = child.path;
                            const isExpanded = expandedPaths.has(childPath);
                            const isRemote =
                                childPath.startsWith('vscode-vfs') || childPath.startsWith('http');
                            const targetProjName = getTargetProjectName();
                            const statusClassName = getFileStatusClassName(child.status);

                            if (child.isFolder) {
                                return (
                                    <li key={childPath} className={styles['search-name-list-item']}>
                                        <div
                                            className={`${styles['sub-item']} ${styles['clickable-sub']} ${selectedPath === childPath ? styles['selected'] : ''
                                                } ${styles['search-name-sub-item']}`}
                                            onClick={(e) =>
                                                handleToggleExpand(childPath, targetProjName, isRemote, e)
                                            }
                                        >
                                            <div className={styles['tree-chevron']}>
                                                <FontAwesomeIcon
                                                    icon={isExpanded ? faChevronDown : faChevronRight}
                                                    className={styles['chevron-icon']}
                                                />
                                            </div>

                                            <FontAwesomeIcon
                                                icon={isExpanded ? faFolderOpen : faFolder}
                                                className={`${styles['icon-closed']} ${styles['sub-icon']}`}
                                            />

                                            <span
                                                className={`${styles['sub-name']} ${statusClassName}`}
                                                title={child.status ? `${child.name} [${child.status}]` : child.name}
                                            >
                                                <HighlightText
                                                    text={child.name}
                                                    query={folderSearchQuery}
                                                    globalStartIndex={-2}
                                                    currentActiveMatch={-1}
                                                    isLineActive={false}
                                                />
                                            </span>
                                        </div>

                                        {isExpanded && (
                                            <div
                                                className={`${styles['tree-children']} ${styles['search-name-tree-children']}`}
                                            >
                                                {renderTreeChildren(
                                                    childPath,
                                                    targetProjName,
                                                    searchTargetProject.isActiveProject
                                                )}
                                            </div>
                                        )}
                                    </li>
                                );
                            }

                            return (
                                <li key={childPath} className={styles['search-name-list-item']}>
                                    <div
                                        className={`${styles['sub-item']} ${selectedPath === childPath ? styles['selected'] : ''
                                            } ${styles['search-name-sub-item-clickable']}`}
                                        onClick={(e) =>
                                            handleOpenFile(
                                                childPath,
                                                targetProjName,
                                                !!searchTargetProject.isActiveProject,
                                                e
                                            )
                                        }
                                    >
                                        <div className={styles['chevron-placeholder']}></div>

                                        <FileIcon fileName={child.name} status={child.status} className={styles['sub-icon']} />

                                        <span
                                            className={`${styles['sub-name']} ${statusClassName}`}
                                            title={child.status ? `${child.name} [${child.status}]` : child.name}
                                        >
                                            <HighlightText
                                                text={child.name}
                                                query={folderSearchQuery}
                                                globalStartIndex={-2}
                                                currentActiveMatch={-1}
                                                isLineActive={false}
                                            />
                                        </span>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </Scrollbar>
        </div>
    );
}
