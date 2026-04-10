import React, { useState, useEffect, useRef, useMemo } from 'react';
import { vscode } from '../utils/vscode';
import styles from '../assets/css/GitApp.module.css';

// 引入 GitGraph
import { Gitgraph, templateExtend, TemplateName } from '@gitgraph/react';

// 引入 VS Code 官方图标库 CSS
import '@vscode/codicons/dist/codicon.css';

// 引入 FontAwesome 彩色图标
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faImage, faCode, faFile } from '@fortawesome/free-solid-svg-icons';
import { faMarkdown, faHtml5, faCss3Alt, faVuejs, faJs } from '@fortawesome/free-brands-svg-icons';

interface GitFile { status: string; file: string; }
interface GraphCommit { hash: string; parents?: string[]; author: string; email?: string; message: string; timestamp?: number; refs?: string; }
interface TreeNode { name: string; fullPath: string; isDirectory: boolean; children: TreeNode[]; file?: GitFile; }

function formatRelativeTime(ms: number) {
    const diff = Date.now() - ms;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    if (days > 0) return `${days} 天前`;
    const hours = Math.floor(diff / (1000 * 60 * 60));
    if (hours > 0) return `${hours} 小时前`;
    const mins = Math.floor(diff / (1000 * 60));
    if (mins > 0) return `${mins} 分钟前`;
    return '刚刚';
}

