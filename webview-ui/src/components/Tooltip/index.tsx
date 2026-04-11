import React, { useState, useEffect, useRef, useLayoutEffect, useMemo } from 'react';
import { vscode } from '../../utils/vscode';
import styles from '../assets/css/GitApp.module.css';

// 引入 VS Code 官方图标库 CSS
import '@vscode/codicons/dist/codicon.css';

// 引入 FontAwesome 彩色图标
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faImage, faCode, faFile } from '@fortawesome/free-solid-svg-icons';
import { faMarkdown, faHtml5, faCss3Alt, faVuejs, faJs } from '@fortawesome/free-brands-svg-icons';

interface GitFile { status: string; file: string; }
interface GraphCommit { hash: string; parents?: string[]; author: string; email?: string; message: string; timestamp?: number; refs?: string; }
interface TreeNode { name: string; fullPath: string; isDirectory: boolean; children: TreeNode[]; file?: GitFile; }

const COLORS = ['#007acc', '#f14c4c', '#89d185', '#cca700', '#c586c0', '#4fc1ff'];
const LANE_WIDTH = 14;
const ROW_HEIGHT = 24;
const CY = 12;

// ==========================================
// 🌟 抽离并加强的自定义 Tooltip 组件
// ==========================================
export type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right';
export type TooltipTrigger = 'hover' | 'click';
export type TooltipAlign = 'start' | 'center' | 'end';

export interface TooltipProps {
    content: React.ReactNode;
    children: React.ReactElement<any>;
    placement?: TooltipPlacement;
    trigger?: TooltipTrigger;
    align?: TooltipAlign;
    showArrow?: boolean;
}

