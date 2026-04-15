import React, { useState, useEffect, useRef } from 'react';
import { vscode } from '../utils/vscode';
import styles from '../assets/css/GitApp.module.css';

import '@vscode/codicons/dist/codicon.css';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faImage, faCode, faFile } from '@fortawesome/free-solid-svg-icons';
import { faMarkdown, faHtml5, faCss3Alt, faVuejs, faJs } from '@fortawesome/free-brands-svg-icons';

import Tooltip from '../components/Tooltip';
import GitGraph, { type GraphCommit } from '../components/GitGraph';
import GitCompareList from '../components/GitCompareList'; 

export interface GitFile { status: string; file: string; }
interface TreeNode { name: string; fullPath: string; isDirectory: boolean; children: TreeNode[]; file?: GitFile; }

function buildTree(files: GitFile[]): TreeNode[] {
    const root: TreeNode[] = [];
    files.forEach(f => {
        const parts = f.file.split('/');
        let currentLevel = root, currentPath = '';
        parts.forEach((part, index) => {
            const isFile = index === parts.length - 1;
            currentPath = currentPath ? `${currentPath}/${part}` : part;
            let existingNode = currentLevel.find(n => n.name === part);
            if (!existingNode) {
                existingNode = { name: part, fullPath: currentPath, isDirectory: !isFile, children: [], file: isFile ? f : undefined };
                currentLevel.push(existingNode);
            }
            currentLevel = existingNode.children;
        });
    });
    const compressTree = (nodes: TreeNode[]) => {
        nodes.forEach(node => {
            if (node.isDirectory) {
                while (node.children.length === 1 && node.children[0].isDirectory) {
                    const child = node.children[0];
                    node.name = `${node.name}/${child.name}`;
                    node.children = child.children;
                }
                compressTree(node.children);
            }
        });
    };
    compressTree(root);
    const sortTree = (nodes: TreeNode[]) => {
        nodes.sort((a, b) => {
            if (a.isDirectory && !b.isDirectory) return -1;
            if (!a.isDirectory && b.isDirectory) return 1;
            return a.name.localeCompare(b.name);
        });
        nodes.forEach(n => { if (n.isDirectory) sortTree(n.children); });
    };
    sortTree(root);
    return root;
}