function formatAbsoluteTime(ms: number) {
    const d = new Date(ms);
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function buildTree(files: GitFile[]): TreeNode[] {
    const root: TreeNode[] = [];

    files.forEach(f => {
        const parts = f.file.split('/');
        let currentLevel = root;
        let currentPath = '';

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
    const [stagedFiles, setStagedFiles] = useState<GitFile[]>([]);
    const [unstagedFiles, setUnstagedFiles] = useState<GitFile[]>([]);
    const [branch, setBranch] = useState('');
    const [commitMsg, setCommitMsg] = useState('');
    const [loading, setLoading] = useState(false);
    const [activeFile, setActiveFile] = useState<string | null>(null);

    const [isStagedOpen, setIsStagedOpen] = useState(true);
    const [isUnstagedOpen, setIsUnstagedOpen] = useState(true);
    const [isGraphOpen, setIsGraphOpen] = useState(true);

    const [graphCommits, setGraphCommits] = useState<GraphCommit[]>([]);
    const [isGraphLoading, setIsGraphLoading] = useState(true);

    const [viewMode, setViewMode] = useState<'list' | 'tree'>('list');
    const [expandedDirs, setExpandedDirs] = useState<Record<string, boolean>>({});

    const [displayCount, setDisplayCount] = useState(50);

    const [activeCommitHash, setActiveCommitHash] = useState<string | null>(null);
    const [loadedCommitHash, setLoadedCommitHash] = useState<string | null>(null);
    const [activeCommitParentHash, setActiveCommitParentHash] = useState<string | undefined>();
    const [commitFiles, setCommitFiles] = useState<GitFile[]>([]);
    const [commitFilesLoading, setCommitFilesLoading] = useState(false);

    const [compareTarget, setCompareTarget] = useState<string | null>(null);
    const [compareBase, setCompareBase] = useState<string | null>(null);
    const [compareCommits, setCompareCommits] = useState<GraphCommit[]>([]);
    const [isCompareOpen, setIsCompareOpen] = useState(true);

    const [contextMenu, setContextMenu] = useState<{ visible: boolean, x: number, y: number, file: GitFile, listType: 'staged' | 'unstaged' | 'history' } | null>(null);

    const lastRefreshRef = useRef<number>(0);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const graphContainerRef = useRef<HTMLDivElement>(null);

    // 🌟 定义 GitGraph 的自定义主题，尽量匹配我们之前的风格
    const gitgraphTemplate = useMemo(() => {
        return templateExtend(TemplateName.Metro, {
            commit: {
                spacing: 36, // 行高
                dot: { size: 4 }, // 节点大小
                message: {
                    font: 'normal 13px var(--vscode-font-family, sans-serif)',
                    color: 'var(--vscode-foreground, #cccccc)'
                }
            },
            colors: ['#007acc', '#f14c4c', '#89d185', '#cca700', '#c586c0', '#4fc1ff'],
            branch: { lineWidth: 2, spacing: 12 }
        });
    }, []);

    useEffect(() => {
        lastRefreshRef.current = Date.now();

        vscode.postMessage({ command: 'webviewLoaded' });
        const handleMsg = (e: MessageEvent) => {
            const msg = e.data;
            if (msg.type === 'startLoading') {
                setIsGraphLoading(true);
            } else if (msg.type === 'statusData') {
                setStagedFiles(msg.stagedFiles || []);
                setUnstagedFiles(msg.unstagedFiles || []);
                setBranch(msg.branch || '');
                setLoading(false);
            } else if (msg.type === 'graphData') {
                const commits = msg.graphCommits || [];
                setGraphCommits(commits);
                setDisplayCount(50);
                setIsGraphLoading(false);
            } else if (msg.type === 'commitFilesData') {
                setCommitFiles(msg.files || []);
                setActiveCommitParentHash(msg.parentHash);
                setLoadedCommitHash(msg.hash);
                setCommitFilesLoading(false);
            } else if (msg.type === 'activeEditorChanged') {
                setActiveFile(msg.file);
                if (msg.file && viewMode === 'tree') {
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
            }
        };
        window.addEventListener('message', handleMsg);

        const closeContextMenu = () => setContextMenu(null);
        window.addEventListener('click', closeContextMenu);
        window.addEventListener('blur', closeContextMenu);

        return () => {
            window.removeEventListener('message', handleMsg);
            window.removeEventListener('click', closeContextMenu);
            window.removeEventListener('blur', closeContextMenu);
        };
    }, [viewMode]);

    const handleCommit = () => {
        if (!commitMsg.trim()) return;
        setLoading(true);
        vscode.postMessage({ command: 'commit', message: commitMsg });
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

    const handleGraphScroll = (e: React.UIEvent<HTMLDivElement>) => {
        const target = e.target as HTMLDivElement;
        if (target.scrollHeight - target.scrollTop <= target.clientHeight + 100) {
            if (displayCount < graphCommits.length) {
                setDisplayCount(prev => prev + 50);
            }
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

    const renderTreeNodes = (nodes: TreeNode[], listType: 'staged' | 'unstaged' | 'history', depth = 0): React.ReactNode => {
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
                            <button className={styles['action-btn']} title="打开文件" onClick={() => vscode.postMessage({ command: 'open', file: item.file })}>
                                <i className="codicon codicon-go-to-file" />
                            </button>

                            {listType === 'unstaged' && (
                                <button className={styles['action-btn']} title="放弃更改" onClick={() => vscode.postMessage({ command: 'discard', file: item.file, status: item.status })}>
                                    <i className="codicon codicon-discard" />
                                </button>
                            )}

                            {listType !== 'history' && (
                                <>
                                    {listType === 'staged' ? (
                                        <button className={styles['action-btn']} title="取消暂存更改" onClick={() => vscode.postMessage({ command: 'unstage', file: item.file })}>
                                            <i className="codicon codicon-remove" />
                                        </button>
                                    ) : (
                                        <button className={styles['action-btn']} title="暂存更改" onClick={() => vscode.postMessage({ command: 'stage', file: item.file, status: item.status })}>
                                            <i className="codicon codicon-plus" />
                                        </button>
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

    const renderFileList = (files: GitFile[], listType: 'staged' | 'unstaged' | 'history') => {
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
                                <button className={styles['action-btn']} title="打开文件" onClick={() => vscode.postMessage({ command: 'open', file: item.file })}>
                                    <i className="codicon codicon-go-to-file" />
                                </button>

                                {listType === 'unstaged' && (
                                    <button className={styles['action-btn']} title="放弃更改" onClick={() => vscode.postMessage({ command: 'discard', file: item.file, status: item.status })}>
                                        <i className="codicon codicon-discard" />
                                    </button>
                                )}

                                {listType !== 'history' && (
                                    <>
                                        {listType === 'staged' ? (
                                            <button className={styles['action-btn']} title="取消暂存更改" onClick={() => vscode.postMessage({ command: 'unstage', file: item.file })}>
                                                <i className="codicon codicon-remove" />
                                            </button>
                                        ) : (
                                            <button className={styles['action-btn']} title="暂存更改" onClick={() => vscode.postMessage({ command: 'stage', file: item.file, status: item.status })}>
                                                <i className="codicon codicon-plus" />
                                            </button>
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

                        {contextMenu.listType !== 'history' && (
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
                    </div>
                </>
            )}

            <div className={styles['git-toolbar']}>
                <span>Git 管理 ({branch})</span>
                <div className={styles['git-actions']}>
                    <button className={styles['icon-btn']} title="拉取 (Pull)" onClick={() => vscode.postMessage({ command: 'pull' })}>
                        <i className="codicon codicon-arrow-down" />
                    </button>
                    <button className={styles['icon-btn']} title="推送 (Push)" onClick={() => vscode.postMessage({ command: 'push' })}>
                        <i className="codicon codicon-arrow-up" />
                    </button>
                    <button className={styles['icon-btn']} title={viewMode === 'list' ? '以树状视图查看' : '以列表视图查看'} onClick={() => setViewMode(v => v === 'list' ? 'tree' : 'list')}>
                        <i className={`codicon ${viewMode === 'list' ? 'codicon-list-tree' : 'codicon-list-flat'}`} />
                    </button>
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
                    }}
                    onKeyDown={(e) => {
                        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') handleCommit();
                    }}
                    style={{ resize: 'none', minHeight: '28px', overflowY: 'auto', boxSizing: 'border-box' }}
                />
                <button className={styles['commit-btn']} disabled={loading || (!commitMsg.trim() || (stagedFiles.length === 0 && unstagedFiles.length === 0))} onClick={handleCommit}>
                    {loading ? <i className="codicon codicon-loading codicon-modifier-spin" style={{ marginRight: '6px' }} /> : <i className="codicon codicon-check" style={{ marginRight: '6px' }} />} 提交 (Commit)
                </button>
            </div>

            <div className={styles['changes-scroll-area']}>
                {stagedFiles.length > 0 && (
                    <div className={styles['changes-section']}>
                        <div className={styles['changes-header']} onClick={() => setIsStagedOpen(!isStagedOpen)}>
                            <i className={`codicon ${isStagedOpen ? 'codicon-chevron-down' : 'codicon-chevron-right'}`} style={{ fontSize: '14px', width: '16px' }} /> 暂存的更改 <span className={styles['badge']}>{stagedFiles.length}</span>
                        </div>
                        {isStagedOpen && renderFileList(stagedFiles, 'staged')}
                    </div>
                )}

                <div className={styles['changes-section']}>
                    <div className={styles['changes-header']} onClick={() => setIsUnstagedOpen(!isUnstagedOpen)}>
                        <i className={`codicon ${isUnstagedOpen ? 'codicon-chevron-down' : 'codicon-chevron-right'}`} style={{ fontSize: '14px', width: '16px' }} /> 更改 <span className={styles['badge']}>{unstagedFiles.length}</span>
                    </div>
                    {isUnstagedOpen && (
                        unstagedFiles.length === 0 && stagedFiles.length === 0 ? <div className={styles['empty-message']}>没有需要提交的更改</div> : renderFileList(unstagedFiles, 'unstaged')
                    )}
                </div>

                {(compareTarget && compareBase) && (
                    <div className={styles['changes-section']} style={{ marginTop: '8px' }}>
                        <div
                            className={styles['changes-header']}
                            onClick={() => setIsCompareOpen(!isCompareOpen)}
                            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <i className={`codicon ${isCompareOpen ? 'codicon-chevron-down' : 'codicon-chevron-right'}`} style={{ fontSize: '14px', width: '16px' }} />
                                <span style={{ color: 'var(--vscode-textLink-foreground)', fontSize: '11px', maxWidth: '150px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {compareTarget} 差异
                                </span>
                                <span className={styles['badge']}>{compareCommits.length}</span>
                            </div>
                            <button
                                className={styles['action-btn']}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setCompareTarget(null); setCompareBase(null); setCompareCommits([]);
                                }}
                            >
                                <i className="codicon codicon-close" />
                            </button>
                        </div>
                        {isCompareOpen && (
                            compareCommits.length === 0 ? <div className={styles['empty-message']}>无差异记录</div> : (
                                <ul className={styles['file-list']} style={{ padding: 0, margin: 0 }}>
                                    {compareCommits.map(c => (
                                        <li key={c.hash} style={{ borderBottom: '1px solid var(--vscode-panel-border)', padding: 0 }}>
                                            <div
                                                className={styles['file-item']}
                                                style={{ height: 'auto', padding: '4px 8px', display: 'flex', alignItems: 'flex-start', gap: '8px' }}
                                                onClick={() => toggleCommit(c.hash)}
                                            >
                                                <div style={{
                                                    width: '16px', height: '16px', borderRadius: '50%', backgroundColor: '#3168d1', color: '#fff',
                                                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 'bold', flexShrink: 0, marginTop: '2px'
                                                }}>{c.author[0].toUpperCase()}</div>
                                                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                                                    <div style={{ fontSize: '12px', color: 'var(--vscode-foreground)', lineHeight: '1.4', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.message}</div>
                                                    <div style={{ fontSize: '11px', color: 'var(--vscode-descriptionForeground)', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                        <span>{c.author}</span><span style={{ opacity: 0.4 }}>|</span><span>{c.hash.substring(0, 7)}</span>
                                                    </div>
                                                </div>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            )
                        )}
                    </div>
                )}
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

                    <div style={{ display: 'flex', alignItems: 'center' }}>
                        <button className={styles['action-btn']} onClick={(e) => { e.stopPropagation(); vscode.postMessage({ command: 'requestCompare' }); }} style={{ opacity: 0.8 }}>
                            <i className="codicon codicon-git-compare" />
                        </button>
                        <button className={styles['action-btn']} onClick={(e) => { e.stopPropagation(); setIsGraphLoading(true); lastRefreshRef.current = Date.now(); vscode.postMessage({ command: 'refresh' }); }} style={{ marginRight: '4px', opacity: 0.8 }}>
                            <i className="codicon codicon-refresh" />
                        </button>
                    </div>
                </div>

                {isGraphOpen && (
                    isGraphLoading ? (
                        <div style={{ textAlign: 'center', padding: '30px 10px', color: 'var(--vscode-descriptionForeground)', fontSize: '12px', opacity: 0.8 }}>
                            <i className="codicon codicon-loading codicon-modifier-spin" style={{ marginRight: '8px' }} /> 正在加载...
                        </div>
                    ) : graphCommits.length === 0 ? (
                        <div className={styles['git-graph-fallback']}>暂无记录</div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
                            {/* 🌟 替换区：使用 GitGraph 渲染提交图 */}
                            <div
                                className={styles['git-graph-view']}
                                ref={graphContainerRef}
                                onScroll={handleGraphScroll}
                                style={{ flex: 1, overflowY: 'auto', paddingLeft: '8px' }}
                            >
                                <Gitgraph options={{ template: gitgraphTemplate }}>
                                    {(gitgraph) => {
                                        const visibleCommits = graphCommits.slice(0, displayCount);
                                        const knownHashes = new Set(visibleCommits.map(c => c.hash));

                                        // 🌟 核心修复：严格伪装成 git2json 要求的全量数据结构
                                        const importData = [...visibleCommits].reverse().map(c => {
                                            const validParents = (c.parents || []).filter(p => knownHashes.has(p));

                                            // 从 refs 中提取并清理标签
                                            const cleanRefs = c.refs
                                                ? c.refs.split(',').map(r => r.replace('HEAD -> ', '').trim()).filter(Boolean)
                                                : [];

                                            return {
                                                hash: c.hash,
                                                hashAbbrev: c.hash.substring(0, 7),
                                                tree: c.hash, // mock data
                                                treeAbbrev: c.hash.substring(0, 7), // mock data
                                                parents: validParents,
                                                // 必须提供完整的 author 和 committer 对象
                                                author: {
                                                    name: c.author || 'Unknown',
                                                    email: c.email || 'unknown@git.com',
                                                    timestamp: c.timestamp ? Math.floor(c.timestamp / 1000) : 0
                                                },
                                                committer: {
                                                    name: c.author || 'Unknown',
                                                    email: c.email || 'unknown@git.com',
                                                    timestamp: c.timestamp ? Math.floor(c.timestamp / 1000) : 0
                                                },
                                                subject: c.message,
                                                body: "",
                                                notes: "",
                                                refs: cleanRefs
                                            };
                                        });

                                        try {
                                            if (importData.length > 0) {
                                                // 每次渲染前清理旧数据（如果在 StrictMode 下）
                                                gitgraph.clear();
                                                gitgraph.import(importData);
                                            }
                                        } catch (err) {
                                            console.error("Gitgraph 渲染由于历史截断失败", err);
                                        }
                                    }}
                                </Gitgraph>
                            </div>

                            {/* 🌟 为了适配 GitGraph，将展开的文件列表固定放置在图形下方分屏 */}
                            {activeCommitHash && (
                                <div style={{
                                    flexShrink: 0,
                                    height: '220px',
                                    borderTop: '1px solid var(--vscode-panel-border)',
                                    backgroundColor: 'var(--vscode-sideBar-background)',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    overflow: 'hidden'
                                }}>
                                    <div style={{
                                        padding: '6px 8px',
                                        borderBottom: '1px solid var(--vscode-panel-border)',
                                        fontWeight: 'bold',
                                        fontSize: '11px',
                                        display: 'flex',
                                        justifyContent: 'space-between'
                                    }}>
                                        <span>查看变动 (Hash: {activeCommitHash.substring(0, 7)})</span>
                                        <i className="codicon codicon-close" style={{ cursor: 'pointer' }} onClick={() => setActiveCommitHash(null)} />
                                    </div>
                                    <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
                                        {(commitFilesLoading || loadedCommitHash !== activeCommitHash) ? (
                                            <div style={{ padding: '8px', opacity: 0.6, fontSize: '11px' }}>加载变动文件...</div>
                                        ) : renderFileList(commitFiles, 'history')}
                                    </div>
                                </div>
                            )}
                        </div>
                    )
                )}
            </div>
        </div>
    );
}