const Tooltip: React.FC<TooltipProps> = ({
    content,
    children,
    placement = 'top',
    trigger = 'hover',
    align = 'center',
    showArrow = true,
}) => {
    const [visible, setVisible] = useState(false);
    const [opacity, setOpacity] = useState(0);
    const [position, setPosition] = useState({ left: -9999, top: -9999 });
    const [arrowStyle, setArrowStyle] = useState<React.CSSProperties>({});

    const timerRef = useRef<any>(null);
    const tooltipRef = useRef<HTMLDivElement>(null);
    const targetRef = useRef<HTMLElement | null>(null);

    const showTooltip = () => {
        if (!content) return;
        if (trigger === 'hover') {
            clearTimeout(timerRef.current);
            timerRef.current = setTimeout(() => setVisible(true), 300);
        } else {
            setVisible(true);
        }
    };

    const hideTooltip = () => {
        clearTimeout(timerRef.current);
        setVisible(false);
        setOpacity(0);
    };

    const toggleTooltip = () => {
        if (visible) hideTooltip();
        else showTooltip();
    };

    useEffect(() => {
        const handleOutsideClick = (e: MouseEvent) => {
            if (
                trigger === 'click' &&
                visible &&
                tooltipRef.current && !tooltipRef.current.contains(e.target as Node) &&
                targetRef.current && !targetRef.current.contains(e.target as Node)
            ) {
                hideTooltip();
            }
        };

        const handleScrollOrResize = () => {
            if (visible) hideTooltip();
        };

        document.addEventListener('mousedown', handleOutsideClick);
        window.addEventListener('wheel', handleScrollOrResize, { passive: true });
        window.addEventListener('resize', handleScrollOrResize);

        return () => {
            document.removeEventListener('mousedown', handleOutsideClick);
            window.removeEventListener('wheel', handleScrollOrResize);
            window.removeEventListener('resize', handleScrollOrResize);
        };
    }, [visible, trigger]);

    useLayoutEffect(() => {
        if (visible && tooltipRef.current && targetRef.current && opacity === 0) {
            const target = targetRef.current.getBoundingClientRect();
            const tooltip = tooltipRef.current.getBoundingClientRect();
            const gap = showArrow ? 8 : 4;

            let actualPlacement = placement;

            if (placement === 'top' && target.top - tooltip.height - gap < 0 && window.innerHeight - target.bottom > tooltip.height + gap) {
                actualPlacement = 'bottom';
            }
            else if (placement === 'bottom' && target.bottom + tooltip.height + gap > window.innerHeight && target.top > tooltip.height + gap) {
                actualPlacement = 'top';
            }
            else if (placement === 'left' && target.left - tooltip.width - gap < 0 && window.innerWidth - target.right > tooltip.width + gap) {
                actualPlacement = 'right';
            }
            else if (placement === 'right' && target.right + tooltip.width + gap > window.innerWidth && target.left > tooltip.width + gap) {
                actualPlacement = 'left';
            }

            let x = 0;
            let y = 0;

            if (actualPlacement === 'top' || actualPlacement === 'bottom') {
                y = actualPlacement === 'top' ? target.top - tooltip.height - gap : target.bottom + gap;
                if (align === 'start') x = target.left;
                else if (align === 'end') x = target.right - tooltip.width;
                else x = target.left + target.width / 2 - tooltip.width / 2;
            } else {
                x = actualPlacement === 'left' ? target.left - tooltip.width - gap : target.right + gap;
                if (align === 'start') y = target.top;
                else if (align === 'end') y = target.bottom - tooltip.height;
                else y = target.top + target.height / 2 - tooltip.height / 2;
            }

            const padding = 8;
            if (x < padding) x = padding;
            if (x + tooltip.width > window.innerWidth - padding) x = window.innerWidth - padding - tooltip.width;
            if (y < padding) y = padding;
            if (y + tooltip.height > window.innerHeight - padding) y = window.innerHeight - padding - tooltip.height;

            setPosition({ left: x, top: y });

            if (showArrow) {
                const aStyle: React.CSSProperties = {
                    position: 'absolute',
                    width: '8px',
                    height: '8px',
                    backgroundColor: 'var(--vscode-editorHoverWidget-background)',
                };
                const arrowOffset = -4;

                if (actualPlacement === 'top' || actualPlacement === 'bottom') {
                    let arrowX = (target.left + target.width / 2) - x;
                    arrowX = Math.max(8, Math.min(tooltip.width - 8, arrowX));

                    aStyle.left = arrowX;
                    aStyle.transform = 'translateX(-50%) rotate(45deg)';

                    if (actualPlacement === 'top') {
                        aStyle.bottom = arrowOffset;
                        aStyle.borderBottom = '1px solid var(--vscode-editorHoverWidget-border)';
                        aStyle.borderRight = '1px solid var(--vscode-editorHoverWidget-border)';
                    } else {
                        aStyle.top = arrowOffset;
                        aStyle.borderTop = '1px solid var(--vscode-editorHoverWidget-border)';
                        aStyle.borderLeft = '1px solid var(--vscode-editorHoverWidget-border)';
                    }
                } else {
                    let arrowY = (target.top + target.height / 2) - y;
                    arrowY = Math.max(8, Math.min(tooltip.height - 8, arrowY));

                    aStyle.top = arrowY;
                    aStyle.transform = 'translateY(-50%) rotate(45deg)';

                    if (actualPlacement === 'left') {
                        aStyle.right = arrowOffset;
                        aStyle.borderTop = '1px solid var(--vscode-editorHoverWidget-border)';
                        aStyle.borderRight = '1px solid var(--vscode-editorHoverWidget-border)';
                    } else {
                        aStyle.left = arrowOffset;
                        aStyle.borderBottom = '1px solid var(--vscode-editorHoverWidget-border)';
                        aStyle.borderLeft = '1px solid var(--vscode-editorHoverWidget-border)';
                    }
                }
                setArrowStyle(aStyle);
            }

            requestAnimationFrame(() => setOpacity(1));
        }
    }, [visible, opacity, placement, align, showArrow]);

    const childProps = children.props as any;

    return (
        <>
            {React.cloneElement(children, {
                ref: (node: HTMLElement) => {
                    targetRef.current = node;
                    if (typeof childProps.ref === 'function') childProps.ref(node);
                    else if (childProps.ref) childProps.ref.current = node;
                },
                onMouseEnter: (e: React.MouseEvent) => {
                    if (trigger === 'hover') showTooltip();
                    if (childProps.onMouseEnter) childProps.onMouseEnter(e);
                },
                onMouseLeave: (e: React.MouseEvent) => {
                    if (trigger === 'hover') hideTooltip();
                    if (childProps.onMouseLeave) childProps.onMouseLeave(e);
                },
                onClick: (e: React.MouseEvent) => {
                    if (trigger === 'click') toggleTooltip();
                    if (childProps.onClick) childProps.onClick(e);
                },
                title: undefined
            } as any)}

            {visible && (
                <div
                    ref={tooltipRef}
                    style={{
                        position: 'fixed',
                        top: position.top,
                        left: position.left,
                        opacity: opacity,
                        transition: 'opacity 0.15s ease-in-out',
                        backgroundColor: 'var(--vscode-editorHoverWidget-background)',
                        border: '1px solid var(--vscode-editorHoverWidget-border)',
                        color: 'var(--vscode-editorHoverWidget-foreground)',
                        padding: '4px 8px',
                        borderRadius: '4px',
                        fontSize: '12px',
                        whiteSpace: 'nowrap',
                        zIndex: 100000,
                        pointerEvents: 'none',
                        boxShadow: '0 2px 8px var(--vscode-widget-shadow)',
                        boxSizing: 'border-box'
                    }}
                >
                    {content}
                    {showArrow && <div style={arrowStyle} />}
                </div>
            )}
        </>
    );
};

