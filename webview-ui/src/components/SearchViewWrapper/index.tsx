import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
    faChevronDown,
    faChevronRight,
    faFolder,
    faSpinner,
} from '@fortawesome/free-solid-svg-icons';

import { vscode } from '../../utils/vscode';
import FileIcon from '../FileIcon';
import HighlightText from '../HighlightText';
import Tooltip from '../Tooltip';
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

export default function SearchViewWrapper(props: SearchViewWrapperProps) {
    const {
        searchTargetProject,

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

    const resetSearchData = () => {
        setFolderSearchQuery('');
        setFolderSearchResults([]);
        setFileNameSearchResults([]);
        setFolderSearchError('');
    };

    const handleToggleSearchType = () => {
        const newType = folderSearchType === 'content' ? 'name' : 'content';
        setFolderSearchType(newType);
        resetSearchData();
    };

    const getSearchTargetTitle = () => {
        if (searchTargetProject.projectName) {
            return `${searchTargetProject.projectName} / ${searchTargetProject.name}`;
        }

        return (
            searchTargetProject.customName ||
            searchTargetProject.originalName ||
            searchTargetProject.name ||
            ''
        );
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

    return (
        <div className={styles['search-view-wrapper']}>
            <div className={styles['search-header']}>
                <div className={styles['search-header-top']}>
                    <div className={styles['search-header-title-box']}>
                        <button
                            className={`${styles['action-btn-icon']} ${styles['search-back-btn']}`}
                            onClick={() => setIsSearchMode(false)}
                            title="返回项目列表"
                        >
                            <span className={`codicon codicon-arrow-small-left ${styles['search-back-icon']}`}></span>
                        </button>

                        <span
                            className={styles['search-target-title']}
                            title={getSearchTargetTitle()}
                        >
                            {searchTargetProject.projectName ? (
                                <>
                                    {searchTargetProject.projectName}
                                    <span className={styles['search-target-subtitle']}>
                                        / {searchTargetProject.name}
                                    </span>
                                </>
                            ) : (
                                searchTargetProject.customName ||
                                searchTargetProject.originalName ||
                                searchTargetProject.name
                            )}
                        </span>
                    </div>

                    {folderSearchType === 'content' && (
                        <div className={styles['search-nav-btns']}>
                            <button
                                className={`${styles['action-btn-icon']} ${styles['search-nav-btn']}`}
                                onClick={handlePrevSearchMatch}
                                disabled={totalMatches === 0}
                                title="上一个匹配项"
                            >
                                <span className={`codicon codicon-arrow-small-up ${styles['search-nav-icon']}`}></span>
                            </button>

                            <button
                                className={`${styles['action-btn-icon']} ${styles['search-nav-btn']}`}
                                onClick={handleNextSearchMatch}
                                disabled={totalMatches === 0}
                                title="下一个匹配项"
                            >
                                <span className={`codicon codicon-arrow-small-down ${styles['search-nav-icon']}`}></span>
                            </button>
                        </div>
                    )}
                </div>

                <div className={`${styles['search-box']} ${styles['search-box-compact']}`}>
                    <span
                        className={`codicon ${folderSearchType === 'content' ? 'codicon-file-text' : 'codicon-file'
                            } ${styles['search-type-icon']}`}
                        onClick={handleToggleSearchType}
                        title={
                            folderSearchType === 'content'
                                ? '当前：文件内容检索。点击切换为「文件名/文件夹」检索'
                                : '当前：文件名/文件夹检索。点击切换为「文件内容」检索'
                        }
                    ></span>

                    <input
                        autoFocus
                        className={styles['search-input-compact']}
                        placeholder={
                            folderSearchType === 'content'
                                ? '输入关键字自动检索文件内容...'
                                : '输入关键字自动检索文件或文件夹名称...'
                        }
                        value={folderSearchQuery}
                        onChange={(e) => setFolderSearchQuery(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Backspace' && folderSearchQuery === '') {
                                setIsSearchMode(false);
                            }
                        }}
                    />

                    {folderSearchType === 'content' && (
                        <span className={styles['search-match-count']}>
                            {totalMatches > 0 ? currentActiveMatch + 1 : 0} / {totalMatches}
                        </span>
                    )}
                </div>
            </div>

            <div className={styles['search-results-container']}>
                {isSearchingFolder ? (
                    <div className={styles['search-status-msg']}>
                        <FontAwesomeIcon icon={faSpinner} spin /> 正在高速检索中...
                    </div>
                ) : folderSearchError ? (
                    <div className={styles['search-error-msg']}>{folderSearchError}</div>
                ) : folderSearchType === 'content' ? (
                    folderSearchResults.length === 0 && folderSearchQuery ? (
                        <div className={styles['search-empty-msg']}>没有找到符合条件的代码内容</div>
                    ) : (
                        <ul>
                            {folderSearchResults.map((res, i) => (
                                <li key={i} className={styles['search-file-list-item']}>
                                    <Tooltip content={res.file} placement="bottom" textAlign="center">
                                        <div className={styles['search-file-title']} title={res.file}>
                                            <FileIcon fileName={res.file} status={res.status} className={styles['search-file-icon']} />
                                            <span className={getFileStatusClassName(res.status)}>{res.file}</span>
                                        </div>
                                    </Tooltip>

                                    <ul className={styles['search-matches-list']}>
                                        {res.matches.map((m: SearchMatch, j: number) => {
                                            const globalStartIndex = lineStartIndexMap.get(`${i}-${j}`) || 0;
                                            const matchInfo = flatMatchesList[currentActiveMatch];
                                            const isLineActive =
                                                matchInfo &&
                                                matchInfo.fileIndex === i &&
                                                matchInfo.matchIndex === j;

                                            return (
                                                <li
                                                    key={j}
                                                    id={`search-line-${i}-${j}`}
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
                                                icon={faFolder}
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
            </div>
        </div>
    );
}