export default function GitApp() {
    // 🌟 新增状态：控制是否为一个有效的 Git 仓库
    const [isRepo, setIsRepo] = useState<boolean>(true);
    const [isGitInstalled, setIsGitInstalled] = useState<boolean | null>(null);

    const [stagedFiles, setStagedFiles] = useState<GitFile[]>([]);
    const [unstagedFiles, setUnstagedFiles] = useState<GitFile[]>([]);
    const [branch, setBranch] = useState('');
    const [commitMsg, setCommitMsg] = useState('');
    const [loading, setLoading] = useState(false);
    const [activeFile, setActiveFile] = useState<string | null>(null);

    const [isChangesOpen, setIsChangesOpen] = useState(true);
    const [isGraphOpen, setIsGraphOpen] = useState(true);
    const [isGraphSearchOpen, setIsGraphSearchOpen] = useState(false);

    const [justCommitted, setJustCommitted] = useState(false);

    const [graphCommits, setGraphCommits] = useState<GraphCommit[]>([]);
    const [isGraphLoading, setIsGraphLoading] = useState(true);
    const [remoteUrl, setRemoteUrl] = useState<string>('');

    const [viewMode, setViewMode] = useState<'list' | 'tree'>('list');
    const [expandedDirs, setExpandedDirs] = useState<Record<string, boolean>>({});

    const [displayCount, setDisplayCount] = useState(100);

    const [activeCommitHash, setActiveCommitHash] = useState<string | null>(null);
    const [loadedCommitHash, setLoadedCommitHash] = useState<string | null>(null);
    const [activeCommitParentHash, setActiveCommitParentHash] = useState<string | undefined>();
    const [commitFiles, setCommitFiles] = useState<GitFile[]>([]);
    const [commitFilesLoading, setCommitFilesLoading] = useState(false);

    const [compareTarget, setCompareTarget] = useState<string | null>(null);
    const [compareBase, setCompareBase] = useState<string | null>(null);
    const [compareCommits, setCompareCommits] = useState<GraphCommit[]>([]);
    const [isCompareOpen, setIsCompareOpen] = useState(false);

    const [skipVerify, setSkipVerify] = useState(false);
    const [selectedGraphFilter, setSelectedGraphFilter] = useState('全部分支');
    const filterRef = useRef('全部分支');
    const [flashBranchBtn, setFlashBranchBtn] = useState(false);

    const [contextMenu, setContextMenu] = useState<{ visible: boolean, x: number, y: number, file: GitFile, listType: 'staged' | 'unstaged' | 'history' | 'compare' } | null>(null);

    const lastRefreshRef = useRef<number>(0);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        lastRefreshRef.current = Date.now();
        vscode.postMessage({ command: 'webviewLoaded' });
        const handleMsg = (e: MessageEvent) => {
            const msg = e.data;
            if (msg.type === 'startLoading') {
                setIsGraphLoading(true);
            } else if (msg.type === 'noWorkspace' || msg.type === 'notRepo') {
                // 🌟 核心拦截：如果是空文件夹或非 Git 仓库
                setLoading(false);
                setIsGraphLoading(false);
                setIsRepo(false);
                setBranch(msg.type === 'noWorkspace' ? '无工作区' : '未初始化');
                setStagedFiles([]);
                setUnstagedFiles([]);
                setGraphCommits([]);
                setCompareCommits([]);
            } else if (msg.type === 'statusData') {
                setIsRepo(true);
                setStagedFiles(msg.stagedFiles || []);
                setUnstagedFiles(msg.unstagedFiles || []);
                setBranch(msg.branch || '');
                setRemoteUrl(msg.remoteUrl || '');
                setLoading(false);
            } else if (msg.type === 'graphData') {
                const commits = msg.graphCommits || [];
                setGraphCommits(commits);
                setDisplayCount(100);
                if (msg.graphFilter) {
                    setSelectedGraphFilter(msg.graphFilter);
                    if (filterRef.current !== msg.graphFilter) {
                        setFlashBranchBtn(true);
                        setTimeout(() => setFlashBranchBtn(false), 800);
                        filterRef.current = msg.graphFilter;
                    }
                }
                setIsGraphLoading(false);
            } else if (msg.type === 'commitFilesData') {
                setCommitFiles(msg.files || []);
                setActiveCommitParentHash(msg.parentHash);
                setLoadedCommitHash(msg.hash);
                setCommitFilesLoading(false);
            } else if (msg.type === 'activeEditorChanged') {
                setActiveFile(msg.file);
                if (msg.file) {
                    const parts = msg.file.split('/');
                    parts.pop();
                    if (parts.length > 0) {
                        setExpandedDirs(prev => {
                            const next = { ...prev };
                            let currentPath = '';
                            parts.forEach((p: any) => {
                                currentPath = currentPath ? `${currentPath}/${p}` : p;
                                next[currentPath] = true;
                            });
                            return next;
                        });
                    }
                }
            } else if (msg.type === 'compareData') {
                if (msg.targetBranch && msg.baseBranch) {
                    setCompareTarget(msg.targetBranch);
                    setCompareBase(msg.baseBranch);
                }
                setCompareCommits(msg.commits || []);
                setIsCompareOpen(true);
            } else if (msg.type === 'error') {
                setLoading(false);
                setIsGraphLoading(false);
                setCommitFilesLoading(false);
            } else if (msg.type === 'commitSuccess') {
                setJustCommitted(true);
            } else if (msg.type === 'clearJustCommitted') {
                setJustCommitted(false);
            } else if (msg.type === 'gitInstallationStatus') {
                setIsGitInstalled(msg.isInstalled);
            }
        };
        window.addEventListener('message', handleMsg);

        const triggerSmartRefresh = () => {
            const now = Date.now();
            if (now - lastRefreshRef.current > 5000 && isRepo) { // Only refresh if it's a valid repo
                vscode.postMessage({ command: 'refreshStatusOnly' });
                lastRefreshRef.current = now;
            }
        };

        const handleVisibilityChange = () => { if (document.visibilityState === 'visible') triggerSmartRefresh(); };
        const handleFocus = () => triggerSmartRefresh();

        document.addEventListener('visibilitychange', handleVisibilityChange);
        window.addEventListener('focus', handleFocus);

        const closeContextMenu = () => setContextMenu(null);
        window.addEventListener('click', closeContextMenu);
        window.addEventListener('blur', closeContextMenu);

        return () => {
            window.removeEventListener('message', handleMsg);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            window.removeEventListener('focus', handleFocus);
            window.removeEventListener('click', closeContextMenu);
            window.removeEventListener('blur', closeContextMenu);
        };
    }, [isRepo]);

    const handleCommit = () => {
        if (!commitMsg.trim()) return;
        setLoading(true);
        vscode.postMessage({ command: 'commit', message: commitMsg, skipVerify });
        setCommitMsg('');
        if (textareaRef.current) textareaRef.current.style.height = '28px';
    };

    const toggleCommit = (hash: string) => {
        if (activeCommitHash === hash) {
            setActiveCommitHash(null);
        } else {
            setActiveCommitHash(hash);
            setCommitFilesLoading(true);
            vscode.postMessage({ command: 'getCommitFiles', hash });
        }
    };

    const getStatusClass = (status: string) => {
        if (status.includes('M')) return styles['status-M'];
        if (status.includes('D')) return styles['status-D'];
        return styles['status-A'];
    };

    const getStatusText = (status: string) => {
        if (status.includes('M')) return 'M';
        if (status.includes('D')) return 'D';
        if (status.includes('A')) return 'A';
        return 'U';
    };

    const getFileIcon = (fileName: string) => {
        const ext = fileName.split('.').pop()?.toLowerCase();
        switch (ext) {
            case 'ts': case 'tsx': return <FontAwesomeIcon icon={faJs} className={styles['file-icon']} style={{ color: '#3178c6', marginRight: '6px' }} />;
            case 'js': case 'jsx': return <FontAwesomeIcon icon={faJs} className={styles['file-icon']} style={{ color: '#f1e05a', marginRight: '6px' }} />;
            case 'vue': return <FontAwesomeIcon icon={faVuejs} className={styles['file-icon']} style={{ color: '#41b883', marginRight: '6px' }} />;
            case 'css': case 'less': case 'scss': return <FontAwesomeIcon icon={faCss3Alt} className={styles['file-icon']} style={{ color: '#264de4', marginRight: '6px' }} />;
            case 'html': return <FontAwesomeIcon icon={faHtml5} className={styles['file-icon']} style={{ color: '#e34c26', marginRight: '6px' }} />;
            case 'json': return <FontAwesomeIcon icon={faCode} className={styles['file-icon']} style={{ color: '#cbcb41', marginRight: '6px' }} />;
            case 'md': return <FontAwesomeIcon icon={faMarkdown} className={styles['file-icon']} style={{ color: '#4daafc', marginRight: '6px' }} />;
            case 'png': case 'jpg': case 'svg': return <FontAwesomeIcon icon={faImage} className={styles['file-icon']} style={{ color: '#a074c4', marginRight: '6px' }} />;
            default: return <FontAwesomeIcon icon={faFile} className={styles['file-icon']} style={{ color: 'var(--vscode-descriptionForeground)', marginRight: '6px' }} />;
        }
    };

    const toggleDir = (path: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setExpandedDirs(prev => ({ ...prev, [path]: prev[path] === false ? true : false }));
    };

    const renderTreeNodes = (nodes: TreeNode[], listType: 'staged' | 'unstaged' | 'history' | 'compare', depth = 0): React.ReactNode => {
        return nodes.map(node => {
            if (node.isDirectory) {
                const isOpen = expandedDirs[node.fullPath] !== false;
                return (
                    <React.Fragment key={node.fullPath}>
                        <li className={styles['file-item']} style={{ paddingLeft: `${depth * 12 + 4}px`, cursor: 'pointer' }} onClick={(e) => toggleDir(node.fullPath, e)}>
                            <i className={`codicon ${isOpen ? 'codicon-chevron-down' : 'codicon-chevron-right'}`} style={{ fontSize: '14px', width: '16px', opacity: 0.8, marginRight: '2px' }} />
                            <i className="codicon codicon-folder" style={{ marginRight: '6px', color: 'var(--vscode-icon-foreground)' }} />
                            <div className={styles['file-name']} style={{ opacity: 0.9 }}>{node.name}</div>
                        </li>
                        {isOpen && renderTreeNodes(node.children, listType, depth + 1)}
                    </React.Fragment>
                );
            } else {
                const item = node.file!;
                const parts = item.file.split('/');
                const fileName = parts.pop();
                return (
                    <li key={item.file} className={`${styles['file-item']} ${activeFile === item.file ? styles['active'] : ''}`} style={{ paddingLeft: `${depth * 12 + 24}px` }} title={item.file} onClick={() => {
                        setActiveFile(item.file);
                        if (listType === 'history') {
                            vscode.postMessage({ command: 'diffCommitFile', file: item.file, hash: activeCommitHash, parentHash: activeCommitParentHash, status: item.status });
                        } else if (listType === 'compare') {
                            if (compareTarget && compareBase) {
                                vscode.postMessage({ command: 'diffBranchFile', file: item.file, targetBranch: activeCommitHash || compareTarget, baseBranch: compareBase, status: item.status });
                            }
                        } else {
                            vscode.postMessage({ command: 'diff', file: item.file, status: item.status });
                        }
                    }} onContextMenu={(e) => {
                        e.preventDefault();
                        setActiveFile(item.file);
                        const safeX = Math.min(e.clientX, window.innerWidth - 220);
                        const safeY = Math.min(e.clientY, window.innerHeight - 250);
                        setContextMenu({ visible: true, x: safeX, y: safeY, file: item, listType });
                    }}>
                        {getFileIcon(fileName || '')}
                        <div className={styles['file-name']}>{fileName}</div>
                        <div style={{ flex: 1 }}></div>
                        <div className={styles['file-actions']} onClick={(e) => e.stopPropagation()}>
                            <Tooltip content="打开文件">
                                <button className={styles['action-btn']} onClick={() => vscode.postMessage({ command: 'open', file: item.file })}>
                                    <i className="codicon codicon-go-to-file" />
                                </button>
                            </Tooltip>

                            {listType === 'unstaged' && (
                                <Tooltip content="放弃更改">
                                    <button className={styles['action-btn']} onClick={() => vscode.postMessage({ command: 'discard', file: item.file, status: item.status })}>
                                        <i className="codicon codicon-discard" />
                                    </button>
                                </Tooltip>
                            )}

                            {listType !== 'history' && listType !== 'compare' && (
                                <>
                                    {listType === 'staged' ? (
                                        <Tooltip content="取消暂存更改">
                                            <button className={styles['action-btn']} onClick={() => vscode.postMessage({ command: 'unstage', file: item.file })}>
                                                <i className="codicon codicon-remove" />
                                            </button>
                                        </Tooltip>
                                    ) : (
                                        <Tooltip content="暂存更改">
                                            <button className={styles['action-btn']} onClick={() => vscode.postMessage({ command: 'stage', file: item.file, status: item.status })}>
                                                <i className="codicon codicon-plus" />
                                            </button>
                                        </Tooltip>
                                    )}
                                </>
                            )}
                        </div>
                        <div className={`${styles['status-badge']} ${getStatusClass(item.status)}`}>{getStatusText(item.status)}</div>
                    </li>
                );
            }
        });
    };

    const renderFileList = (files: GitFile[], listType: 'staged' | 'unstaged' | 'history' | 'compare') => {
        if (viewMode === 'tree') {
            const treeNodes = buildTree(files);
            return <ul className={styles['file-list']}>{renderTreeNodes(treeNodes, listType)}</ul>;
        }

        return (
            <ul className={styles['file-list']}>
                {files.map((item, idx) => {
                    const parts = item.file.split('/');
                    const fileName = parts.pop();
                    const dirPath = parts.length > 0 ? parts.join('/') : '';
                    return (
                        <li key={idx} className={`${styles['file-item']} ${activeFile === item.file ? styles['active'] : ''}`} title={item.file} onClick={() => {
                            setActiveFile(item.file);
                            if (listType === 'history') {
                                vscode.postMessage({ command: 'diffCommitFile', file: item.file, hash: activeCommitHash, parentHash: activeCommitParentHash, status: item.status });
                            } else if (listType === 'compare') {
                                if (compareTarget && compareBase) {
                                    vscode.postMessage({ command: 'diffBranchFile', file: item.file, targetBranch: activeCommitHash || compareTarget, baseBranch: compareBase, status: item.status });
                                }
                            } else {
                                vscode.postMessage({ command: 'diff', file: item.file, status: item.status });
                            }
                        }} onContextMenu={(e) => {
                            e.preventDefault();
                            setActiveFile(item.file);
                            const safeX = Math.min(e.clientX, window.innerWidth - 220);
                            const safeY = Math.min(e.clientY, window.innerHeight - 250);
                            setContextMenu({ visible: true, x: safeX, y: safeY, file: item, listType });
                        }}>
                            {getFileIcon(fileName || '')}
                            <div className={styles['file-name']}>{fileName}</div>
                            {dirPath && <div className={styles['file-dir']}>{dirPath}</div>}
                            <div style={{ flex: 1 }}></div>
                            <div className={styles['file-actions']} onClick={(e) => e.stopPropagation()}>
                                <Tooltip content="打开文件">
                                    <button className={styles['action-btn']} onClick={() => vscode.postMessage({ command: 'open', file: item.file })}>
                                        <i className="codicon codicon-go-to-file" />
                                    </button>
                                </Tooltip>

                                {listType === 'unstaged' && (
                                    <Tooltip content="放弃更改">
                                        <button className={styles['action-btn']} onClick={() => vscode.postMessage({ command: 'discard', file: item.file, status: item.status })}>
                                            <i className="codicon codicon-discard" />
                                        </button>
                                    </Tooltip>
                                )}

                                {listType !== 'history' && listType !== 'compare' && (
                                    <>
                                        {listType === 'staged' ? (
                                            <Tooltip content="取消暂存更改">
                                                <button className={styles['action-btn']} onClick={() => vscode.postMessage({ command: 'unstage', file: item.file })}>
                                                    <i className="codicon codicon-remove" />
                                                </button>
                                            </Tooltip>
                                        ) : (
                                            <Tooltip content="暂存更改">
                                                <button className={styles['action-btn']} onClick={() => vscode.postMessage({ command: 'stage', file: item.file, status: item.status })}>
                                                    <i className="codicon codicon-plus" />
                                                </button>
                                            </Tooltip>
                                        )}
                                    </>
                                )}
                            </div>
                            <div className={`${styles['status-badge']} ${getStatusClass(item.status)}`}>{getStatusText(item.status)}</div>
                        </li>
                    );
                })}
            </ul>
        );
    }

    // 检测：如果没有安装 Git，显示安装引导页面
    if (isGitInstalled === false) {
        return (
            <div className={styles['git-sidebar']} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '20px', textAlign: 'center', height: '100vh' }}>
                <i className="codicon codicon-git-merge" style={{ fontSize: '48px', marginBottom: '16px', color: 'var(--vscode-textLink-foreground)', opacity: 0.8 }} />
                <div style={{ fontSize: '15px', marginBottom: '8px', color: 'var(--vscode-editor-foreground)', fontWeight: 600 }}>
                    未检测到 Git 环境
                </div>
                <div style={{ fontSize: '12px', marginBottom: '24px', color: 'var(--vscode-descriptionForeground)', lineHeight: 1.5 }}>
                    当前系统未安装 Git，或环境变量未配置。<br />
                    请安装 Git 后 <span style={{ color: 'var(--vscode-textLink-foreground)' }}>重启 VS Code</span>。
                </div>
                <button
                    className={styles['commit-btn']}
                    onClick={() => vscode.postMessage({ command: 'openExternal', url: 'https://git-scm.com/downloads' })}
                    style={{ width: 'auto', padding: '0 20px', borderRadius: '4px', height: '32px' }}
                >
                    <i className="codicon codicon-cloud-download" style={{ marginRight: '6px' }} />
                    前往官网下载 Git
                </button>
            </div>
        );
    }

    return (
        <div className={styles['git-sidebar']}>

            {contextMenu && contextMenu.visible && (
                <>
                    <div
                        className={styles['context-menu-backdrop']}
                        onClick={() => setContextMenu(null)}
                        onContextMenu={(e) => { e.preventDefault(); setContextMenu(null); }}
                    />
                    <div className={styles['context-menu']} style={{ left: contextMenu.x, top: contextMenu.y }}>

                        <div className={styles['context-menu-item']} onClick={() => {
                            if (contextMenu.listType === 'history') {
                                vscode.postMessage({ command: 'diffCommitFile', file: contextMenu.file.file, hash: activeCommitHash, parentHash: activeCommitParentHash, status: contextMenu.file.status });
                            } else if (contextMenu.listType === 'compare') {
                                if (compareTarget && compareBase) {
                                    vscode.postMessage({ command: 'diffBranchFile', file: contextMenu.file.file, targetBranch: activeCommitHash || compareTarget, baseBranch: compareBase, status: contextMenu.file.status });
                                }
                            } else {
                                vscode.postMessage({ command: 'diff', file: contextMenu.file.file, status: contextMenu.file.status });
                            }
                            setContextMenu(null);
                        }}>
                            <i className={`codicon codicon-git-compare ${styles['context-menu-icon']}`} />
                            <span>打开更改</span>
                        </div>

                        <div className={styles['context-menu-item']} onClick={() => {
                            vscode.postMessage({ command: 'open', file: contextMenu.file.file });
                            setContextMenu(null);
                        }}>
                            <i className={`codicon codicon-go-to-file ${styles['context-menu-icon']}`} />
                            <span>打开文件</span>
                        </div>

                        {contextMenu.listType === 'unstaged' && (
                            <div className={styles['context-menu-item']} onClick={() => {
                                vscode.postMessage({ command: 'discard', file: contextMenu.file.file, status: contextMenu.file.status });
                                setContextMenu(null);
                            }}>
                                <i className={`codicon codicon-discard ${styles['context-menu-icon']}`} />
                                <span>放弃更改</span>
                            </div>
                        )}

                        {contextMenu.listType !== 'history' && contextMenu.listType !== 'compare' && (
                            <div className={styles['context-menu-item']} onClick={() => {
                                if (contextMenu.listType === 'staged') {
                                    vscode.postMessage({ command: 'unstage', file: contextMenu.file.file });
                                } else {
                                    vscode.postMessage({ command: 'stage', file: contextMenu.file.file, status: contextMenu.file.status });
                                }
                                setContextMenu(null);
                            }}>
                                <i className={`codicon ${contextMenu.listType === 'staged' ? 'codicon-remove' : 'codicon-plus'} ${styles['context-menu-icon']}`} />
                                <span>{contextMenu.listType === 'staged' ? '取消暂存更改' : '暂存更改'}</span>
                            </div>
                        )}

                        <div className={styles['context-menu-divider']}></div>

                        <div className={styles['context-menu-item']} onClick={() => {
                            vscode.postMessage({ command: 'ignore', file: contextMenu.file.file });
                            setContextMenu(null);
                        }}>
                            <i className={`codicon codicon-eye-closed ${styles['context-menu-icon']}`} />
                            <span>添加到 .gitignore</span>
                        </div>

                        <div className={styles['context-menu-item']} onClick={() => {
                            vscode.postMessage({ command: 'reveal', file: contextMenu.file.file });
                            setContextMenu(null);
                        }}>
                            <i className={`codicon codicon-folder-opened ${styles['context-menu-icon']}`} />
                            <span>在访达/资源管理器中显示</span>
                        </div>
                    </div>
                </>
            )}

            <div className={styles['git-toolbar']}>
                <span>Git 管理 ({branch})</span>
                <div className={styles['git-actions']}>
                    {/* 🌟 条件渲染：如果不是Repo或没工作区，这里只展示 Clone 按钮 */}
                    {isRepo ? (
                        <>
                            <Tooltip content={!skipVerify ? "校验开启" : "校验关闭"}>
                                <button
                                    className={styles['icon-btn']}
                                    onClick={() => setSkipVerify(!skipVerify)}
                                    style={{ color: !skipVerify ? '#3168d1' : 'inherit' }}
                                >
                                    <i className="codicon codicon-shield" />
                                </button>
                            </Tooltip>
                            <Tooltip content="拉取 (Pull)">
                                <button className={styles['icon-btn']} onClick={() => vscode.postMessage({ command: 'pull' })}>
                                    <i className="codicon codicon-repo-pull" />
                                </button>
                            </Tooltip>
                            <Tooltip content="推送 (Push)">
                                <button className={styles['icon-btn']} onClick={() => vscode.postMessage({ command: 'push' })}>
                                    <i className="codicon codicon-repo-push" />
                                </button>
                            </Tooltip>
                            <Tooltip content={viewMode === 'list' ? '以树状视图查看' : '以列表视图查看'}>
                                <button className={styles['icon-btn']} onClick={() => setViewMode(v => v === 'list' ? 'tree' : 'list')}>
                                    <i className={`codicon ${viewMode === 'list' ? 'codicon-list-tree' : 'codicon-list-flat'}`} />
                                </button>
                            </Tooltip>
                        </>
                    ) : (
                        <Tooltip content="克隆仓库 (Clone)">
                            <button className={styles['icon-btn']} onClick={() => vscode.postMessage({ command: 'clone' })}>
                                <i className="codicon codicon-repo-clone" />
                            </button>
                        </Tooltip>
                    )}
                </div>
            </div>

            <div className={styles['commit-box']}>
                <textarea
                    ref={textareaRef}
                    className={styles['commit-input']}
                    placeholder="消息 (按 Ctrl+Enter 提交)"
                    value={commitMsg}
                    onChange={(e) => {
                        setCommitMsg(e.target.value);
                        e.target.style.height = '28px';
                        e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
                        setJustCommitted(false);
                    }}
                    onKeyDown={(e) => {
                        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') handleCommit();
                    }}
                    style={{
                        resize: 'none',
                        minHeight: '28px',
                        overflowY: 'auto',
                        boxSizing: 'border-box'
                    }}
                    disabled={!isRepo}
                />
                <button className={styles['commit-btn']} disabled={!isRepo || loading || (!commitMsg.trim() || (stagedFiles.length === 0 && unstagedFiles.length === 0))} onClick={handleCommit}>
                    {loading ? <i className="codicon codicon-loading codicon-modifier-spin" style={{ marginRight: '6px' }} /> : <i className="codicon codicon-check" style={{ marginRight: '6px' }} />} 提交 (Commit)
                </button>
            </div>

            <div className={styles['changes-scroll-area']} style={{ maxHeight: 'none', overflowY: 'visible', flexShrink: 0 }}>
                <div className={styles['changes-section']}>

                    <div className={styles['changes-header']} onClick={() => setIsChangesOpen(!isChangesOpen)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <i className={`codicon ${isChangesOpen ? 'codicon-chevron-down' : 'codicon-chevron-right'}`} style={{ fontSize: '14px', width: '16px' }} />
                            更改 <span className={styles['badge']}>{stagedFiles.length + unstagedFiles.length}</span>
                        </div>

                        {/* 🌟 只有有效的仓库才会显示撤销按钮保护区域 */}
                        {isRepo && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                                {justCommitted && (
                                    <Tooltip content="撤销刚刚的提交 (退回工作区)">
                                        <button
                                            className={styles['action-btn']}
                                            onClick={(e) => {
                                                e.stopPropagation(); 
                                                vscode.postMessage({ command: 'undoLastCommit' });
                                                setJustCommitted(false); 
                                            }}
                                            style={{ opacity: 0.8, width: '20px', height: '20px', display: 'flex', justifyContent: 'center' }}
                                        >
                                            <i className="codicon codicon-debug-restart-frame" />
                                        </button>
                                    </Tooltip>
                                )}
                            </div>
                        )}
                    </div>

                    {isChangesOpen && (
                        <div style={{ maxHeight: '30vh', overflowY: 'auto', paddingBottom: '4px' }}>
                            {stagedFiles.length > 0 && (
                                <div className={styles['changes-section']} style={{ marginLeft: '12px' }}>
                                    <div className={styles['changes-header']} style={{ cursor: 'default', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                            <i className="codicon codicon-git-pull-request-done" style={{ fontSize: '14px', width: '16px' }} />
                                            暂存区 <span className={styles['badge']}>{stagedFiles.length}</span>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                                            <Tooltip content="取消暂存所有更改">
                                                <button
                                                    className={styles['action-btn']}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        vscode.postMessage({ command: 'unstageAll' });
                                                    }}
                                                    style={{ opacity: 0.8, width: '20px', height: '20px', display: 'flex', justifyContent: 'center' }}
                                                >
                                                    <i className="codicon codicon-remove" />
                                                </button>
                                            </Tooltip>
                                        </div>
                                    </div>
                                    {renderFileList(stagedFiles, 'staged')}
                                </div>
                            )}

                            <div className={styles['changes-section']} style={{ marginLeft: '12px' }}>
                                <div className={styles['changes-header']} style={{ cursor: 'default', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                        <i className="codicon codicon-git-branch-changes" style={{ fontSize: '14px', width: '16px' }} />
                                        工作区 <span className={styles['badge']}>{unstagedFiles.length}</span>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                                        {unstagedFiles.length > 0 && (
                                            <>
                                                <Tooltip content="放弃所有更改">
                                                    <button
                                                        className={styles['action-btn']}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            if (unstagedFiles.length === 1) {
                                                                vscode.postMessage({ command: 'discard', file: unstagedFiles[0].file, status: unstagedFiles[0].status });
                                                            } else {
                                                                vscode.postMessage({ command: 'discardAll', count: unstagedFiles.length });
                                                            }
                                                        }}
                                                        style={{ opacity: 0.8, width: '20px', height: '20px', display: 'flex', justifyContent: 'center' }}
                                                    >
                                                        <i className="codicon codicon-discard" />
                                                    </button>
                                                </Tooltip>
                                                <Tooltip content="暂存所有更改">
                                                    <button
                                                        className={styles['action-btn']}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            vscode.postMessage({ command: 'stageAll' });
                                                        }}
                                                        style={{ opacity: 0.8, width: '20px', height: '20px', display: 'flex', justifyContent: 'center' }}
                                                    >
                                                        <i className="codicon codicon-plus" />
                                                    </button>
                                                </Tooltip>
                                            </>
                                        )}
                                    </div>
                                </div>
                                {unstagedFiles.length === 0 && stagedFiles.length === 0 ? (
                                    <div className={styles['empty-message']}>{!isRepo ? '在此打开项目或进行克隆' : '没有需要提交的更改'}</div>
                                ) : (
                                    renderFileList(unstagedFiles, 'unstaged')
                                )}
                            </div>
                        </div>
                    )}
                </div>

                <div className={styles['changes-section']} style={{ marginTop: '8px' }}>
                    <div
                        className={styles['changes-header']}
                        onClick={() => setIsCompareOpen(!isCompareOpen)}
                        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flex: 1, minWidth: 0 }}>
                            <i className={`codicon ${isCompareOpen ? 'codicon-chevron-down' : 'codicon-chevron-right'}`} style={{ fontSize: '14px', width: '16px', flexShrink: 0 }} />
                            <span style={{ flexShrink: 0 }}>{compareBase === '文件历史' ? '文件历史' : '对比'}</span>

                            {compareTarget && compareBase && (
                                <span style={{ flex: 1, minWidth: 0, color: 'var(--vscode-textLink-foreground)', fontSize: '11px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={compareBase === '文件历史' ? `文件: ${compareTarget}` : `${compareTarget} ↔ ${compareBase}`}>
                                    {compareBase === '文件历史' ? `(${compareTarget})` : `(${compareTarget} ↔ ${compareBase})`}
                                </span>
                            )}
                            <span className={styles['badge']} style={{ flexShrink: 0 }}>{compareCommits.length}</span>
                        </div>

                        {/* 🌟 只有当是有效 Repo 才会显示比较工具栏按钮 */}
                        {isRepo && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '2px', flexShrink: 0 }}>
                                <Tooltip content={activeFile ? `查看当前文件历史` : "查看当前文件历史 (请先打开文件)"}>
                                    <button
                                        className={styles['action-btn']}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            if (!activeFile) {
                                                vscode.postMessage({ command: 'error', message: '当前没有在编辑器中打开任何文件，无法查看历史记录。' });
                                                return;
                                            }
                                            vscode.postMessage({ command: 'viewFileHistory', file: activeFile });
                                        }}
                                        style={{ opacity: activeFile ? 0.8 : 0.4, width: '20px', height: '20px', display: 'flex', justifyContent: 'center', cursor: activeFile ? 'pointer' : 'not-allowed' }}
                                    >
                                        <i className="codicon codicon-history" />
                                    </button>
                                </Tooltip>

                                <Tooltip content="分支对比">
                                    <button
                                        className={styles['action-btn']}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            vscode.postMessage({ command: 'requestCompare' });
                                        }}
                                        style={{ opacity: 0.8, width: '20px', height: '20px', display: 'flex', justifyContent: 'center' }}
                                    >
                                        <i className="codicon codicon-git-compare" />
                                    </button>
                                </Tooltip>

                                {(compareTarget && compareBase) && (
                                    <Tooltip content="关闭对比">
                                        <button
                                            className={styles['action-btn']}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setCompareTarget(null);
                                                setCompareBase(null);
                                                setCompareCommits([]);
                                            }}
                                            style={{ opacity: 0.8, width: '20px', height: '20px', display: 'flex', justifyContent: 'center' }}
                                        >
                                            <i className="codicon codicon-close" />
                                        </button>
                                    </Tooltip>
                                )}
                            </div>
                        )}
                    </div>
                    {isCompareOpen && (
                        <div style={{ maxHeight: '30vh', overflowY: 'auto', paddingBottom: '4px' }}>
                            {(!compareTarget || !compareBase) ? (
                                <div className={styles['empty-message']}>{!isRepo ? '未连接至 Git 仓库' : '点击右上角图标选择分支或查看文件历史'}</div>
                            ) : (
                                <GitCompareList
                                    commits={compareCommits}
                                    activeCommitHash={activeCommitHash}
                                    loadedCommitHash={loadedCommitHash}
                                    commitFilesLoading={commitFilesLoading}
                                    commitFiles={commitFiles}
                                    remoteUrl={remoteUrl}
                                    onCommitClick={toggleCommit}
                                    renderCommitFiles={(files) => renderFileList(files, compareBase === '文件历史' ? 'history' : 'compare')}
                                />
                            )}
                        </div>
                    )}
                </div>
            </div>

            <div className={styles['git-graph-section']}>
                <div
                    className={styles['changes-header']}
                    onClick={() => setIsGraphOpen(!isGraphOpen)}
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <i className={`codicon ${isGraphOpen ? 'codicon-chevron-down' : 'codicon-chevron-right'}`} style={{ fontSize: '14px', width: '16px' }} /> 图形
                    </div>

                    {/* 🌟 只有当是有效 Repo 才会显示图形相关的右上角工具栏按钮 */}
                    {isRepo && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <Tooltip content="新建本地分支">
                                <button
                                    className={styles['action-btn']}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        vscode.postMessage({ command: 'createBranch' }); 
                                    }}
                                    style={{ opacity: 0.8, width: '20px', height: '20px', display: 'flex', justifyContent: 'center' }}
                                >
                                    <i className="codicon codicon-git-branch-staged-changes" />
                                </button>
                            </Tooltip>

                            <Tooltip content="切换分支 (Checkout)">
                                <button
                                    className={styles['action-btn']}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        vscode.postMessage({ command: 'checkoutBranch' });
                                    }}
                                    style={{ opacity: 0.8, width: '20px', height: '20px', display: 'flex', justifyContent: 'center' }}
                                >
                                    <i className="codicon codicon-git-branch" />
                                </button>
                            </Tooltip>

                            <Tooltip content="合并分支 (Merge)">
                                <button
                                    className={styles['action-btn']}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        vscode.postMessage({ command: 'mergeBranch' });
                                    }}
                                    style={{ opacity: 0.8, width: '20px', height: '20px', display: 'flex', justifyContent: 'center' }}
                                >
                                    <i className="codicon codicon-git-pull-request" />
                                </button>
                            </Tooltip>

                            <Tooltip content="搜索记录">
                                <button
                                    className={styles['action-btn']}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setIsGraphSearchOpen(!isGraphSearchOpen);
                                    }}
                                    style={{ opacity: 0.8, width: '20px', height: '20px', display: 'flex', justifyContent: 'center' }}
                                >
                                    <i className="codicon codicon-search" />
                                </button>
                            </Tooltip>

                            <Tooltip content={`筛选分支 (当前: ${selectedGraphFilter})`}>
                                <button
                                    className={styles['action-btn']}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        vscode.postMessage({ command: 'changeGraphFilter', current: selectedGraphFilter });
                                    }}
                                    style={{
                                        opacity: flashBranchBtn ? 1 : 0.8,
                                        width: '20px', height: '20px',
                                        display: 'flex', justifyContent: 'center',
                                        backgroundColor: flashBranchBtn ? 'var(--vscode-button-background, #3168d1)' : 'transparent',
                                        color: flashBranchBtn ? 'var(--vscode-button-foreground, #ffffff)' : 'inherit',
                                        borderRadius: '3px',
                                        transition: 'all 0.5s ease-out'
                                    }}
                                >
                                    <i className="codicon codicon-filter" />
                                </button>
                            </Tooltip>

                            <Tooltip content="刷新">
                                <button
                                    className={styles['action-btn']}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setIsGraphLoading(true);
                                        lastRefreshRef.current = Date.now();
                                        vscode.postMessage({ command: 'refresh' });
                                    }}
                                    style={{ opacity: 0.8, width: '20px', height: '20px', display: 'flex', justifyContent: 'center' }}
                                >
                                    <i className="codicon codicon-refresh" />
                                </button>
                            </Tooltip>
                        </div>
                    )}
                </div>

                {isGraphOpen && (
                    isGraphLoading ? (
                        <div style={{ textAlign: 'center', padding: '30px 10px', color: 'var(--vscode-descriptionForeground)', fontSize: '12px', opacity: 0.8 }}>
                            <i className="codicon codicon-loading codicon-modifier-spin" style={{ marginRight: '8px' }} /> 正在加载历史记录...
                        </div>
                    ) : graphCommits.length === 0 ? (
                        <div className={styles['git-graph-fallback']}>{!isRepo ? '未连接至 Git 仓库' : '暂无记录'}</div>
                    ) : (
                        <GitGraph
                            graphCommits={graphCommits}
                            displayCount={displayCount}
                            setDisplayCount={setDisplayCount}
                            activeCommitHash={activeCommitHash}
                            loadedCommitHash={loadedCommitHash}
                            commitFilesLoading={commitFilesLoading}
                            commitFiles={commitFiles}
                            branch={branch}
                            onCommitClick={toggleCommit}
                            remoteUrl={remoteUrl}
                            isSearchOpen={isGraphSearchOpen}
                            setIsSearchOpen={setIsGraphSearchOpen}
                            renderCommitFiles={(files) => renderFileList(files, 'history')}
                        />
                    )
                )}
            </div>
        </div>
    );
}