// ==========================================
// 🌟 1:1 完美复刻 vscode-git-graph 底层引擎
// ==========================================
const NULL_VERTEX_ID = -1;

interface Point { x: number; y: number; }
interface Line { p1: Point; p2: Point; lockedFirst: boolean; }
interface UnavailablePoint { connectsTo: Vertex | null; onBranch: Branch; }

class Branch {
    public colour: number;
    public lines: Line[] = [];
    constructor(colour: number) {
        this.colour = colour
    }
    addLine(p1: Point, p2: Point, lockedFirst: boolean) {
        this.lines.push({ p1, p2, lockedFirst });
    }
}

class Vertex {
    public id: number;
    public x: number = 0;
    private children: Vertex[] = [];
    private parents: Vertex[] = [];
    private nextParent: number = 0;
    private onBranch: Branch | null = null;
    private nextX: number = 0;
    private connections: UnavailablePoint[] = [];

    constructor(id: number) {
        this.id = id;
    }

    addChild(v: Vertex) { this.children.push(v); }
    addParent(v: Vertex) { this.parents.push(v); }
    getParents() { return this.parents; }
    getNextParent(): Vertex | null { return this.nextParent < this.parents.length ? this.parents[this.nextParent] : null; }
    registerParentProcessed() { this.nextParent++; }
    isMerge() { return this.parents.length > 1; }
    addToBranch(b: Branch, x: number) { if (!this.onBranch) { this.onBranch = b; this.x = x; } }
    isNotOnBranch() { return this.onBranch === null; }
    getBranch() { return this.onBranch; }
    getPoint(): Point { return { x: this.x, y: this.id }; }
    getNextPoint(): Point { return { x: this.nextX, y: this.id }; }
    getPointConnectingTo(v: Vertex | null, b: Branch) {
        for (let i = 0; i < this.connections.length; i++) {
            if (this.connections[i] && this.connections[i].connectsTo === v && this.connections[i].onBranch === b) return { x: i, y: this.id };
        }
        return null;
    }
    registerUnavailablePoint(x: number, v: Vertex | null, b: Branch) {
        if (x === this.nextX) {
            this.nextX = x + 1;
            this.connections[x] = { connectsTo: v, onBranch: b };
        }
    }
}

