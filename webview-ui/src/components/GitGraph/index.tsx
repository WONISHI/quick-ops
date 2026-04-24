import React, { useState, useEffect, useRef, useMemo, useLayoutEffect } from 'react';
import styles from './index.module.css';
import CommitHoverWidget from '../CommitHoverWidget';
import type { GitFile } from '../../types/GitApp';

export interface GraphCommit {
    hash: string;
    parents?: string[];
    author: string;
    email?: string;
    message: string;
    timestamp?: number;
    refs?: string;
}

interface GitGraphProps {
    graphCommits: GraphCommit[];
    displayCount: number;
    setDisplayCount: React.Dispatch<React.SetStateAction<number>>;

    expandedCommitHashes: string[];
    commitFilesLoadingMap: Record<string, boolean>;
    commitFilesMap: Record<string, GitFile[]>;

    activeCommitHash: string | null;

    branch: string;
    remoteUrl?: string;
    isSearchOpen: boolean;
    setIsSearchOpen: (open: boolean) => void;
    onCommitClick: (hash: string) => void;
    renderCommitFiles: (hash: string, files: GitFile[]) => React.ReactNode;
    onCommitContextMenu: (e: React.MouseEvent, commit: GraphCommit) => void;
}

const COLORS = ['#007acc', '#f14c4c', '#89d185', '#cca700', '#c586c0', '#4fc1ff'];
const LANE_WIDTH = 14;
const ROW_HEIGHT = 24;
const CY = 12;

const NULL_VERTEX_ID = -1;

interface Point {
    x: number;
    y: number;
}
interface Line {
    p1: Point;
    p2: Point;
    lockedFirst: boolean;
}
interface UnavailablePoint {
    connectsTo: Vertex | null;
    onBranch: Branch;
}

