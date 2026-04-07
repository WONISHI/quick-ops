import { useState, useEffect, useRef, useMemo } from 'react';
import { vscode } from '../utils/vscode';
import styles from '../assets/css/GitApp.module.css';

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faRotateRight, faArrowDown, faArrowUp, faCheck, faChevronDown, faChevronRight, faSpinner, faPlus, faMinus, faRotateLeft, faFolderOpen, faCopy } from '@fortawesome/free-solid-svg-icons';
import { faImage, faCode, faFile } from '@fortawesome/free-solid-svg-icons';
import { faMarkdown, faHtml5, faCss3Alt, faVuejs, faJs, faGithub, faGitlab } from '@fortawesome/free-brands-svg-icons';

interface GitFile { status: string; file: string; }
interface GraphCommit { hash: string; parents?: string[]; author: string; email?: string; message: string; timestamp?: number; }

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
    let icon = faGitlab;
    if (cleanUrl.includes('github.com')) { platform = 'GitHub'; icon = faGithub; }
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
            let outIdx = outgoingLanes.indexOf(p);
            if (outIdx === -1) {
                outIdx = outgoingLanes.findIndex(l => l === null);
                if (outIdx !== -1) outgoingLanes[outIdx] = p;
                else {
                    outIdx = outgoingLanes.length;
                    outgoingLanes.push(p);
                }
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
    const [hasMoreCommits, setHasMoreCommits] = useState(true);
    const [isGraphLoading, setIsGraphLoading] = useState(true);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [remoteUrl, setRemoteUrl] = useState<string>('');

    const [activeCommitHash, setActiveCommitHash] = useState<string | null>(null);
    const [loadedCommitHash, setLoadedCommitHash] = useState<string | null>(null);
    const [activeCommitParentHash, setActiveCommitParentHash] = useState<string | undefined>();
    const [commitFiles, setCommitFiles] = useState<GitFile[]>([]);
    const [commitFilesLoading, setCommitFilesLoading] = useState(false);

    const [hoverInfo, setHoverInfo] = useState<{ commit: GraphCommit, x: number, y: number } | null>(null);
    const hoverTimeoutRef = useRef<any>(null);

    // 🌟 1. 新增：右键菜单状态
    const [contextMenu, setContextMenu] = useState<{ visible: boolean, x: number, y: number, file: GitFile, listType: 'staged' | 'unstaged' | 'history' } | null>(null);

    const processedCommits = useMemo(() => processGraphCommits(graphCommits), [graphCommits]);

    useEffect(() => {
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
                setHasMoreCommits(commits.length >= 30);
                setIsGraphLoading(false);
            } else if (msg.type === 'moreCommitsData') {
                const newCommits = msg.commits || [];
                setGraphCommits(prev => [...prev, ...newCommits]);
                setHasMoreCommits(newCommits.length >= 30);
                setIsLoadingMore(false);
            } else if (msg.type === 'commitFilesData') {
                setCommitFiles(msg.files || []);
                setActiveCommitParentHash(msg.parentHash);
                setLoadedCommitHash(msg.hash);
                setCommitFilesLoading(false);
            } else if (msg.type === 'error') {
                setLoading(false);
                setIsGraphLoading(false);
                setIsLoadingMore(false);
                setCommitFilesLoading(false);
            }
        };
        window.addEventListener('message', handleMsg);

        // 🌟 2. 监听全局点击，点击空白处自动关闭右键菜单
        const closeContextMenu = () => setContextMenu(null);
        window.addEventListener('click', closeContextMenu);

        return () => {
            window.removeEventListener('message', handleMsg);
            window.removeEventListener('click', closeContextMenu);
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
        // 🌟 修改点：立马清除并隐藏，不再有 2000ms 延迟
        clearTimeout(hoverTimeoutRef.current);
        setHoverInfo(null);
    };

    const handleCommit = () => {
        if (!commitMsg.trim()) return;
        setLoading(true);
        vscode.postMessage({ command: 'commit', message: commitMsg });
        setCommitMsg('');
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
            case 'ts': case 'tsx': return <FontAwesomeIcon icon={faJs} className={styles['file-icon']} style={{ color: '#3178c6' }} />;
            case 'js': case 'jsx': return <FontAwesomeIcon icon={faJs} className={styles['file-icon']} style={{ color: '#f1e05a' }} />;
            case 'vue': return <FontAwesomeIcon icon={faVuejs} className={styles['file-icon']} style={{ color: '#41b883' }} />;
            case 'css': case 'less': case 'scss': return <FontAwesomeIcon icon={faCss3Alt} className={styles['file-icon']} style={{ color: '#264de4' }} />;
            case 'html': return <FontAwesomeIcon icon={faHtml5} className={styles['file-icon']} style={{ color: '#e34c26' }} />;
            case 'json': return <FontAwesomeIcon icon={faCode} className={styles['file-icon']} style={{ color: '#cbcb41' }} />;
            case 'md': return <FontAwesomeIcon icon={faMarkdown} className={styles['file-icon']} style={{ color: '#4daafc' }} />;
            case 'png': case 'jpg': case 'svg': return <FontAwesomeIcon icon={faImage} className={styles['file-icon']} style={{ color: '#a074c4' }} />;
            default: return <FontAwesomeIcon icon={faFile} className={styles['file-icon']} style={{ color: 'var(--vscode-descriptionForeground)' }} />;
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
                        <li
                            key={idx}
                            className={`${styles['file-item']} ${activeFile === item.file ? styles['active'] : ''}`}
                            title={item.file}
                            onClick={() => {
                                setActiveFile(item.file);
                                if (listType === 'history') {
                                    vscode.postMessage({ command: 'diffCommitFile', file: item.file, hash: activeCommitHash, parentHash: activeCommitParentHash, status: item.status });
                                } else {
                                    vscode.postMessage({ command: 'diff', file: item.file, status: item.status });
                                }
                            }}
                            // 🌟 3. 拦截右键点击事件
                            onContextMenu={(e) => {
                                e.preventDefault();
                                setActiveFile(item.file);
                                // 防止菜单越界
                                const safeX = Math.min(e.clientX, window.innerWidth - 200);
                                const safeY = Math.min(e.clientY, window.innerHeight - 200);
                                setContextMenu({ visible: true, x: safeX, y: safeY, file: item, listType });
                            }}
                        >
                            {getFileIcon(fileName || '')}
                            <div className={styles['file-name']}>{fileName}</div>
                            <div className={styles['file-dir']}>{dirPath}</div>
                            <div className={styles['file-actions']} onClick={(e) => e.stopPropagation()}>
                                <button className={styles['action-btn']} title="打开文件" onClick={() => vscode.postMessage({ command: 'open', file: item.file })}>
                                    <FontAwesomeIcon icon={faFolderOpen} />
                                </button>
                                {listType !== 'history' && (
                                    <>
                                        <button className={styles['action-btn']} title="放弃更改" onClick={() => vscode.postMessage({ command: 'discard', file: item.file, status: item.status })}>
                                            <FontAwesomeIcon icon={faRotateLeft} />
                                        </button>
                                        {listType === 'staged' ? (
                                            <button className={styles['action-btn']} title="取消暂存更改" onClick={() => vscode.postMessage({ command: 'unstage', file: item.file })}>
                                                <FontAwesomeIcon icon={faMinus} />
                                            </button>
                                        ) : (
                                            <button className={styles['action-btn']} title="暂存更改" onClick={() => vscode.postMessage({ command: 'stage', file: item.file, status: item.status })}>
                                                <FontAwesomeIcon icon={faPlus} />
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
        if (target.scrollHeight - target.scrollTop <= target.clientHeight + 20) {
            if (hasMoreCommits && !isLoadingMore && graphCommits.length > 0) {
                setIsLoadingMore(true);
                const lastCommit = graphCommits[graphCommits.length - 1];
                vscode.postMessage({ command: 'loadMoreCommits', ref: lastCommit.hash });
            }
        }
    };

    return (
        <div className={styles['git-sidebar']}>
            {/* 🌟 4. 全局渲染右键菜单与透明遮罩 */}
            {contextMenu && contextMenu.visible && (
                <>
                    {/* 隐形遮罩层，拦截全局点击和右键，实现“点击其他地方必定关闭” */}
                    <div
                        className={styles['context-menu-backdrop']}
                        onClick={() => setContextMenu(null)}
                        onContextMenu={(e) => { e.preventDefault(); setContextMenu(null); }}
                    />

                    {/* 右键菜单本体 */}
                    <div
                        className={styles['context-menu']}
                        style={{ left: contextMenu.x, top: contextMenu.y }}
                    >
                        <div className={styles['context-menu-item']} onClick={() => {
                            if (contextMenu.listType === 'history') {
                                vscode.postMessage({ command: 'diffCommitFile', file: contextMenu.file.file, hash: activeCommitHash, parentHash: activeCommitParentHash, status: contextMenu.file.status });
                            } else {
                                vscode.postMessage({ command: 'diff', file: contextMenu.file.file, status: contextMenu.file.status });
                            }
                            setContextMenu(null);
                        }}>打开更改</div>

                        <div className={styles['context-menu-item']} onClick={() => {
                            vscode.postMessage({ command: 'open', file: contextMenu.file.file });
                            setContextMenu(null);
                        }}>打开文件</div>

                        {contextMenu.listType !== 'history' && (
                            <div className={styles['context-menu-item']} onClick={() => {
                                vscode.postMessage({ command: 'discard', file: contextMenu.file.file, status: contextMenu.file.status });
                                setContextMenu(null);
                            }}>放弃更改</div>
                        )}

                        {contextMenu.listType !== 'history' && (
                            <div className={styles['context-menu-item']} onClick={() => {
                                if (contextMenu.listType === 'staged') {
                                    vscode.postMessage({ command: 'unstage', file: contextMenu.file.file });
                                } else {
                                    vscode.postMessage({ command: 'stage', file: contextMenu.file.file, status: contextMenu.file.status });
                                }
                                setContextMenu(null);
                            }}>{contextMenu.listType === 'staged' ? '取消暂存更改' : '暂存更改'}</div>
                        )}

                        <div className={styles['context-menu-divider']}></div>

                        <div className={styles['context-menu-item']} onClick={() => {
                            vscode.postMessage({ command: 'ignore', file: contextMenu.file.file });
                            setContextMenu(null);
                        }}>添加到 .gitignore</div>

                        <div className={styles['context-menu-item']} onClick={() => {
                            vscode.postMessage({ command: 'reveal', file: contextMenu.file.file });
                            setContextMenu(null);
                        }}>在访达/资源管理器中显示</div>
                    </div>
                </>
            )}

            {/* 原有的 Hover Widget */}
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
                    <div className={styles['hover-message']}>{hoverInfo.commit.message}</div>
                    <div className={styles['hover-divider']}></div>
                    <div className={styles['hover-footer']}>
                        <span className={styles['hover-action-btn']} onClick={() => vscode.postMessage({ command: 'copy', text: hoverInfo.commit.hash })} title="复制 Hash">
                            <FontAwesomeIcon icon={faCopy} /> {hoverInfo.commit.hash.substring(0, 7)}
                        </span>
                        {remoteUrl && parseRemoteInfo(remoteUrl, hoverInfo.commit.hash) && (
                            <>
                                <span className={styles['hover-separator']}>|</span>
                                <span className={styles['hover-action-btn']} onClick={() => vscode.postMessage({ command: 'openExternal', url: parseRemoteInfo(remoteUrl, hoverInfo.commit.hash)!.url })}>
                                    <FontAwesomeIcon icon={parseRemoteInfo(remoteUrl, hoverInfo.commit.hash)!.icon} /> 在 {parseRemoteInfo(remoteUrl, hoverInfo.commit.hash)!.platform} 上打开
                                </span>
                            </>
                        )}
                    </div>
                </div>
            )}

            <div className={styles['git-toolbar']}>
                <span>Git 管理 <span style={{ textTransform: 'none', opacity: 0.7 }}>({branch})</span></span>
                <div className={styles['git-actions']}>
                    <button className={styles['icon-btn']} title="刷新" onClick={() => vscode.postMessage({ command: 'refresh' })}><FontAwesomeIcon icon={faRotateRight} /></button>
                    <button className={styles['icon-btn']} title="拉取 (Pull)" onClick={() => vscode.postMessage({ command: 'pull' })}><FontAwesomeIcon icon={faArrowDown} /></button>
                    <button className={styles['icon-btn']} title="推送 (Push)" onClick={() => vscode.postMessage({ command: 'push' })}><FontAwesomeIcon icon={faArrowUp} /></button>
                </div>
            </div>

            <div className={styles['commit-box']}>
                <textarea className={styles['commit-input']} placeholder="消息 (按 Ctrl+Enter 提交)" value={commitMsg} onChange={(e) => setCommitMsg(e.target.value)} onKeyDown={(e) => { if (e.ctrlKey && e.key === 'Enter') handleCommit(); }} />
                <button className={styles['commit-btn']} disabled={loading || (!commitMsg.trim() || (stagedFiles.length === 0 && unstagedFiles.length === 0))} onClick={handleCommit} title={stagedFiles.length === 0 ? "暂存所有文件并提交" : "提交已暂存的更改"}>
                    {loading ? <FontAwesomeIcon icon={faSpinner} spin style={{ marginRight: '6px' }} /> : <FontAwesomeIcon icon={faCheck} style={{ marginRight: '6px' }} />} 提交 (Commit)
                </button>
            </div>

            <div className={styles['changes-scroll-area']}>
                {stagedFiles.length > 0 && (
                    <div className={styles['changes-section']}>
                        <div className={styles['changes-header']} onClick={() => setIsStagedOpen(!isStagedOpen)}>
                            <FontAwesomeIcon icon={isStagedOpen ? faChevronDown : faChevronRight} style={{ fontSize: '10px', width: '12px' }} /> 暂存的更改 <span className={styles['badge']}>{stagedFiles.length}</span>
                        </div>
                        {isStagedOpen && renderFileList(stagedFiles, 'staged')}
                    </div>
                )}

                <div className={styles['changes-section']}>
                    <div className={styles['changes-header']} onClick={() => setIsUnstagedOpen(!isUnstagedOpen)}>
                        <FontAwesomeIcon icon={isUnstagedOpen ? faChevronDown : faChevronRight} style={{ fontSize: '10px', width: '12px' }} /> 更改 <span className={styles['badge']}>{unstagedFiles.length}</span>
                    </div>
                    {isUnstagedOpen && (
                        unstagedFiles.length === 0 && stagedFiles.length === 0 ? <div className={styles['empty-message']}>没有需要提交的更改</div> : renderFileList(unstagedFiles, 'unstaged')
                    )}
                </div>
            </div>

            <div className={styles['git-graph-section']}>
                <div className={styles['changes-header']} onClick={() => setIsGraphOpen(!isGraphOpen)}>
                    <FontAwesomeIcon icon={isGraphOpen ? faChevronDown : faChevronRight} style={{ fontSize: '10px', width: '12px' }} /> 图形
                </div>
                {isGraphOpen && (
                    isGraphLoading ? (
                        <div style={{ textAlign: 'center', padding: '30px 10px', color: 'var(--vscode-descriptionForeground)', fontSize: '12px', opacity: 0.8 }}>
                            <FontAwesomeIcon icon={faSpinner} spin style={{ marginRight: '8px' }} /> 正在加载历史记录...
                        </div>
                    ) : processedCommits.length === 0 ? (
                        <div className={styles['git-graph-fallback']}>暂无记录</div>
                    ) : (
                        <div className={styles['git-graph-view']} onScroll={handleGraphScroll}>
                            <ul className={styles['commit-timeline']}>
                                {processedCommits.map(c => {
                                    const svgWidth = Math.max(1, c.maxLane) * LANE_WIDTH + 8;
                                    return (
                                        <li key={c.hash} className={styles['commit-log-item']}>
                                            <div className={styles['commit-row']}
                                                onClick={() => toggleCommit(c.hash)}
                                                onMouseEnter={(e) => handleMouseEnter(e, c as any)}
                                                onMouseLeave={handleMouseLeave}
                                            >
                                                <svg width={svgWidth} height={ROW_HEIGHT} style={{ flexShrink: 0 }}>
                                                    {c.paths.map((p, idx) => {
                                                        let startY = 0, endY = ROW_HEIGHT;
                                                        if (p.type === 'spawn') startY = CY;
                                                        if (p.type === 'merge') endY = CY;

                                                        const startX = p.from * LANE_WIDTH + 7;
                                                        const endX = p.to * LANE_WIDTH + 7;

                                                        let d = '';
                                                        if (startX === endX) {
                                                            d = `M ${startX} ${startY} L ${endX} ${endY}`;
                                                        } else {
                                                            const cp1Y = startY + (endY - startY) / 2;
                                                            const cp2Y = startY + (endY - startY) / 2;
                                                            d = `M ${startX} ${startY} C ${startX} ${cp1Y}, ${endX} ${cp2Y}, ${endX} ${endY}`;
                                                        }
                                                        return <path key={idx} d={d} stroke={p.color} strokeWidth="2" fill="none" />;
                                                    })}
                                                    <circle cx={c.laneIndex * LANE_WIDTH + 7} cy={CY} r="4" fill={COLORS[c.laneIndex % COLORS.length]} stroke="var(--vscode-editor-background)" strokeWidth="2" />
                                                </svg>
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
                                                    <svg width={svgWidth} style={{ flexShrink: 0 }}>
                                                        {c.outgoingLanes.map((hash, i) => hash ? <line key={i} x1={i * LANE_WIDTH + 7} y1={0} x2={i * LANE_WIDTH + 7} y2="100%" stroke={COLORS[i % COLORS.length]} strokeWidth="2" /> : null)}
                                                    </svg>
                                                    <div className={styles['commit-files-wrapper']}>
                                                        {(commitFilesLoading || loadedCommitHash !== c.hash) ? (
                                                            <div style={{ opacity: 0.6, fontSize: '11px', padding: '6px 12px' }}>
                                                                <FontAwesomeIcon icon={faSpinner} spin /> 加载变动文件...
                                                            </div>
                                                        ) : renderFileList(commitFiles, 'history')}
                                                    </div>
                                                </div>
                                            )}
                                        </li>
                                    );
                                })}
                                {isLoadingMore && (
                                    <div style={{ textAlign: 'center', padding: '10px', color: 'var(--vscode-descriptionForeground)' }}>
                                        <FontAwesomeIcon icon={faSpinner} spin />
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