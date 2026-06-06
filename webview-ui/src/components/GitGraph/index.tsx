import React, { useState, useEffect, useRef, useMemo, useLayoutEffect } from 'react';
import styles from './index.module.css';
import CommitHoverWidget from '../CommitHoverWidget';
import GraphSearchWidget from '../GraphSearchWidget';
import type { GitFile } from '../../types/GitApp';
import Tooltip from '../Tooltip';

export interface GraphCommit {
    hash: string;
    parents?: string[];
    author: string;
    email?: string;
    message: string;
    timestamp?: number;
    refs?: string;
    filesChanged?: number;
    insertions?: number;
    deletions?: number;
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
    onOpenCommitMultiDiff: (hash: string) => void;
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

interface CommitRefInfo {
    localRef: string | null;
    remoteRef: string | null;
    isRemotePush: boolean;
}

interface HoverInfo {
    commit: GraphCommit;
    x: number;
    y: number;
    position: 'top' | 'bottom';
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

    constructor(id: number) {
        this.id = id;
    }

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
    const nullVertex = new Vertex(NULL_VERTEX_ID);

    commits.forEach((c, i) => {
        commitLookup[c.hash] = i;
    });

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
            if (startAt > availableColours[i]) {
                return i;
            }
        }

        availableColours.push(0);
        return availableColours.length - 1;
    };

    const determinePath = (startAt: number) => {
        let i = startAt;
        let vertex = vertices[i];
        let parentVertex = vertex.getNextParent();
        let curVertex: Vertex;
        let lastPoint = vertex.isNotOnBranch() ? vertex.getNextPoint() : vertex.getPoint();
        let curPoint: Point;

        if (
            parentVertex !== null &&
            parentVertex.id !== NULL_VERTEX_ID &&
            vertex.isMerge() &&
            !vertex.isNotOnBranch() &&
            !parentVertex.isNotOnBranch()
        ) {
            let foundPointToParent = false;
            const parentBranch = parentVertex.getBranch()!;

            for (i = startAt + 1; i < vertices.length; i++) {
                curVertex = vertices[i];

                const pointToParent = curVertex.getPointConnectingTo(parentVertex, parentBranch);

                if (pointToParent !== null) {
                    foundPointToParent = true;
                    curPoint = pointToParent;
                } else {
                    curPoint = curVertex.getNextPoint();
                }

                parentBranch.addLine(
                    lastPoint,
                    curPoint,
                    !foundPointToParent && curVertex !== parentVertex ? lastPoint.x < curPoint.x : true,
                );

                curVertex.registerUnavailablePoint(curPoint.x, parentVertex, parentBranch);
                lastPoint = curPoint;

                if (foundPointToParent) {
                    vertex.registerParentProcessed();
                    break;
                }
            }
        } else {
            const branchItem = new Branch(getAvailableColour(startAt));

            vertex.addToBranch(branchItem, lastPoint.x);
            vertex.registerUnavailablePoint(lastPoint.x, vertex, branchItem);

            for (i = startAt + 1; i < vertices.length; i++) {
                curVertex = vertices[i];
                curPoint = parentVertex === curVertex && !parentVertex.isNotOnBranch()
                    ? curVertex.getPoint()
                    : curVertex.getNextPoint();

                branchItem.addLine(lastPoint, curPoint, lastPoint.x < curPoint.x);
                curVertex.registerUnavailablePoint(curPoint.x, parentVertex, branchItem);
                lastPoint = curPoint;

                if (parentVertex === curVertex) {
                    vertex.registerParentProcessed();

                    const parentVertexOnBranch = !parentVertex.isNotOnBranch();

                    parentVertex.addToBranch(branchItem, curPoint.x);
                    vertex = parentVertex;
                    parentVertex = vertex.getNextParent();

                    if (parentVertex === null || parentVertexOnBranch) {
                        break;
                    }
                }
            }

            if (i === vertices.length && parentVertex !== null && parentVertex.id === NULL_VERTEX_ID) {
                vertex.registerParentProcessed();
            }

            branches.push(branchItem);
            availableColours[branchItem.colour] = i;
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
    onCommitContextMenu,
    onOpenCommitMultiDiff,
}) => {
    const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);
    const [hoveredRowHash, setHoveredRowHash] = useState<string | null>(null);

    const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const suppressHoverUntilRef = useRef(0);
    const graphScrollTopRef = useRef(0);

    const [resizeTrigger, setResizeTrigger] = useState(0);

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const graphContainerRef = useRef<HTMLDivElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);

    const [, setSearchOffset] = useState({ x: 0, y: 0 });

    const [searchQuery, setSearchQuery] = useState('');
    const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
    const expandedBlockRefs = useRef<Record<string, HTMLDivElement | null>>({});
    const [expandedBlockHeights, setExpandedBlockHeights] = useState<Record<string, number>>({});
    const resizeObserverRef = useRef<ResizeObserver | null>(null);

    const [prevIsSearchOpen, setPrevIsSearchOpen] = useState(isSearchOpen);

    if (isSearchOpen !== prevIsSearchOpen) {
        setPrevIsSearchOpen(isSearchOpen);

        if (!isSearchOpen) {
            setSearchQuery('');
            setSearchOffset({ x: 0, y: 0 });
            setCurrentMatchIndex(0);
        }
    }

    const getCommitRefInfo = (commit: GraphCommit): CommitRefInfo => {
        let localRef: string | null = null;
        let remoteRef: string | null = null;
        let isRemotePush = false;

        if (commit.refs) {
            const refsArray = commit.refs
                .split(',')
                .map((r) => r.trim())
                .filter(Boolean);

            for (const r of refsArray) {
                if (r.startsWith('HEAD ->')) {
                    localRef = r.replace('HEAD ->', '').trim();
                    continue;
                }

                if (r === branch && !localRef) {
                    localRef = r;
                    continue;
                }

                if (localRef && r === `origin/${localRef}`) {
                    remoteRef = r;
                    isRemotePush = true;
                    continue;
                }

                if (!localRef && r.startsWith('origin/') && r !== 'origin/HEAD') {
                    remoteRef = r;
                    isRemotePush = true;
                }
            }
        }

        return {
            localRef,
            remoteRef,
            isRemotePush,
        };
    };

    const createHoverCommit = (commit: GraphCommit): GraphCommit => {
        const { localRef, remoteRef, isRemotePush } = getCommitRefInfo(commit);
        const refs: string[] = [];

        if (localRef) {
            refs.push(localRef);
        }

        if (isRemotePush && remoteRef) {
            refs.push(remoteRef);
        }

        return {
            ...commit,
            refs: refs.join(', '),
        };
    };

    const matchedIndices = useMemo(() => {
        if (!searchQuery) return [];

        const lowerQuery = searchQuery.toLowerCase();

        return graphCommits
            .map((c, i) => {
                const matched =
                    c.message.toLowerCase().includes(lowerQuery) ||
                    c.author.toLowerCase().includes(lowerQuery) ||
                    c.hash.toLowerCase().includes(lowerQuery);

                return matched ? i : -1;
            })
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
                currentY += typeof measuredHeight === 'number' ? measuredHeight : isLoading ? 38 : 32;
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

            setExpandedBlockHeights((prev) => {
                return prev[hash] === initialHeight ? prev : { ...prev, [hash]: initialHeight };
            });
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

        graphData.branches.forEach((branchItem) => {
            const color = COLORS[branchItem.colour % COLORS.length];

            ctx.beginPath();
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';

            let lastPt: { x: number; y: number } | null = null;

            branchItem.lines.forEach((line, i) => {
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
    }, [graphData, displayCount, yPositions, renderedHeight, expandedCommitHashes, resizeTrigger, graphCommits]);

    const handleMouseEnter = (e: React.MouseEvent, commit: GraphCommit) => {
        setHoveredRowHash(commit.hash);

        const now = new Date().getTime();

        if (now < suppressHoverUntilRef.current) return;

        const rect = e.currentTarget.getBoundingClientRect();

        if (hoverTimeoutRef.current) {
            clearTimeout(hoverTimeoutRef.current);
        }

        hoverTimeoutRef.current = setTimeout(() => {
            const timeInside = new Date().getTime();

            if (timeInside < suppressHoverUntilRef.current) return;

            const showAbove = rect.top > window.innerHeight / 2;
            const hoverCommit = createHoverCommit(commit);

            setHoverInfo({
                commit: hoverCommit,
                x: 0,
                y: showAbove ? rect.top - 8 : rect.bottom + 4,
                position: showAbove ? 'top' : 'bottom',
            });
        }, 1000);
    };

    const handleMouseLeave = () => {
        setHoveredRowHash(null);

        if (hoverTimeoutRef.current) {
            clearTimeout(hoverTimeoutRef.current);
        }

        hoverTimeoutRef.current = setTimeout(() => {
            setHoverInfo(null);
        }, 250);
    };

    const handleGraphScroll = (e: React.UIEvent<HTMLDivElement>) => {
        const target = e.currentTarget;
        const hasVerticalScroll = target.scrollHeight > target.clientHeight;
        const isScrollMoved = target.scrollTop !== graphScrollTopRef.current;

        graphScrollTopRef.current = target.scrollTop;

        if (hasVerticalScroll && isScrollMoved) {
            suppressHoverUntilRef.current = Date.now() + 300;

            if (hoverTimeoutRef.current) {
                clearTimeout(hoverTimeoutRef.current);
                hoverTimeoutRef.current = undefined;
            }

            setHoveredRowHash(null);
            setHoverInfo(null);
        }

        if (target.scrollHeight - target.scrollTop <= target.clientHeight + 100) {
            if (displayCount < graphCommits.length) {
                setDisplayCount((prev) => prev + 50);
            }
        }
    };

    const handleItemClick = (hash: string) => {
        if (hoverTimeoutRef.current) {
            clearTimeout(hoverTimeoutRef.current);
        }

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

        return parts.map((part, i) => {
            return part.toLowerCase() === query.toLowerCase() ? (
                <span
                    key={i}
                    className={`${styles['graph-search-highlight']} ${isActiveMatch ? styles['graph-search-highlight-active'] : ''}`}
                >
                    {part}
                </span>
            ) : (
                part
            );
        });
    };

    return (
        <>
            {hoverInfo && (
                <CommitHoverWidget
                    commit={hoverInfo.commit}
                    x={0}
                    y={hoverInfo.y}
                    position={hoverInfo.position}
                    branch={hoverInfo.commit.refs ? branch : ''}
                    remoteUrl={remoteUrl}
                    onMouseEnter={() => {
                        if (hoverTimeoutRef.current) {
                            clearTimeout(hoverTimeoutRef.current);
                        }
                    }}
                    onMouseLeave={handleMouseLeave}
                />
            )}

            <GraphSearchWidget
                isSearchOpen={isSearchOpen}
                setIsSearchOpen={setIsSearchOpen}
                searchQuery={searchQuery}
                setSearchQuery={setSearchQuery}
                currentMatchIndex={currentMatchIndex}
                setCurrentMatchIndex={setCurrentMatchIndex}
                matchedIndices={matchedIndices}
                handlePrevMatch={handlePrevMatch}
                handleNextMatch={handleNextMatch}
                anchorRef={graphContainerRef}
            />

            <div
                className={styles['graph-scroll-view']}
                ref={graphContainerRef}
                onScroll={handleGraphScroll}
            >
                <canvas
                    ref={canvasRef}
                    className={styles['graph-canvas']}
                    style={{ '--graph-canvas-height': `${renderedHeight}px` } as React.CSSProperties}
                />

                <ul className={styles['commit-timeline']}>
                    {graphData.vertices.slice(0, displayCount).map((v, idx) => {
                        const c = graphCommits[idx];
                        const paddingWidth = (v.getNextPoint().x + 1) * LANE_WIDTH + 14;
                        const isMatched = matchedIndices.includes(idx);
                        const isActiveMatch = isSearchOpen && isMatched && matchedIndices[currentMatchIndex] === idx;

                        const isExpanded = expandedCommitHashes.includes(c.hash);
                        const isLoading = !!commitFilesLoadingMap[c.hash];
                        const files = commitFilesMap[c.hash] || [];

                        const { localRef, isRemotePush } = getCommitRefInfo(c);

                        return (
                            <li key={c.hash} className={styles['commit-log-item']}>
                                <div
                                    className={`${styles['commit-row']} ${activeCommitHash === c.hash ? styles['active'] : ''}`}
                                    onClick={() => handleItemClick(c.hash)}
                                    onMouseEnter={(e) => handleMouseEnter(e, c)}
                                    onMouseLeave={handleMouseLeave}
                                    onContextMenu={(e) => onCommitContextMenu(e, c)}
                                >
                                    <div
                                        className={styles['graph-lane-spacer']}
                                        style={{ '--graph-lane-spacer-width': `${paddingWidth}px` } as React.CSSProperties}
                                    />

                                    <div className={styles['commit-content']}>
                                        <div className={styles['commit-message-wrap']}>
                                            <div className={styles['commit-message']}>
                                                {isSearchOpen ? highlightText(c.message, searchQuery, isActiveMatch) : c.message}
                                                <span className={styles['commit-author']}> {c.author}</span>
                                            </div>
                                        </div>

                                        <div className={styles['commit-row-actions']}>
                                            {localRef && (
                                                <div
                                                    className={styles['local-ref-badge']}
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
                                                    className={styles['remote-sync-badge']}
                                                    title="已同步至远程仓库"
                                                >
                                                    <svg
                                                        width="12"
                                                        height="12"
                                                        viewBox="0 0 24 24"
                                                        fill="none"
                                                        stroke="currentColor"
                                                        strokeWidth="2"
                                                        strokeLinecap="round"
                                                        strokeLinejoin="round"
                                                    >
                                                        <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
                                                    </svg>
                                                </div>
                                            )}

                                            {hoveredRowHash === c.hash && (
                                                <Tooltip content="打开更改">
                                                    <button
                                                        className={styles['commit-open-diff-btn']}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            onOpenCommitMultiDiff(c.hash);
                                                        }}
                                                        onMouseEnter={() => {
                                                            if (hoverTimeoutRef.current) {
                                                                clearTimeout(hoverTimeoutRef.current);
                                                            }

                                                            setHoverInfo(null);
                                                        }}
                                                    >
                                                        <i className="codicon codicon-diff-multiple" />
                                                    </button>
                                                </Tooltip>
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
                                        className={styles['commit-expanded-block']}
                                    >
                                        <div
                                            className={styles['graph-lane-spacer']}
                                            style={{ '--graph-lane-spacer-width': `${paddingWidth}px` } as React.CSSProperties}
                                        />

                                        <div className={styles['commit-files-wrapper']}>
                                            {isLoading ? (
                                                <div className={styles['commit-files-loading']}>
                                                    <i className={`codicon codicon-loading codicon-modifier-spin ${styles['commit-files-loading-icon']}`} />
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