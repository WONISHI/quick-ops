import { useState, useEffect, useRef, useMemo } from 'react';
import { vscode } from '../utils/vscode';
import styles from '../assets/css/GitApp.module.css';

// 🌟 引入 VS Code 官方图标库 CSS (用于按钮和菜单)
import '@vscode/codicons/dist/codicon.css';

// 🌟 恢复引入 FontAwesome (专门用于彩色文件图标)
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faImage, faCode, faFile } from '@fortawesome/free-solid-svg-icons';
import { faMarkdown, faHtml5, faCss3Alt, faVuejs, faJs } from '@fortawesome/free-brands-svg-icons';

interface GitFile { status: string; file: string; }
interface GraphCommit { hash: string; parents?: string[]; author: string; email?: string; message: string; timestamp?: number; refs?: string; }

const COLORS = ['#007acc', '#f14c4c', '#89d185', '#cca700', '#c586c0', '#4fc1ff'];
const LANE_WIDTH = 12;
const ROW_HEIGHT = 36;
const CY = 18;

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

function parseRemoteInfo(url: string, hash: string) {
    if (!url) return null;
    let cleanUrl = url.replace(/\.git$/, '');
    if (cleanUrl.startsWith('git@')) cleanUrl = cleanUrl.replace(/^git@([^:]+):/, 'https://$1/');
    let platform = 'GitLab';
    let icon = 'codicon-repo'; 
    if (cleanUrl.includes('github.com')) { platform = 'GitHub'; icon = 'codicon-github'; }
    else if (cleanUrl.includes('gitee.com')) { platform = 'Gitee'; }
    return { platform, icon, url: `${cleanUrl}/commit/${hash}` };
}