class Branch {
    public colour: number;
    public lines: Line[] = [];
    constructor(colour: number) {
        this.colour = colour;
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

    constructor(id: number) { this.id = id; }

    addChild(v: Vertex) {
        this.children.push(v);
    }
    addParent(v: Vertex) {
        this.parents.push(v);
    }
    getParents() {
        return this.parents;
    }
    getNextParent(): Vertex | null {
        return this.nextParent < this.parents.length ? this.parents[this.nextParent] : null;
    }
    registerParentProcessed() {
        this.nextParent++;
    }
    isMerge() {
        return this.parents.length > 1;
    }
    addToBranch(b: Branch, x: number) {
        if (!this.onBranch) {
            this.onBranch = b;
            this.x = x;
        }
    }
    isNotOnBranch() {
        return this.onBranch === null;
    }
    getBranch() {
        return this.onBranch;
    }
    getPoint(): Point {
        return { x: this.x, y: this.id };
    }
    getNextPoint(): Point {
        return { x: this.nextX, y: this.id };
    }
    getPointConnectingTo(v: Vertex | null, b: Branch) {
        for (let i = 0; i < this.connections.length; i++) {
            if (this.connections[i] && this.connections[i].connectsTo === v && this.connections[i].onBranch === b) {
                return { x: i, y: this.id };
            }
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
    commits.forEach((c, i) => (commitLookup[c.hash] = i));
    const nullVertex = new Vertex(NULL_VERTEX_ID);

    commits.forEach((c, i) => {
        (c.parents || []).forEach((pHash) => {
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
        let vertex = vertices[i],
            parentVertex = vertex.getNextParent(),
            curVertex;
        let lastPoint = vertex.isNotOnBranch() ? vertex.getNextPoint() : vertex.getPoint(),
            curPoint;

        if (
            parentVertex !== null &&
            parentVertex.id !== NULL_VERTEX_ID &&
            vertex.isMerge() &&
            !vertex.isNotOnBranch() &&
            !parentVertex.isNotOnBranch()
        ) {
            let foundPointToParent = false,
                parentBranch = parentVertex.getBranch()!;
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

const GitGraph: React.FC<GitGraphProps> = ({
    graphCommits,
    displayCount,
    setDisplayCount,
    expandedCommitHashes,
    commitFilesLoadingMap,
    commitFilesMap,
    activeCommitHash,
    remoteUrl,
    branch,
    isSearchOpen,
    setIsSearchOpen,
    onCommitClick,
    renderCommitFiles,
    onCommitContextMenu // 🌟
}) => {
    const [hoverInfo, setHoverInfo] = useState<{ commit: GraphCommit; x: number; y: number; position: 'top' | 'bottom' } | null>(null);
    const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const suppressHoverUntilRef = useRef(0);

    const [resizeTrigger, setResizeTrigger] = useState(0);

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const graphContainerRef = useRef<HTMLDivElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);

    const [searchOffset, setSearchOffset] = useState({ x: 0, y: 0 });
    const isDragging = useRef(false);
    const dragStart = useRef({ mouseX: 0, mouseY: 0, currentX: 0, currentY: 0 });

    const [searchQuery, setSearchQuery] = useState('');
    const [currentMatchIndex, setCurrentMatchIndex] = useState(0);


    const [prevIsSearchOpen, setPrevIsSearchOpen] = useState(isSearchOpen);

    if (isSearchOpen !== prevIsSearchOpen) {
        setPrevIsSearchOpen(isSearchOpen);
        if (!isSearchOpen) {
            setSearchQuery('');
            setSearchOffset({ x: 0, y: 0 });
            setCurrentMatchIndex(0);
        }
    }

    const expandedBlockRefs = useRef<Record<string, HTMLDivElement | null>>({});
    const [expandedBlockHeights, setExpandedBlockHeights] = useState<Record<string, number>>({});
    const resizeObserverRef = useRef<ResizeObserver | null>(null);

    const matchedIndices = useMemo(() => {
        if (!searchQuery) return [];
        const lowerQuery = searchQuery.toLowerCase();
        return graphCommits
            .map((c, i) => (c.message.toLowerCase().includes(lowerQuery) || c.author.toLowerCase().includes(lowerQuery) || c.hash.toLowerCase().includes(lowerQuery) ? i : -1))
            .filter((i) => i !== -1);
    }, [graphCommits, searchQuery]);

    const graphData = useMemo(() => buildGraphEngine(graphCommits), [graphCommits]);

    const yPositions = useMemo(() => {
        const positions: number[] = [];
        let currentY = 0;

        for (let i = 0; i < graphCommits.length; i++) {
            const hash = graphCommits[i].hash;
            const isExpanded = expandedCommitHashes.includes(hash);
            const isLoading = !!commitFilesLoadingMap[hash];

            positions.push(currentY);
            currentY += ROW_HEIGHT;

            if (isExpanded) {
                const measuredHeight = expandedBlockHeights[hash];
                currentY += typeof measuredHeight === 'number' ? measuredHeight : (isLoading ? 38 : 32);
            }
        }

        positions.push(currentY);
        return positions;
    }, [graphCommits, expandedCommitHashes, commitFilesLoadingMap, expandedBlockHeights]);

    const renderedHeight = yPositions[Math.min(displayCount, graphCommits.length)] || 0;

    useLayoutEffect(() => {
        resizeObserverRef.current?.disconnect();

        const observer = new ResizeObserver(() => {
            setExpandedBlockHeights((prev) => {
                let changed = false;
                const next = { ...prev };

                expandedCommitHashes.forEach((hash) => {
                    const el = expandedBlockRefs.current[hash];
                    if (!el) return;

                    const height = Math.ceil(el.getBoundingClientRect().height);
                    if (next[hash] !== height) {
                        next[hash] = height;
                        changed = true;
                    }
                });

                return changed ? next : prev;
            });
        });

        resizeObserverRef.current = observer;

        expandedCommitHashes.forEach((hash) => {
            const el = expandedBlockRefs.current[hash];
            if (!el) return;

            observer.observe(el);

            const initialHeight = Math.ceil(el.getBoundingClientRect().height);
            setExpandedBlockHeights((prev) =>
                prev[hash] === initialHeight ? prev : { ...prev, [hash]: initialHeight }
            );
        });

        return () => {
            observer.disconnect();
        };
    }, [expandedCommitHashes, commitFilesMap, commitFilesLoadingMap]);

    useEffect(() => {
        if (matchedIndices.length > 0 && isSearchOpen) {
            const matchCommitIndex = matchedIndices[currentMatchIndex];
            if (matchCommitIndex >= displayCount) {
                setDisplayCount(matchCommitIndex + 50);
            }
            const y = yPositions[matchCommitIndex];
            if (graphContainerRef.current) {
                graphContainerRef.current.scrollTop = Math.max(0, y - 60);
            }
        }
    }, [currentMatchIndex, matchedIndices, yPositions, isSearchOpen, displayCount, setDisplayCount]);

    useEffect(() => {
        if (isSearchOpen && searchInputRef.current) {
            searchInputRef.current.focus();
        }
    }, [isSearchOpen]);

    useEffect(() => {
        let timeoutId: number;
        const handleResize = () => {
            clearTimeout(timeoutId);
            timeoutId = window.setTimeout(() => {
                setResizeTrigger((prev) => prev + 1);
            }, 150);
        };

        window.addEventListener('resize', handleResize);
        return () => {
            window.removeEventListener('resize', handleResize);
            clearTimeout(timeoutId);
        };
    }, []);

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

        graphData.branches.forEach((branch) => {
            const color = COLORS[branch.colour % COLORS.length];
            ctx.beginPath();
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';

            let lastPt: { x: number; y: number } | null = null;
            branch.lines.forEach((line, i) => {
                const x1 = line.p1.x * LANE_WIDTH + 14;
                const y1Base = yPositions[line.p1.y];
                const y1 = y1Base + CY;

                const x2 = line.p2.x * LANE_WIDTH + 14;
                const y2Base = yPositions[line.p2.y];
                const y2 = y2Base + CY;

                if (i === 0 || lastPt?.x !== x1 || lastPt?.y !== y1) ctx.moveTo(x1, y1);

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
    }, [graphData, displayCount, yPositions, renderedHeight, expandedCommitHashes, resizeTrigger, graphCommits]);

    const handleMouseEnter = (e: React.MouseEvent, commit: GraphCommit) => {
        const now = new Date().getTime();
        if (now < suppressHoverUntilRef.current) return;

        const rect = e.currentTarget.getBoundingClientRect();
        if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);

        hoverTimeoutRef.current = setTimeout(() => {
            if (Date.now() < suppressHoverUntilRef.current) return;

            const showAbove = rect.top > window.innerHeight / 2;
            setHoverInfo({
                commit,
                x: 0,
                y: showAbove ? rect.top - 8 : rect.bottom + 4,
                position: showAbove ? 'top' : 'bottom'
            });
        }, 1000);
    };

    const handleMouseLeave = () => {
        if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
        hoverTimeoutRef.current = setTimeout(() => {
            setHoverInfo(null);
        }, 250);
    };

    const handleGraphScroll = (e: React.UIEvent<HTMLDivElement>) => {
        const target = e.target as HTMLDivElement;
        if (target.scrollHeight - target.scrollTop <= target.clientHeight + 100) {
            if (displayCount < graphCommits.length) {
                setDisplayCount((prev) => prev + 50);
            }
        }
    };

    const handleItemClick = (hash: string) => {
        if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
        setHoverInfo(null);
        onCommitClick(hash);
    };

    const handleNextMatch = () => {
        if (matchedIndices.length === 0) return;
        setCurrentMatchIndex((prev) => (prev + 1) % matchedIndices.length);
    };

    const handlePrevMatch = () => {
        if (matchedIndices.length === 0) return;
        setCurrentMatchIndex((prev) => (prev - 1 + matchedIndices.length) % matchedIndices.length);
    };

    const highlightText = (text: string, query: string, isActiveMatch: boolean) => {
        if (!query) return text;
        const safeQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const parts = text.split(new RegExp(`(${safeQuery})`, 'gi'));
        return parts.map((part, i) =>
            part.toLowerCase() === query.toLowerCase() ? (
                <span
                    key={i}
                    style={{
                        backgroundColor: isActiveMatch
                            ? 'var(--vscode-editor-findMatchBackground, #515c6a)'
                            : 'var(--vscode-editor-findMatchHighlightBackground, #ea5c0055)',
                        color: 'inherit',
                        border: isActiveMatch ? '1px solid var(--vscode-editor-findMatchBorder, #f48771)' : 'none',
                        borderRadius: '2px'
                    }}
                >
                    {part}
                </span>
            ) : (
                part
            )
        );
    };

    const handlePointerDown = (e: React.PointerEvent) => {
        const target = e.target as HTMLElement;
        if (!target.classList.contains(styles['search-gripper']) && !target.closest(`.${styles['search-gripper']}`)) return;

        e.preventDefault();
        (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
        isDragging.current = true;
        dragStart.current = {
            mouseX: e.clientX,
            mouseY: e.clientY,
            currentX: searchOffset.x,
            currentY: searchOffset.y
        };
    };

    const handlePointerMove = (e: React.PointerEvent) => {
        if (!isDragging.current) return;
        const dx = e.clientX - dragStart.current.mouseX;
        const dy = e.clientY - dragStart.current.mouseY;
        setSearchOffset({
            x: dragStart.current.currentX + dx,
            y: dragStart.current.currentY + dy
        });
    };

    const handlePointerUp = (e: React.PointerEvent) => {
        isDragging.current = false;
        (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
    };

    return (
        <>
            {hoverInfo && (
                <CommitHoverWidget
                    commit={hoverInfo.commit}
                    x={0}
                    y={hoverInfo.y}
                    position={hoverInfo.position}
                    branch={branch}
                    remoteUrl={remoteUrl}
                    onMouseEnter={() => { if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current); }}
                    onMouseLeave={handleMouseLeave}
                />
            )}

            {isSearchOpen && (
                <div
                    className={styles['search-widget']}
                    style={{ transform: `translate(${searchOffset.x}px, ${searchOffset.y}px)` }}
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={handlePointerUp}
                >
                    <div className={styles['search-gripper']}>
                        <i className="codicon codicon-gripper" />
                    </div>

                    <input
                        ref={searchInputRef}
                        className={styles['search-input']}
                        placeholder="搜索提交..."
                        value={searchQuery}
                        onChange={(e) => {
                            setSearchQuery(e.target.value)
                            setCurrentMatchIndex(0);
                        }}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                if (e.shiftKey) {
                                    handlePrevMatch();
                                } else {
                                    handleNextMatch();
                                }
                            } else if (e.key === 'Escape') {
                                setIsSearchOpen(false);
                            }
                        }}
                    />
                    <div className={styles['search-count']}>
                        {matchedIndices.length > 0 ? currentMatchIndex + 1 : 0}/{matchedIndices.length}
                    </div>
                    <button className={styles['search-btn']} onClick={handlePrevMatch} disabled={matchedIndices.length === 0} title="上一个 (Shift+Enter)">
                        <i className="codicon codicon-arrow-up" />
                    </button>
                    <button className={styles['search-btn']} onClick={handleNextMatch} disabled={matchedIndices.length === 0} title="下一个 (Enter)">
                        <i className="codicon codicon-arrow-down" />
                    </button>
                    <button className={styles['search-btn']} onClick={() => setIsSearchOpen(false)} title="关闭 (Esc)">
                        <i className="codicon codicon-close" />
                    </button>
                </div>
            )}

            <div
                className={styles['graph-scroll-view']}
                ref={graphContainerRef}
                onScroll={handleGraphScroll}
                style={{ position: 'relative', flex: 1, overflowY: 'auto' }}
            >
                <canvas
                    ref={canvasRef}
                    style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: `${renderedHeight}px`, pointerEvents: 'none', zIndex: 1 }}
                />
                <ul className={styles['commit-timeline']} style={{ position: 'relative', zIndex: 2, margin: 0, padding: 0, listStyle: 'none' }}>
                    {graphData.vertices.slice(0, displayCount).map((v, idx) => {
                        const c = graphCommits[idx];
                        const paddingWidth = (v.getNextPoint().x + 1) * LANE_WIDTH + 14;
                        const isMatched = matchedIndices.includes(idx);
                        const isActiveMatch = isSearchOpen && isMatched && matchedIndices[currentMatchIndex] === idx;

                        const isExpanded = expandedCommitHashes.includes(c.hash);
                        const isLoading = !!commitFilesLoadingMap[c.hash];
                        const files = commitFilesMap[c.hash] || [];

                        let localRef: string | null = null;
                        let isRemotePush = false;

                        if (c.refs) {
                            const refsArray = c.refs.split(',').map((r) => r.trim());
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
                                <div
                                    className={`${styles['commit-row']} ${activeCommitHash === c.hash ? styles['active'] : ''}`}
                                    onClick={() => handleItemClick(c.hash)}
                                    onMouseEnter={(e) => handleMouseEnter(e, c)}
                                    onMouseLeave={handleMouseLeave}
                                    onContextMenu={(e) => onCommitContextMenu(e, c)} // 🌟 直接调用 Props 回调
                                    style={{ height: `${ROW_HEIGHT}px`, display: 'flex', alignItems: 'center', overflow: 'hidden', paddingRight: '8px', cursor: 'pointer' }}
                                >
                                    <div style={{ width: paddingWidth, flexShrink: 0 }} />

                                    <div className={styles['commit-content']} style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'space-between', minWidth: 0, height: '100%' }}>
                                        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                                            <div className={styles['commit-message']} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: '13px', lineHeight: '16px' }}>
                                                {isSearchOpen ? highlightText(c.message, searchQuery, isActiveMatch) : c.message}
                                            </div>
                                        </div>

                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0, marginLeft: '8px' }}>
                                            {localRef && (
                                                <div
                                                    style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        backgroundColor: '#3168d1',
                                                        color: '#ffffff',
                                                        padding: '0 6px',
                                                        borderRadius: '10px',
                                                        fontSize: '11px',
                                                        fontWeight: 'bold',
                                                        gap: '3px',
                                                        boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
                                                        height: '20px'
                                                    }}
                                                    title={`本地分支: ${localRef}`}
                                                >
                                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                        <circle cx="12" cy="12" r="8" />
                                                        <circle cx="12" cy="12" r="3" />
                                                        <circle cx="12" cy="12" r="1.5" fill="currentColor" />
                                                    </svg>
                                                    <span>{localRef}</span>
                                                </div>
                                            )}

                                            {isRemotePush && (
                                                <div
                                                    style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        backgroundColor: '#6a2a88',
                                                        color: '#ffffff',
                                                        width: '20px',
                                                        height: '20px',
                                                        borderRadius: '50%',
                                                        boxShadow: '0 1px 2px rgba(0,0,0,0.2)'
                                                    }}
                                                    title="已同步至远程仓库"
                                                >
                                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                        <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
                                                    </svg>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {isExpanded && (
                                    <div
                                        ref={(el) => {
                                            expandedBlockRefs.current[c.hash] = el;
                                        }}
                                        data-hash={c.hash}
                                        style={{ display: 'flex', paddingTop: '2px', paddingBottom: '4px' }}
                                    >
                                        <div style={{ width: paddingWidth, flexShrink: 0 }} />
                                        <div
                                            className={styles['commit-files-wrapper']}
                                            style={{ marginLeft: 0, flex: 1, minWidth: 0 }}
                                        >
                                            {isLoading ? (
                                                <div style={{ height: '32px', display: 'flex', alignItems: 'center', opacity: 0.6, fontSize: '11px', padding: '0 12px' }}>
                                                    <i className="codicon codicon-loading codicon-modifier-spin" style={{ marginRight: '6px' }} />
                                                    加载变动文件...
                                                </div>
                                            ) : (
                                                renderCommitFiles(c.hash, files)
                                            )}
                                        </div>
                                    </div>
                                )}
                            </li>
                        );
                    })}
                </ul>
            </div>
        </>
    );
};

export default GitGraph;