function buildGraphEngine(commits: GraphCommit[]) {
    const vertices = commits.map((_, i) => new Vertex(i));
    const commitLookup: Record<string, number> = {};
    commits.forEach((c, i) => commitLookup[c.hash] = i);

    const nullVertex = new Vertex(NULL_VERTEX_ID);

    // 构建父子关联
    commits.forEach((c, i) => {
        (c.parents || []).forEach(pHash => {
            if (commitLookup[pHash] !== undefined) {
                vertices[i].addParent(vertices[commitLookup[pHash]]);
                vertices[commitLookup[pHash]].addChild(vertices[i]);
            } else {
                vertices[i].addParent(nullVertex);
            }
        });
    });

    const branches: Branch[] = [];
    const availableColours: number[] = [];

    const getAvailableColour = (startAt: number) => {
        for (let i = 0; i < availableColours.length; i++) {
            if (startAt > availableColours[i]) return i;
        }
        availableColours.push(0);
        return availableColours.length - 1;
    };

    const determinePath = (startAt: number) => {
        let i = startAt;
        let vertex = vertices[i], parentVertex = vertex.getNextParent(), curVertex;
        let lastPoint = vertex.isNotOnBranch() ? vertex.getNextPoint() : vertex.getPoint(), curPoint;

        if (parentVertex !== null && parentVertex.id !== NULL_VERTEX_ID && vertex.isMerge() && !vertex.isNotOnBranch() && !parentVertex.isNotOnBranch()) {
            let foundPointToParent = false, parentBranch = parentVertex.getBranch()!;
            for (i = startAt + 1; i < vertices.length; i++) {
                curVertex = vertices[i];
                curPoint = curVertex.getPointConnectingTo(parentVertex, parentBranch);
                if (curPoint !== null) foundPointToParent = true;
                else curPoint = curVertex.getNextPoint();

                parentBranch.addLine(lastPoint, curPoint, !foundPointToParent && curVertex !== parentVertex ? lastPoint.x < curPoint.x : true);
                curVertex.registerUnavailablePoint(curPoint.x, parentVertex, parentBranch);
                lastPoint = curPoint;

                if (foundPointToParent) {
                    vertex.registerParentProcessed();
                    break;
                }
            }
        } else {
            let branch = new Branch(getAvailableColour(startAt));
            vertex.addToBranch(branch, lastPoint.x);
            vertex.registerUnavailablePoint(lastPoint.x, vertex, branch);
            for (i = startAt + 1; i < vertices.length; i++) {
                curVertex = vertices[i];
                curPoint = parentVertex === curVertex && !parentVertex.isNotOnBranch() ? curVertex.getPoint() : curVertex.getNextPoint();
                branch.addLine(lastPoint, curPoint, lastPoint.x < curPoint.x);
                curVertex.registerUnavailablePoint(curPoint.x, parentVertex, branch);
                lastPoint = curPoint;

                if (parentVertex === curVertex) {
                    vertex.registerParentProcessed();
                    let parentVertexOnBranch = !parentVertex.isNotOnBranch();
                    parentVertex.addToBranch(branch, curPoint.x);
                    vertex = parentVertex;
                    parentVertex = vertex.getNextParent();
                    if (parentVertex === null || parentVertexOnBranch) break;
                }
            }
            if (i === vertices.length && parentVertex !== null && parentVertex.id === NULL_VERTEX_ID) {
                vertex.registerParentProcessed();
            }
            branches.push(branch);
            availableColours[branch.colour] = i;
        }
    };

    let idx = 0;
    while (idx < vertices.length) {
        if (vertices[idx].getNextParent() !== null || vertices[idx].isNotOnBranch()) {
            determinePath(idx);
        } else {
            idx++;
        }
    }

    return { vertices, branches };
}

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
    const [stagedFiles, setStagedFiles] = useState<GitFile[]>([]);
    const [unstagedFiles, setUnstagedFiles] = useState<GitFile[]>([]);
    const [branch, setBranch] = useState('');
    const [commitMsg, setCommitMsg] = useState('');
    const [loading, setLoading] = useState(false);
    const [activeFile, setActiveFile] = useState<string | null>(null);

    const [isChangesOpen, setIsChangesOpen] = useState(true);
    const [isGraphOpen, setIsGraphOpen] = useState(true);

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

    const [selectedGraphFilter, setSelectedGraphFilter] = useState('全部分支');

    // 🌟 新增：用于跟踪过滤器变化，触发闪烁动画
    const filterRef = useRef('全部分支');
    const [flashBranchBtn, setFlashBranchBtn] = useState(false);

    const [hoverInfo, setHoverInfo] = useState<{ commit: GraphCommit, x: number, y: number, position: 'top' | 'bottom' } | null>(null);
    const hoverTimeoutRef = useRef<any>(null);

    const [contextMenu, setContextMenu] = useState<{ visible: boolean, x: number, y: number, file: GitFile, listType: 'staged' | 'unstaged' | 'history' | 'compare' } | null>(null);

    const graphData = useMemo(() => buildGraphEngine(graphCommits), [graphCommits]);

    const yPositions = useMemo(() => {
        const positions: number[] = [];
        let currentY = 0;
        for (let i = 0; i < graphCommits.length; i++) {
            positions.push(currentY);
            currentY += ROW_HEIGHT;

            if (activeCommitHash === graphCommits[i].hash) {
                if (commitFilesLoading || loadedCommitHash !== activeCommitHash) {
                    currentY += 38;
                } else {
                    currentY += 10 + commitFiles.length * 22;
                }
            }
        }
        positions.push(currentY);
        return positions;
    }, [graphCommits, activeCommitHash, commitFilesLoading, loadedCommitHash, commitFiles.length]);

    const renderedHeight = yPositions[Math.min(displayCount, graphCommits.length)] || 0;

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const graphContainerRef = useRef<HTMLDivElement>(null);

    // @FIXME: 
    // @OPTIMIZE: 
    // @error: 
    // @success: 
    // @todo: 
    // @warning: 
    useEffect(() => {
        const canvas = canvasRef.current;
        const container = graphContainerRef.current;
        if (!canvas || !container || graphCommits.length === 0) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;
        const containerWidth = container.clientWidth || 800;

        canvas.width = containerWidth * dpr;
        canvas.height = renderedHeight * dpr;
        ctx.scale(dpr, dpr);

        ctx.clearRect(0, 0, containerWidth, renderedHeight);

        graphData.branches.forEach(branch => {
            const color = COLORS[branch.colour % COLORS.length];
            ctx.beginPath();
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';

            let lastPt: { x: number, y: number } | null = null;
            branch.lines.forEach((line, i) => {
                const x1 = line.p1.x * LANE_WIDTH + 14;
                const y1Base = yPositions[line.p1.y];
                const y1 = y1Base + CY;

                const x2 = line.p2.x * LANE_WIDTH + 14;
                const y2Base = yPositions[line.p2.y];
                const y2 = y2Base + CY;

                if (i === 0 || lastPt?.x !== x1 || lastPt?.y !== y1) {
                    ctx.moveTo(x1, y1);
                }

                if (x1 === x2) {
                    ctx.lineTo(x2, y2);
                } else {
                    const d = 12;
                    if (line.lockedFirst) {
                        const curveEndY = y1Base + ROW_HEIGHT;
                        ctx.bezierCurveTo(x1, y1 + d, x2, curveEndY - d, x2, curveEndY);
                        ctx.lineTo(x2, y2);
                    } else {
                        const curveStartY = y2Base;
                        ctx.lineTo(x1, curveStartY);
                        ctx.bezierCurveTo(x1, curveStartY + d, x2, y2 - d, x2, y2);
                    }
                }
                lastPt = { x: x2, y: y2 };
            });
            ctx.stroke();
        });

        const bgColor = getComputedStyle(document.documentElement).getPropertyValue('--vscode-sideBar-background').trim() || '#252526';

        graphData.vertices.slice(0, displayCount).forEach((v, idx) => {
            const cx = v.getPoint().x * LANE_WIDTH + 14;
            const cy = yPositions[idx] + CY;
            const c = graphCommits[idx];
            const isHead = c.refs?.includes('HEAD');

            ctx.beginPath();
            ctx.arc(cx, cy, 3.5, 0, 2 * Math.PI);

            const vBranch = v.getBranch();
            const dotColor = vBranch ? COLORS[vBranch.colour % COLORS.length] : '#808080';

            if (isHead) {
                ctx.fillStyle = bgColor;
                ctx.lineWidth = 2;
                ctx.strokeStyle = dotColor;
                ctx.stroke();
                ctx.fill();
            } else {
                ctx.fillStyle = dotColor;
                ctx.fill();
            }
        });
    }, [graphData, displayCount, yPositions, renderedHeight, activeCommitHash, isGraphOpen]);

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
                setDisplayCount(100);
                if (msg.graphFilter) {
                    setSelectedGraphFilter(msg.graphFilter);
                    // 🌟 动画逻辑：如果分支确实变了，触发闪烁
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
            window.removeEventListener('resize', () => { });
        };
    }, []);

    const handleMouseEnter = (e: React.MouseEvent, commit: GraphCommit) => {
        const rect = e.currentTarget.getBoundingClientRect();
        clearTimeout(hoverTimeoutRef.current);
        hoverTimeoutRef.current = setTimeout(() => {
            const showAbove = rect.top > window.innerHeight / 2;
            setHoverInfo({
                commit,
                x: Math.min(rect.left + 24, window.innerWidth - 320),
                y: showAbove ? rect.top - 8 : rect.bottom + 4,
                position: showAbove ? 'top' : 'bottom'
            });
        }, 500);
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
        if (textareaRef.current) textareaRef.current.style.height = '28px';
    };

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
                                vscode.postMessage({ command: 'diffBranchFile', file: item.file, targetBranch: compareTarget, baseBranch: compareBase, status: item.status });
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
                                    vscode.postMessage({ command: 'diffBranchFile', file: item.file, targetBranch: compareTarget, baseBranch: compareBase, status: item.status });
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
                            } else if (contextMenu.listType === 'compare') {
                                if (compareTarget && compareBase) {
                                    vscode.postMessage({ command: 'diffBranchFile', file: contextMenu.file.file, targetBranch: compareTarget, baseBranch: compareBase, status: contextMenu.file.status });
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

            {hoverInfo && (
                <div
                    className={styles['commit-hover-widget']}
                    style={{
                        left: hoverInfo.x,
                        ...(hoverInfo.position === 'top' ? { bottom: window.innerHeight - hoverInfo.y } : { top: hoverInfo.y })
                    }}
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

                    <div className={styles['hover-refs']}>
                        {hoverInfo.commit.refs ? (
                            hoverInfo.commit.refs.split(',').map((r: string, i: number) => {
                                const trimmed = r.trim();
                                if (!trimmed) return null;
                                const isHead = trimmed.startsWith('HEAD -> ');
                                const name = isHead ? trimmed.replace('HEAD -> ', '') : trimmed;
                                return <span key={i} className={`${styles['ref-tag']} ${isHead ? styles['ref-head'] : ''}`}>{name}</span>;
                            })
                        ) : (
                            <span className={`${styles['ref-tag']} ${styles['ref-head']}`}>{branch}</span>
                        )}
                    </div>

                    <div className={styles['hover-message']}>{hoverInfo.commit.message}</div>
                    <div className={styles['hover-divider']}></div>
                    <div className={styles['hover-footer']}>
                        <Tooltip content="复制 Hash">
                            <span className={styles['hover-action-btn']} onClick={() => vscode.postMessage({ command: 'copy', text: hoverInfo.commit.hash })}>
                                <i className="codicon codicon-copy" style={{ marginRight: '4px' }} /> {hoverInfo.commit.hash.substring(0, 7)}
                            </span>
                        </Tooltip>

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
                <span>Git 管理 ({branch})</span>
                <div className={styles['git-actions']}>
                    <Tooltip content="拉取 (Pull)">
                        <button className={styles['icon-btn']} onClick={() => vscode.postMessage({ command: 'pull' })}>
                            <i className="codicon codicon-arrow-down" />
                        </button>
                    </Tooltip>
                    <Tooltip content="推送 (Push)">
                        <button className={styles['icon-btn']} onClick={() => vscode.postMessage({ command: 'push' })}>
                            <i className="codicon codicon-arrow-up" />
                        </button>
                    </Tooltip>
                    <Tooltip content={viewMode === 'list' ? '以树状视图查看' : '以列表视图查看'}>
                        <button className={styles['icon-btn']} onClick={() => setViewMode(v => v === 'list' ? 'tree' : 'list')}>
                            <i className={`codicon ${viewMode === 'list' ? 'codicon-list-tree' : 'codicon-list-flat'}`} />
                        </button>
                    </Tooltip>
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
                    style={{
                        resize: 'none',
                        minHeight: '28px',
                        overflowY: 'auto',
                        boxSizing: 'border-box'
                    }}
                />
                <button className={styles['commit-btn']} disabled={loading || (!commitMsg.trim() || (stagedFiles.length === 0 && unstagedFiles.length === 0))} onClick={handleCommit}>
                    {loading ? <i className="codicon codicon-loading codicon-modifier-spin" style={{ marginRight: '6px' }} /> : <i className="codicon codicon-check" style={{ marginRight: '6px' }} />} 提交 (Commit)
                </button>
            </div>

            <div className={styles['changes-scroll-area']} style={{ maxHeight: 'none', overflowY: 'visible', flexShrink: 0 }}>
                <div className={styles['changes-section']}>
                    <div className={styles['changes-header']} onClick={() => setIsChangesOpen(!isChangesOpen)}>
                        <i className={`codicon ${isChangesOpen ? 'codicon-chevron-down' : 'codicon-chevron-right'}`} style={{ fontSize: '14px', width: '16px' }} />
                        更改 <span className={styles['badge']}>{stagedFiles.length + unstagedFiles.length}</span>
                    </div>

                    {isChangesOpen && (
                        <div style={{ maxHeight: '30vh', overflowY: 'auto', paddingBottom: '4px' }}>
                            {stagedFiles.length > 0 && (
                                <div className={styles['changes-section']} style={{ marginLeft: '12px' }}>
                                    <div className={styles['changes-header']} style={{ cursor: 'default' }}>
                                        <i className="codicon codicon-check" style={{ fontSize: '14px', width: '16px' }} />
                                        暂存区 <span className={styles['badge']}>{stagedFiles.length}</span>
                                    </div>
                                    {renderFileList(stagedFiles, 'staged')}
                                </div>
                            )}

                            <div className={styles['changes-section']} style={{ marginLeft: '12px' }}>
                                <div className={styles['changes-header']} style={{ cursor: 'default' }}>
                                    <i className="codicon codicon-file" style={{ fontSize: '14px', width: '16px' }} />
                                    工作区 <span className={styles['badge']}>{unstagedFiles.length}</span>
                                </div>
                                {unstagedFiles.length === 0 && stagedFiles.length === 0 ? (
                                    <div className={styles['empty-message']}>没有需要提交的更改</div>
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
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <i className={`codicon ${isCompareOpen ? 'codicon-chevron-down' : 'codicon-chevron-right'}`} style={{ fontSize: '14px', width: '16px' }} />
                            {compareBase === '文件历史' ? '文件历史' : '对比'}

                            {compareTarget && compareBase && (
                                <span style={{ color: 'var(--vscode-textLink-foreground)', fontSize: '11px', maxWidth: '120px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={compareBase === '文件历史' ? `文件: ${compareTarget}` : `${compareTarget} ↔ ${compareBase}`}>
                                    {compareBase === '文件历史' ? `(${compareTarget})` : `(${compareTarget} ↔ ${compareBase})`}
                                </span>
                            )}
                            <span className={styles['badge']}>{compareCommits.length}</span>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
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
                    </div>
                    {isCompareOpen && (
                        <div style={{ maxHeight: '30vh', overflowY: 'auto', paddingBottom: '4px' }}>
                            {(!compareTarget || !compareBase) ? (
                                <div className={styles['empty-message']}>点击右上角图标选择分支或查看文件历史</div>
                            ) : compareCommits.length === 0 ? (
                                <div className={styles['empty-message']}>没有记录</div>
                            ) : (
                                <ul className={styles['file-list']} style={{ padding: 0, margin: 0 }}>
                                    {compareCommits.map(c => (
                                        <li key={c.hash} style={{ borderBottom: '1px solid var(--vscode-panel-border)', padding: 0 }}>
                                            <div
                                                className={styles['file-item']}
                                                style={{ height: 'auto', padding: '4px 8px', display: 'flex', alignItems: 'flex-start', gap: '8px' }}
                                                onClick={() => toggleCommit(c.hash)}
                                            >
                                                <div style={{
                                                    width: '16px', height: '16px', borderRadius: '50%',
                                                    backgroundColor: 'var(--vscode-button-background, #3168d1)',
                                                    color: 'var(--vscode-button-foreground, #ffffff)',
                                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                    fontSize: '10px', fontWeight: 'bold', flexShrink: 0, marginTop: '2px'
                                                }}>
                                                    {c.author[0].toUpperCase()}
                                                </div>

                                                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                                                    <div style={{ fontSize: '12px', color: 'var(--vscode-foreground)', lineHeight: '1.4', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                        {c.message}
                                                    </div>
                                                </div>
                                            </div>

                                            {activeCommitHash === c.hash && (
                                                <div className={styles['commit-files-wrapper']} style={{ marginLeft: '28px', marginRight: '8px', marginBottom: '4px' }}>
                                                    {(commitFilesLoading || loadedCommitHash !== c.hash) ? (
                                                        <div style={{ height: '24px', display: 'flex', alignItems: 'center', opacity: 0.6, fontSize: '11px' }}>
                                                            <i className="codicon codicon-loading codicon-modifier-spin" style={{ marginRight: '6px' }} /> 加载变动文件...
                                                        </div>
                                                    ) : renderFileList(commitFiles, 'history')}
                                                </div>
                                            )}
                                        </li>
                                    ))}
                                </ul>
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

                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Tooltip content={`筛选分支 (当前: ${selectedGraphFilter})`}>
                            {/* 🌟 动画生效区：将样式切换挂载在这个按钮上 */}
                            <button
                                className={styles['action-btn']}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    // 🌟 告诉后台当前处于什么分支状态
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
                                <i className="codicon codicon-git-branch" />
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
                </div>

                {isGraphOpen && (
                    isGraphLoading ? (
                        <div style={{ textAlign: 'center', padding: '30px 10px', color: 'var(--vscode-descriptionForeground)', fontSize: '12px', opacity: 0.8 }}>
                            <i className="codicon codicon-loading codicon-modifier-spin" style={{ marginRight: '8px' }} /> 正在加载历史记录...
                        </div>
                    ) : graphCommits.length === 0 ? (
                        <div className={styles['git-graph-fallback']}>暂无记录</div>
                    ) : (
                        <div className={styles['graph-scroll-view']} ref={graphContainerRef} onScroll={handleGraphScroll} style={{ position: 'relative', flex: 1, overflowY: 'auto' }}>

                            <canvas
                                ref={canvasRef}
                                style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: `${renderedHeight}px`, pointerEvents: 'none', zIndex: 1 }}
                            />

                            <ul className={styles['commit-timeline']} style={{ position: 'relative', zIndex: 2, margin: 0, padding: 0, listStyle: 'none' }}>
                                {graphData.vertices.slice(0, displayCount).map((v, idx) => {
                                    const c = graphCommits[idx];
                                    const paddingWidth = (v.getNextPoint().x + 1) * LANE_WIDTH + 14;

                                    let localRef: string | null = null;
                                    let isRemotePush = false;

                                    if (c.refs) {
                                        const refsArray = c.refs.split(',').map(r => r.trim());
                                        for (const r of refsArray) {
                                            if (r.startsWith('HEAD ->')) {
                                                localRef = r.replace('HEAD ->', '').trim();
                                            } else if (r === branch && !localRef) {
                                                localRef = r;
                                            } else if (r.startsWith('origin/')) {
                                                isRemotePush = true;
                                            }
                                        }
                                    }

                                    return (
                                        <li key={c.hash} className={styles['commit-log-item']} style={{ position: 'relative' }}>
                                            <div className={`${styles['commit-row']} ${activeCommitHash === c.hash ? styles['active'] : ''}`}
                                                onClick={() => toggleCommit(c.hash)}
                                                onMouseEnter={(e) => handleMouseEnter(e, c as any)}
                                                onMouseLeave={handleMouseLeave}
                                                style={{ height: `${ROW_HEIGHT}px`, display: 'flex', alignItems: 'center', overflow: 'hidden', paddingRight: '8px', cursor: 'pointer' }}
                                            >
                                                <div style={{ width: paddingWidth, flexShrink: 0 }} />

                                                <div className={styles['commit-content']} style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'space-between', minWidth: 0, height: '100%' }}>
                                                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                                                        <div className={styles['commit-message']} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: '13px', lineHeight: '16px' }}>
                                                            {c.message}
                                                        </div>
                                                    </div>

                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0, marginLeft: '8px' }}>
                                                        {localRef && (
                                                            <div style={{
                                                                display: 'flex', alignItems: 'center', backgroundColor: '#3168d1', color: '#ffffff',
                                                                padding: '0 6px', borderRadius: '10px', fontSize: '11px', fontWeight: 'bold', gap: '3px',
                                                                boxShadow: '0 1px 2px rgba(0,0,0,0.2)', height: '20px'
                                                            }} title={`本地分支: ${localRef}`}>
                                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                                    <circle cx="12" cy="12" r="8" />
                                                                    <circle cx="12" cy="12" r="3" />
                                                                    <circle cx="12" cy="12" r="1.5" fill="currentColor" />
                                                                </svg>
                                                                <span>{localRef}</span>
                                                            </div>
                                                        )}

                                                        {isRemotePush && (
                                                            <div style={{
                                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                                backgroundColor: '#6a2a88', color: '#ffffff',
                                                                width: '20px', height: '20px', borderRadius: '50%',
                                                                boxShadow: '0 1px 2px rgba(0,0,0,0.2)'
                                                            }} title="已同步至远程仓库">
                                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                                    <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
                                                                </svg>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>

                                            {activeCommitHash === c.hash && (
                                                <div style={{ display: 'flex' }}>
                                                    <div style={{ width: paddingWidth, flexShrink: 0 }} />
                                                    <div className={styles['commit-files-wrapper']} style={{ marginLeft: 0, marginTop: '2px', marginBottom: '4px', flex: 1, minWidth: 0 }}>
                                                        {(commitFilesLoading || loadedCommitHash !== c.hash) ? (
                                                            <div style={{ height: '32px', display: 'flex', alignItems: 'center', opacity: 0.6, fontSize: '11px', padding: '0 12px' }}>
                                                                <i className="codicon codicon-loading codicon-modifier-spin" style={{ marginRight: '6px' }} /> 加载变动文件...
                                                            </div>
                                                        ) : renderFileList(commitFiles, 'history')}
                                                    </div>
                                                </div>
                                            )}
                                        </li>
                                    );
                                })}
                                {displayCount < graphCommits.length && (
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