function processGraphCommits(commits: GraphCommit[]) {
    let activeLanes: (string | null)[] = [];

    return commits.map(commit => {
        const matchingLanes: number[] = [];
        activeLanes.forEach((h, i) => { if (h === commit.hash) matchingLanes.push(i); });

        let laneIndex = matchingLanes.length > 0 ? matchingLanes[0] : -1;
        let isNewBranch = false;

        if (laneIndex === -1) {
            laneIndex = activeLanes.findIndex(l => l === null);
            if (laneIndex === -1) laneIndex = activeLanes.length;
            isNewBranch = true;
        }

        const incomingLanes = [...activeLanes];
        if (isNewBranch) incomingLanes[laneIndex] = commit.hash;

        const outgoingLanes = [...incomingLanes];
        const parents = commit.parents || [];
        const parentLanes: number[] = [];

        if (parents.length > 0) {
            outgoingLanes[laneIndex] = parents[0];
            parentLanes.push(laneIndex);
        } else {
            outgoingLanes[laneIndex] = null; 
        }

        for (let i = 1; i < parents.length; i++) {
            const p = parents[i];
            let outIdx = outgoingLanes.findIndex((l, index) => l === null && index > laneIndex);
            if (outIdx === -1) outIdx = outgoingLanes.findIndex(l => l === null);
            
            if (outIdx !== -1) {
                outgoingLanes[outIdx] = p;
            } else {
                outIdx = outgoingLanes.length;
                outgoingLanes.push(p);
            }
            parentLanes.push(outIdx);
        }

        for (let i = 1; i < matchingLanes.length; i++) {
            outgoingLanes[matchingLanes[i]] = null;
        }

        while (outgoingLanes.length > 0 && outgoingLanes[outgoingLanes.length - 1] === null) {
            outgoingLanes.pop();
        }

        const paths: { type: 'pass' | 'spawn' | 'merge', from: number, to: number, color: string }[] = [];

        if (!isNewBranch) {
            paths.push({ type: 'merge', from: laneIndex, to: laneIndex, color: COLORS[laneIndex % COLORS.length] });
        }
        for (let i = 1; i < matchingLanes.length; i++) {
            const mergedIdx = matchingLanes[i];
            paths.push({ type: 'merge', from: mergedIdx, to: laneIndex, color: COLORS[mergedIdx % COLORS.length] });
        }

        incomingLanes.forEach((hash, i) => {
            if (hash && hash !== commit.hash) {
                const outIdx = outgoingLanes.indexOf(hash);
                if (outIdx !== -1) {
                    paths.push({ type: 'pass', from: i, to: outIdx, color: COLORS[outIdx % COLORS.length] });
                }
            }
        });

        parents.forEach((p, i) => {
            const outIdx = parentLanes[i];
            paths.push({ type: 'spawn', from: laneIndex, to: outIdx, color: COLORS[outIdx % COLORS.length] });
        });

        activeLanes = outgoingLanes;

        return {
            ...commit,
            laneIndex,
            isNewBranch,
            paths,
            outgoingLanes,
            maxLane: Math.max(incomingLanes.length, outgoingLanes.length)
        };
    });
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
    const [remoteUrl, setRemoteUrl] = useState<string>('');
    
    const [displayCount, setDisplayCount] = useState(50);

    const [activeCommitHash, setActiveCommitHash] = useState<string | null>(null);
    const [loadedCommitHash, setLoadedCommitHash] = useState<string | null>(null);
    const [activeCommitParentHash, setActiveCommitParentHash] = useState<string | undefined>();
    const [commitFiles, setCommitFiles] = useState<GitFile[]>([]);
    const [commitFilesLoading, setCommitFilesLoading] = useState(false);

    const [hoverInfo, setHoverInfo] = useState<{ commit: GraphCommit, x: number, y: number } | null>(null);
    const hoverTimeoutRef = useRef<any>(null);

    const [contextMenu, setContextMenu] = useState<{ visible: boolean, x: number, y: number, file: GitFile, listType: 'staged' | 'unstaged' | 'history' } | null>(null);

    const processedCommits = useMemo(() => processGraphCommits(graphCommits), [graphCommits]);

    const yPositions = useMemo(() => {
        const positions: number[] = [];
        let currentY = 0;
        for (let i = 0; i < processedCommits.length; i++) {
            positions.push(currentY);
            currentY += ROW_HEIGHT;
            
            if (activeCommitHash === processedCommits[i].hash) {
                if (commitFilesLoading || loadedCommitHash !== activeCommitHash) {
                    currentY += 38;
                } else {
                    currentY += 10 + commitFiles.length * 22;
                }
            }
        }
        positions.push(currentY);
        return positions;
    }, [processedCommits, activeCommitHash, commitFilesLoading, loadedCommitHash, commitFiles.length]);

    const renderedHeight = yPositions[Math.min(displayCount, processedCommits.length)] || 0;

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const graphContainerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        const container = graphContainerRef.current;
        if (!canvas || !container || processedCommits.length === 0) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;
        const containerWidth = container.clientWidth || 800;

        canvas.width = containerWidth * dpr;
        canvas.height = renderedHeight * dpr;
        ctx.scale(dpr, dpr);

        ctx.clearRect(0, 0, containerWidth, renderedHeight);

        processedCommits.slice(0, displayCount).forEach((c, idx) => {
            const startY = yPositions[idx] + CY;
            const endY = idx + 1 < yPositions.length ? yPositions[idx + 1] + CY : startY + ROW_HEIGHT;
            const CURVE_OFFSET = Math.min(Math.abs(endY - startY) / 2, 20);

            c.paths.forEach(p => {
                const startX = p.from * LANE_WIDTH + 7;
                const endX = p.to * LANE_WIDTH + 7;

                ctx.beginPath();
                ctx.strokeStyle = p.color;
                ctx.lineWidth = 2;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';

                ctx.moveTo(startX, startY);
                if (startX === endX) {
                    ctx.lineTo(endX, endY);
                } else {
                    ctx.bezierCurveTo(startX, startY + CURVE_OFFSET, endX, endY - CURVE_OFFSET, endX, endY);
                }
                ctx.stroke();
            });
        });

        const bgColor = getComputedStyle(document.documentElement).getPropertyValue('--vscode-sideBar-background').trim() || '#252526';

        processedCommits.slice(0, displayCount).forEach((c, idx) => {
            const cx = c.laneIndex * LANE_WIDTH + 7;
            const cy = yPositions[idx] + CY;

            ctx.beginPath();
            ctx.arc(cx, cy, 4, 0, 2 * Math.PI);
            ctx.fillStyle = COLORS[c.laneIndex % COLORS.length];
            ctx.fill();

            ctx.lineWidth = 2;
            ctx.strokeStyle = bgColor;
            ctx.stroke();
        });
    }, [processedCommits, displayCount, yPositions, renderedHeight, activeCommitHash, isGraphOpen, isGraphLoading]);

    const lastRefreshRef = useRef<number>(0);

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
                setRemoteUrl(msg.remoteUrl || '');
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
            } else if (msg.type === 'error') {
                setLoading(false);
                setIsGraphLoading(false);
                setCommitFilesLoading(false);
            }
        };
        window.addEventListener('message', handleMsg);
        
        const triggerSmartRefresh = () => {
            const now = Date.now();
            if (now - lastRefreshRef.current > 5000) {
                vscode.postMessage({ command: 'refreshStatusOnly' }); 
                lastRefreshRef.current = now;
            }
        };

        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') triggerSmartRefresh();
        };
        const handleFocus = () => triggerSmartRefresh();

        document.addEventListener('visibilitychange', handleVisibilityChange);
        window.addEventListener('focus', handleFocus);

        const closeContextMenu = () => setContextMenu(null);
        window.addEventListener('click', closeContextMenu);
        window.addEventListener('blur', closeContextMenu);
        
        window.addEventListener('resize', () => {
            setDisplayCount(prev => prev);
        });
        
        return () => {
            window.removeEventListener('message', handleMsg);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            window.removeEventListener('focus', handleFocus);
            window.removeEventListener('click', closeContextMenu);
            window.removeEventListener('blur', closeContextMenu);
            window.removeEventListener('resize', () => {});
        };
    }, []);

    const handleMouseEnter = (e: React.MouseEvent, commit: GraphCommit) => {
        const rect = e.currentTarget.getBoundingClientRect();
        clearTimeout(hoverTimeoutRef.current);
        hoverTimeoutRef.current = setTimeout(() => {
            const safeY = Math.min(rect.bottom + 4, window.innerHeight - 120);
            setHoverInfo({ commit, x: rect.left + 24, y: safeY });
        }, 600);
    };

    const handleMouseLeave = () => {
        clearTimeout(hoverTimeoutRef.current);
        hoverTimeoutRef.current = setTimeout(() => { setHoverInfo(null); }, 250);
    };

    const handleCommit = () => {
        if (!commitMsg.trim()) return;
        setLoading(true);
        vscode.postMessage({ command: 'commit', message: commitMsg });
        setCommitMsg('');
        if (textareaRef.current) textareaRef.current.style.height = '32px'; 
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

    // 🌟 恢复文件图标使用漂亮的 FontAwesome 彩色图标
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

    const renderFileList = (files: GitFile[], listType: 'staged' | 'unstaged' | 'history') => {
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
                                {/* 🌟 将“打开文件”图标替换为 codicon-go-to-file */}
                                <button className={styles['action-btn']} title="打开文件" onClick={() => vscode.postMessage({ command: 'open', file: item.file })}>
                                    <i className="codicon codicon-go-to-file" />
                                </button>
                                
                                {/* 🌟 将“放弃更改”图标替换为 codicon-discard */}
                                {listType === 'unstaged' && (
                                    <button className={styles['action-btn']} title="放弃更改" onClick={() => vscode.postMessage({ command: 'discard', file: item.file, status: item.status })}>
                                        <i className="codicon codicon-discard" /> 
                                    </button>
                                )}

                                {listType !== 'history' && (
                                    <>
                                        {listType === 'staged' ? (
                                            <button className={styles['action-btn']} title="取消暂存更改" onClick={() => vscode.postMessage({ command: 'unstage', file: item.file })}>
                                                <i className="codicon codicon-dash" />
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

    const toggleCommit = (hash: string) => {
        clearTimeout(hoverTimeoutRef.current);
        setHoverInfo(null);
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
            if (displayCount < processedCommits.length) {
                setDisplayCount(prev => prev + 50);
            }
        }
    };

    const textareaRef = useRef<HTMLTextAreaElement>(null);

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
                        
                        {/* 🌟 右键菜单里的“打开文件”同步修改为 codicon-go-to-file */}
                        <div className={styles['context-menu-item']} onClick={() => {
                            vscode.postMessage({ command: 'open', file: contextMenu.file.file });
                            setContextMenu(null);
                        }}>
                            <i className={`codicon codicon-go-to-file ${styles['context-menu-icon']}`} /> 
                            <span>打开文件</span>
                        </div>
                        
                        {/* 🌟 右键菜单里的“放弃更改”同步修改为 codicon-discard */}
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
                                <i className={`codicon ${contextMenu.listType === 'staged' ? 'codicon-dash' : 'codicon-plus'} ${styles['context-menu-icon']}`} /> 
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

            {hoverInfo && (
                <div
                    className={styles['commit-hover-widget']}
                    style={{ left: Math.min(hoverInfo.x, window.innerWidth - 300), top: hoverInfo.y }}
                    onMouseEnter={() => clearTimeout(hoverTimeoutRef.current)}
                    onMouseLeave={handleMouseLeave}
                >
                    <div className={styles['hover-header']}>
                        <div className={styles['hover-avatar']}>{hoverInfo.commit.author[0].toUpperCase()}</div>
                        <span className={styles['hover-author']}>{hoverInfo.commit.author}</span>
                        {hoverInfo.commit.timestamp && (
                            <span className={styles['hover-time']}>
                                , {formatRelativeTime(hoverInfo.commit.timestamp)} ({formatAbsoluteTime(hoverInfo.commit.timestamp)})
                            </span>
                        )}
                    </div>

                    {hoverInfo.commit.refs && (
                        <div className={styles['hover-refs']}>
                            {hoverInfo.commit.refs.split(',').map(r => r.trim()).filter(Boolean).map((r, i) => {
                                const isHead = r.startsWith('HEAD -> ');
                                const name = isHead ? r.replace('HEAD -> ', '') : r;
                                return <span key={i} className={`${styles['ref-tag']} ${isHead ? styles['ref-head'] : ''}`}>{name}</span>;
                            })}
                        </div>
                    )}

                    <div className={styles['hover-message']}>{hoverInfo.commit.message}</div>
                    <div className={styles['hover-divider']}></div>
                    <div className={styles['hover-footer']}>
                        <span className={styles['hover-action-btn']} onClick={() => vscode.postMessage({ command: 'copy', text: hoverInfo.commit.hash })} title="复制 Hash">
                            <i className="codicon codicon-copy" style={{ marginRight: '4px' }} /> {hoverInfo.commit.hash.substring(0, 7)}
                        </span>
                        {remoteUrl && parseRemoteInfo(remoteUrl, hoverInfo.commit.hash) && (
                            <>
                                <span className={styles['hover-separator']}>|</span>
                                <span className={styles['hover-action-btn']} onClick={() => vscode.postMessage({ command: 'openExternal', url: parseRemoteInfo(remoteUrl, hoverInfo.commit.hash)!.url })}>
                                    <i className={`codicon ${parseRemoteInfo(remoteUrl, hoverInfo.commit.hash)!.icon}`} style={{ marginRight: '4px' }} /> 在 {parseRemoteInfo(remoteUrl, hoverInfo.commit.hash)!.platform} 上打开
                                </span>
                            </>
                        )}
                    </div>
                </div>
            )}

            <div className={styles['git-toolbar']}>
                <span>Git 管理 <span style={{ textTransform: 'none', opacity: 0.7 }}>({branch})</span></span>
                <div className={styles['git-actions']}>
                    <button className={styles['icon-btn']} title="刷新" onClick={() => { lastRefreshRef.current = Date.now(); vscode.postMessage({ command: 'refresh' }); }}>
                        <i className="codicon codicon-refresh" />
                    </button>
                    <button className={styles['icon-btn']} title="拉取 (Pull)" onClick={() => vscode.postMessage({ command: 'pull' })}>
                        <i className="codicon codicon-arrow-down" />
                    </button>
                    <button className={styles['icon-btn']} title="推送 (Push)" onClick={() => vscode.postMessage({ command: 'push' })}>
                        <i className="codicon codicon-arrow-up" />
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
                        e.target.style.height = '32px'; 
                        e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
                    }} 
                    onKeyDown={(e) => { 
                        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') handleCommit(); 
                    }} 
                    style={{
                        resize: 'none', 
                        minHeight: '32px',
                        overflowY: 'auto',
                        boxSizing: 'border-box'
                    }}
                />
                <button className={styles['commit-btn']} disabled={loading || (!commitMsg.trim() || (stagedFiles.length === 0 && unstagedFiles.length === 0))} onClick={handleCommit} title={stagedFiles.length === 0 ? "暂存所有文件并提交" : "提交已暂存的更改"}>
                    {loading ? <i className="codicon codicon-loading codicon-modifier-spin" style={{ marginRight: '6px' }} /> : <i className="codicon codicon-check" style={{ marginRight: '6px' }} />} 提交 (Commit)
                </button>
            </div>

            <div className={styles['changes-scroll-area']}>
                {stagedFiles.length > 0 && (
                    <div className={styles['changes-section']}>
                        <div className={styles['changes-header']} onClick={() => setIsStagedOpen(!isStagedOpen)}>
                            <i className={`codicon ${isStagedOpen ? 'codicon-chevron-down' : 'codicon-chevron-right'}`} style={{ fontSize: '14px', width: '16px' }} /> 暂存的更改 <span className={styles['badge']}>{stagedFiles.length}</span>
                        </div>
                        {isStagedOpen && (
                            <ul className={styles['file-list']}>
                                {stagedFiles.map((item, idx) => {
                                    const parts = item.file.split('/');
                                    const fileName = parts.pop();
                                    const dirPath = parts.length > 0 ? parts.join('/') : '';
                                    return (
                                        <li key={idx} className={`${styles['file-item']} ${activeFile === item.file ? styles['active'] : ''}`} title={item.file} onClick={() => { setActiveFile(item.file); vscode.postMessage({ command: 'diff', file: item.file, status: item.status }); }} onContextMenu={(e) => { e.preventDefault(); setActiveFile(item.file); const safeX = Math.min(e.clientX, window.innerWidth - 220); const safeY = Math.min(e.clientY, window.innerHeight - 250); setContextMenu({ visible: true, x: safeX, y: safeY, file: item, listType: 'staged' }); }}>
                                            {getFileIcon(fileName || '')}
                                            <div className={styles['file-name']}>{fileName}</div>
                                            {dirPath && <div className={styles['file-dir']}>{dirPath}</div>}
                                            <div style={{ flex: 1 }}></div>
                                            <div className={styles['file-actions']} onClick={(e) => e.stopPropagation()}>
                                                <button className={styles['action-btn']} title="打开文件" onClick={() => vscode.postMessage({ command: 'open', file: item.file })}><i className="codicon codicon-go-to-file" /></button>
                                                <button className={styles['action-btn']} title="取消暂存更改" onClick={() => vscode.postMessage({ command: 'unstage', file: item.file })}><i className="codicon codicon-dash" /></button>
                                            </div>
                                            <div className={`${styles['status-badge']} ${getStatusClass(item.status)}`}>{getStatusText(item.status)}</div>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </div>
                )}

                <div className={styles['changes-section']}>
                    <div className={styles['changes-header']} onClick={() => setIsUnstagedOpen(!isUnstagedOpen)}>
                        <i className={`codicon ${isUnstagedOpen ? 'codicon-chevron-down' : 'codicon-chevron-right'}`} style={{ fontSize: '14px', width: '16px' }} /> 更改 <span className={styles['badge']}>{unstagedFiles.length}</span>
                    </div>
                    {isUnstagedOpen && (
                        unstagedFiles.length === 0 && stagedFiles.length === 0 ? <div className={styles['empty-message']}>没有需要提交的更改</div> : (
                            <ul className={styles['file-list']}>
                                {unstagedFiles.map((item, idx) => {
                                    const parts = item.file.split('/');
                                    const fileName = parts.pop();
                                    const dirPath = parts.length > 0 ? parts.join('/') : '';
                                    return (
                                        <li key={idx} className={`${styles['file-item']} ${activeFile === item.file ? styles['active'] : ''}`} title={item.file} onClick={() => { setActiveFile(item.file); vscode.postMessage({ command: 'diff', file: item.file, status: item.status }); }} onContextMenu={(e) => { e.preventDefault(); setActiveFile(item.file); const safeX = Math.min(e.clientX, window.innerWidth - 220); const safeY = Math.min(e.clientY, window.innerHeight - 250); setContextMenu({ visible: true, x: safeX, y: safeY, file: item, listType: 'unstaged' }); }}>
                                            {getFileIcon(fileName || '')}
                                            <div className={styles['file-name']}>{fileName}</div>
                                            {dirPath && <div className={styles['file-dir']}>{dirPath}</div>}
                                            <div style={{ flex: 1 }}></div>
                                            <div className={styles['file-actions']} onClick={(e) => e.stopPropagation()}>
                                                <button className={styles['action-btn']} title="打开文件" onClick={() => vscode.postMessage({ command: 'open', file: item.file })}><i className="codicon codicon-go-to-file" /></button>
                                                <button className={styles['action-btn']} title="放弃更改" onClick={() => vscode.postMessage({ command: 'discard', file: item.file, status: item.status })}><i className="codicon codicon-discard" /></button>
                                                <button className={styles['action-btn']} title="暂存更改" onClick={() => vscode.postMessage({ command: 'stage', file: item.file, status: item.status })}><i className="codicon codicon-plus" /></button>
                                            </div>
                                            <div className={`${styles['status-badge']} ${getStatusClass(item.status)}`}>{getStatusText(item.status)}</div>
                                        </li>
                                    );
                                })}
                            </ul>
                        )
                    )}
                </div>
            </div>

            <div className={styles['git-graph-section']}>
                <div className={styles['changes-header']} onClick={() => setIsGraphOpen(!isGraphOpen)}>
                    <i className={`codicon ${isGraphOpen ? 'codicon-chevron-down' : 'codicon-chevron-right'}`} style={{ fontSize: '14px', width: '16px' }} /> 图形
                </div>
                {isGraphOpen && (
                    isGraphLoading ? (
                        <div style={{ textAlign: 'center', padding: '30px 10px', color: 'var(--vscode-descriptionForeground)', fontSize: '12px', opacity: 0.8 }}>
                            <i className="codicon codicon-loading codicon-modifier-spin" style={{ marginRight: '8px' }} /> 正在加载历史记录...
                        </div>
                    ) : processedCommits.length === 0 ? (
                        <div className={styles['git-graph-fallback']}>暂无记录</div>
                    ) : (
                        <div className={styles['git-graph-view']} ref={graphContainerRef} onScroll={(e) => {
                            const target = e.target as HTMLDivElement;
                            if (target.scrollHeight - target.scrollTop <= target.clientHeight + 100) {
                                if (displayCount < processedCommits.length) setDisplayCount(prev => prev + 50);
                            }
                        }} style={{ position: 'relative' }}>
                            
                            <canvas 
                                ref={canvasRef}
                                style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: renderedHeight, pointerEvents: 'none', zIndex: 2 }}
                            />

                            <ul className={styles['commit-timeline']} style={{ position: 'relative', zIndex: 1 }}>
                                {processedCommits.slice(0, displayCount).map((c) => {
                                    const paddingWidth = (c.maxLane + 1) * LANE_WIDTH + 16;
                                    return (
                                        <li key={c.hash} className={styles['commit-log-item']}>
                                            <div className={styles['commit-row']}
                                                onClick={() => toggleCommit(c.hash)}
                                                onMouseEnter={(e) => handleMouseEnter(e, c as any)}
                                                onMouseLeave={handleMouseLeave}
                                            >
                                                <div style={{ width: paddingWidth, flexShrink: 0 }} />
                                                <div className={styles['commit-content']}>
                                                    <div className={styles['commit-message']}>{c.message}</div>
                                                    <div className={styles['commit-meta']}>
                                                        <span>{c.author}</span>
                                                        <span className={styles['commit-hash']}>{c.hash.substring(0, 7)}</span>
                                                    </div>
                                                </div>
                                            </div>

                                            {activeCommitHash === c.hash && (
                                                <div style={{ display: 'flex' }}>
                                                    <div style={{ width: paddingWidth, flexShrink: 0 }} />
                                                    <div className={styles['commit-files-wrapper']} style={{ marginLeft: 0, marginTop: '2px', marginBottom: '4px' }}>
                                                        {(commitFilesLoading || loadedCommitHash !== c.hash) ? (
                                                            <div style={{ height: '32px', display: 'flex', alignItems: 'center', opacity: 0.6, fontSize: '11px', padding: '0 12px' }}>
                                                                <i className="codicon codicon-loading codicon-modifier-spin" style={{ marginRight: '6px' }} /> 加载变动文件...
                                                            </div>
                                                        ) : (
                                                            <ul className={styles['file-list']} style={{ margin: 0, padding: '2px 0' }}>
                                                                {commitFiles.map((item, idx) => {
                                                                    const parts = item.file.split('/');
                                                                    const fileName = parts.pop();
                                                                    const dirPath = parts.length > 0 ? parts.join('/') : '';
                                                                    return (
                                                                        <li key={idx} className={`${styles['file-item']} ${activeFile === item.file ? styles['active'] : ''}`} style={{ height: '22px', display: 'flex', alignItems: 'center', boxSizing: 'border-box' }} title={item.file} onClick={() => { setActiveFile(item.file); vscode.postMessage({ command: 'diffCommitFile', file: item.file, hash: activeCommitHash, parentHash: activeCommitParentHash, status: item.status }); }} onContextMenu={(e) => { e.preventDefault(); setActiveFile(item.file); const safeX = Math.min(e.clientX, window.innerWidth - 220); const safeY = Math.min(e.clientY, window.innerHeight - 250); setContextMenu({ visible: true, x: safeX, y: safeY, file: item, listType: 'history' }); }}>
                                                                            {getFileIcon(fileName || '')}
                                                                            <div className={styles['file-name']}>{fileName}</div>
                                                                            {dirPath && <div className={styles['file-dir']}>{dirPath}</div>}
                                                                            <div style={{ flex: 1 }}></div>
                                                                            <div className={styles['file-actions']} onClick={(e) => e.stopPropagation()}>
                                                                                <button className={styles['action-btn']} title="打开文件" onClick={() => vscode.postMessage({ command: 'open', file: item.file })}><i className="codicon codicon-go-to-file" /></button>
                                                                            </div>
                                                                            <div className={`${styles['status-badge']} ${getStatusClass(item.status)}`}>{getStatusText(item.status)}</div>
                                                                        </li>
                                                                    );
                                                                })}
                                                            </ul>
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                        </li>
                                    );
                                })}
                                {displayCount < processedCommits.length && (
                                    <div style={{ textAlign: 'center', padding: '10px', color: 'var(--vscode-descriptionForeground)' }}>
                                        <i className="codicon codicon-loading codicon-modifier-spin" />
                                    </div>
                                )}
                            </ul>
                        </div>
                    )
                )}
            </div>
        </div>
    );
}