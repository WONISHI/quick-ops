import React, { useState, useEffect, useRef, useMemo } from 'react';
import { vscode } from '../../utils/vscode';
import styles from './index.module.css';
import CommitHoverWidget from '../CommitHoverWidget'; // 🌟 引入抽离的悬浮组件

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
    activeCommitHash: string | null;
    loadedCommitHash: string | null;
    commitFilesLoading: boolean;
    commitFiles: any[];
    branch: string;
    onCommitClick: (hash: string) => void;
    renderCommitFiles: (files: any[]) => React.ReactNode;
}

const COLORS = ['#007acc', '#f14c4c', '#89d185', '#cca700', '#c586c0', '#4fc1ff'];
const LANE_WIDTH = 14;
const ROW_HEIGHT = 24;
const CY = 12;

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
    constructor(colour: number) { this.colour = colour; }
    addLine(p1: Point, p2: Point, lockedFirst: boolean) { this.lines.push({ p1, p2, lockedFirst }); }
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

const GitGraph: React.FC<GitGraphProps> = ({
    graphCommits,
    displayCount,
    setDisplayCount,
    activeCommitHash,
    loadedCommitHash,
    commitFilesLoading,
    commitFiles,
    branch,
    onCommitClick,
    renderCommitFiles
}) => {
    const [hoverInfo, setHoverInfo] = useState<{ commit: GraphCommit, x: number, y: number, position: 'top' | 'bottom' } | null>(null);
    const hoverTimeoutRef = useRef<any>(null);

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const graphContainerRef = useRef<HTMLDivElement>(null);

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
    }, [graphData, displayCount, yPositions, renderedHeight, activeCommitHash]);

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

    const handleGraphScroll = (e: React.UIEvent<HTMLDivElement>) => {
        const target = e.target as HTMLDivElement;
        if (target.scrollHeight - target.scrollTop <= target.clientHeight + 100) {
            if (displayCount < graphCommits.length) {
                setDisplayCount(prev => prev + 50);
            }
        }
    };

    const handleItemClick = (hash: string) => {
        clearTimeout(hoverTimeoutRef.current);
        setHoverInfo(null);
        onCommitClick(hash);
    };

    return (
        <>
            {/* 🌟 复用刚刚抽离出来的悬浮卡片 */}
            {hoverInfo && (
                <CommitHoverWidget
                    commit={hoverInfo.commit}
                    x={hoverInfo.x}
                    y={hoverInfo.y}
                    position={hoverInfo.position}
                    branch={branch}
                    onMouseEnter={() => clearTimeout(hoverTimeoutRef.current)}
                    onMouseLeave={handleMouseLeave}
                />
            )}

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
                                    onClick={() => handleItemClick(c.hash)}
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
                                            ) : renderCommitFiles(commitFiles)}
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
        </>
    );
};

export default GitGraph;