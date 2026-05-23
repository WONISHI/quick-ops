import React, { useEffect, useMemo, useRef, useState } from 'react';
import FilterPopup from '../../components/FilterPopup';
import { vscode } from '../../utils/vscode';
import styles from './index.module.css';

export interface GraphCommit {
  hash: string;
  parents?: string[];
  author: string;
  email?: string;
  message: string;
  timestamp?: number;
  refs?: string;
}

const COLORS = ['#007acc', '#f14c4c', '#89d185', '#cca700', '#c586c0', '#4fc1ff'];
const LANE_WIDTH = 14;
const ROW_HEIGHT = 28;
const DETAIL_HEIGHT = 206;
const CY = 14;

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
  public x = 0;
  private children: Vertex[] = [];
  private parents: Vertex[] = [];
  private nextParent = 0;
  private onBranch: Branch | null = null;
  private nextX = 0;
  private connections: UnavailablePoint[] = [];

  constructor(id: number) { this.id = id; }
  addChild(v: Vertex) { this.children.push(v); }
  addParent(v: Vertex) { this.parents.push(v); }
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
    for (let i = 0; i < availableColours.length; i++) if (startAt > availableColours[i]) return i;
    availableColours.push(0);
    return availableColours.length - 1;
  };

  const determinePath = (startAt: number) => {
    let i = startAt;
    let vertex = vertices[i];
    let parentVertex = vertex.getNextParent();
    let curVertex;
    let lastPoint = vertex.isNotOnBranch() ? vertex.getNextPoint() : vertex.getPoint();
    let curPoint;

    if (parentVertex !== null && parentVertex.id !== NULL_VERTEX_ID && vertex.isMerge() && !vertex.isNotOnBranch() && !parentVertex.isNotOnBranch()) {
      let foundPointToParent = false;
      const parentBranch = parentVertex.getBranch()!;

      for (i = startAt + 1; i < vertices.length; i++) {
        curVertex = vertices[i];
        curPoint = curVertex.getPointConnectingTo(parentVertex, parentBranch);
        if (curPoint !== null) foundPointToParent = true;
        else curPoint = curVertex.getNextPoint();

        parentBranch.addLine(lastPoint, curPoint, !foundPointToParent && curVertex !== parentVertex ? lastPoint.x < curPoint.x : true);
        curVertex.registerUnavailablePoint(curPoint.x, parentVertex, parentBranch);
        lastPoint = curPoint;
        if (foundPointToParent) { vertex.registerParentProcessed(); break; }
      }
    } else {
      const branch = new Branch(getAvailableColour(startAt));
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
          const parentVertexOnBranch = !parentVertex.isNotOnBranch();
          parentVertex.addToBranch(branch, curPoint.x);
          vertex = parentVertex;
          parentVertex = vertex.getNextParent();
          if (parentVertex === null || parentVertexOnBranch) break;
        }
      }
      if (i === vertices.length && parentVertex !== null && parentVertex.id === NULL_VERTEX_ID) vertex.registerParentProcessed();
      branches.push(branch);
      availableColours[branch.colour] = i;
    }
  };

  let idx = 0;
  while (idx < vertices.length) {
    if (vertices[idx].getNextParent() !== null || vertices[idx].isNotOnBranch()) determinePath(idx);
    else idx++;
  }
  return { vertices, branches };
}

function formatDate(timestamp?: number) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  const h = `${date.getHours()}`.padStart(2, '0');
  const min = `${date.getMinutes()}`.padStart(2, '0');
  return `${y}-${m}-${d} ${h}:${min}`;
}

function getRefs(refs?: string) {
  if (!refs) return [];
  return refs.split(',').map((ref) => ref.trim()).filter(Boolean);
}

function renderRefText(ref: string, styles: Record<string, string>) {
  const parts = ref.split(' -> ');

  if (parts.length <= 1) {
    return <span className={styles['ref-tag-text']}>{ref}</span>;
  }

  return (
    <>
      <span className={styles['ref-tag-text']}>{parts[0]}</span>
      <i className={`codicon codicon-arrow-right ${styles['ref-tag-arrow']}`} />
      <span className={styles['ref-tag-text']}>{parts.slice(1).join(' -> ')}</span>
    </>
  );
}

export default function GitCommitDetailApp() {
  const [graphCommits, setGraphCommits] = useState<GraphCommit[]>([]);
  const [displayCount, setDisplayCount] = useState(100);
  const [activeCommitHash, setActiveCommitHash] = useState<string | null>(null);
  const [selectedGraphFilter, setSelectedGraphFilter] = useState('全部分支');
  const [totalCommits, setTotalCommits] = useState(0);
  const [folderName, setFolderName] = useState('');
  const [branch, setBranch] = useState('');
  const [remoteUrl, setRemoteUrl] = useState('');
  const [loading, setLoading] = useState(true);

  // 🌟 新增：过滤相关的状态
  const [descFilter, setDescFilter] = useState('');
  const [dateFilter, setDateFilter] = useState({ start: '', end: '' });
  const [authorFilter, setAuthorFilter] = useState<string[]>([]);
  const [hashFilter, setHashFilter] = useState('');
  const [activePopup, setActivePopup] = useState<'desc' | 'date' | 'author' | 'hash' | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const descFilterRef = useRef<HTMLElement>(null);
  const dateFilterRef = useRef<HTMLElement>(null);
  const authorFilterRef = useRef<HTMLElement>(null);
  const hashFilterRef = useRef<HTMLElement>(null);

  // 🌟 提取所有唯一的作者供勾选使用
  const allAuthors = useMemo(() => {
    const authors = new Set<string>();
    graphCommits.forEach((c) => authors.add(c.author));
    return Array.from(authors);
  }, [graphCommits]);

  // 🌟 核心：计算出过滤后的 commits
  const filteredCommits = useMemo(() => {
    return graphCommits.filter((c) => {
      // 过滤描述
      if (descFilter && !c.message.toLowerCase().includes(descFilter.toLowerCase())) return false;
      // 过滤提交哈希
      if (hashFilter && !c.hash.toLowerCase().includes(hashFilter.toLowerCase())) return false;
      // 过滤日期 (跨年也支持，基于时间戳)
      if (dateFilter.start) {
        const startMs = new Date(dateFilter.start).getTime();
        if (c.timestamp && c.timestamp < startMs) return false;
      }
      if (dateFilter.end) {
        const endMs = new Date(dateFilter.end).getTime() + 86399999; // 加一天减一毫秒以包含当天
        if (c.timestamp && c.timestamp > endMs) return false;
      }
      // 过滤作者 (勾选了才过滤，未勾选任意则显示全部)
      if (authorFilter.length > 0 && !authorFilter.includes(c.author)) return false;

      return true;
    });
  }, [graphCommits, descFilter, dateFilter, authorFilter, hashFilter]);

  // 过滤条件变化时，回到顶部
  useEffect(() => {
    setDisplayCount(100);
  }, [filteredCommits.length]);

  // 🌟 重新计算 Graph（基于筛选后的记录）
  const graphData = useMemo(() => buildGraphEngine(filteredCommits), [filteredCommits]);

  const yPositions = useMemo(() => {
    const positions: number[] = [];
    let currentY = 0;

    for (let i = 0; i < filteredCommits.length; i++) {
      const hash = filteredCommits[i].hash;
      positions.push(currentY);
      currentY += ROW_HEIGHT;
      if (activeCommitHash === hash) {
        currentY += DETAIL_HEIGHT;
      }
    }
    positions.push(currentY);
    return positions;
  }, [filteredCommits, activeCommitHash]);

  const visibleCommits = filteredCommits.slice(0, displayCount);
  const renderedHeight = yPositions[Math.min(displayCount, filteredCommits.length)] || 0;

  useEffect(() => {
    vscode.postMessage({ command: 'gitDetailLoaded' });
    const handleMessage = (event: MessageEvent) => {
      const msg = event.data;
      if (msg.type === 'gitDetailLoading' || msg.type === 'startLoading') {
        setLoading(true);
      } else if (msg.type === 'statusData') {
        setFolderName(msg.folderName || '');
        setBranch(msg.branch || '');
        setRemoteUrl(msg.remoteUrl || '');
      } else if (msg.type === 'gitDetailGraphData' || msg.type === 'graphData') {
        const commits = msg.graphCommits || [];
        setGraphCommits(commits);
        setTotalCommits(msg.totalCommits ?? commits.length);
        setSelectedGraphFilter(msg.graphFilter || '全部分支');
        setDisplayCount(100);
        if (msg.folderName !== undefined) setFolderName(msg.folderName || '');
        if (msg.branch !== undefined) setBranch(msg.branch || '');
        if (msg.remoteUrl !== undefined) setRemoteUrl(msg.remoteUrl || '');
        setActiveCommitHash(null);
        setLoading(false);
      } else if (['gitDetailNoWorkspace', 'gitDetailNotRepo', 'gitDetailError', 'noWorkspace', 'notRepo', 'error'].includes(msg.type)) {
        setGraphCommits([]);
        setTotalCommits(0);
        setActiveCommitHash(null);
        setLoading(false);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = listRef.current;

    if (!canvas || !container || filteredCommits.length === 0) return;

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
        const x1 = line.p1.x * LANE_WIDTH + 40;
        const y1Base = yPositions[line.p1.y];
        const y1 = y1Base + CY;
        const x2 = line.p2.x * LANE_WIDTH + 40;
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
      const cx = v.getPoint().x * LANE_WIDTH + 40;
      const cy = yPositions[idx] + CY;
      const commit = filteredCommits[idx];
      const isHead = commit.refs?.includes('HEAD');

      ctx.beginPath();
      ctx.arc(cx, cy, 4, 0, 2 * Math.PI);
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
  }, [graphData, filteredCommits, displayCount, yPositions, renderedHeight]);

  const handleScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const target = event.currentTarget;
    if (target.scrollHeight - target.scrollTop <= target.clientHeight + 100) {
      if (displayCount < filteredCommits.length) setDisplayCount((prev) => prev + 50);
    }
  };

  const handleOpenChanges = (hash: string) => {
    vscode.postMessage({ command: 'openCommitMultiDiff', hash });
  };

  const handleRefresh = () => {
    setLoading(true);
    vscode.postMessage({ command: 'refreshGitDetail', graphFilter: selectedGraphFilter });
  };

  const handleChangeGraphFilter = () => {
    vscode.postMessage({ command: 'changeGitDetailFilter', current: selectedGraphFilter });
  };

  return (
    <div className={styles['git-detail-page']}>
      <div className={styles['git-detail-toolbar']}>
        <div className={styles['git-detail-title']}>
          <span>{folderName || 'quick-ops'}</span>
          <span className={styles['branch-name']}>{branch}</span>
          {totalCommits > 0 && (
            <span className={styles['total-badge']}>
              {filteredCommits.length === totalCommits ? totalCommits : `${filteredCommits.length} / ${totalCommits}`}
            </span>
          )}
        </div>

        <div className={styles['git-detail-actions']}>
          <button className={styles['toolbar-btn']} onClick={handleChangeGraphFilter}>
            <i className="codicon codicon-filter" />
            筛选分支
          </button>
          <button className={styles['toolbar-btn']} onClick={handleRefresh}>
            <i className="codicon codicon-refresh" />
            刷新
          </button>
        </div>
      </div>

      <div className={styles['detail-table-header']}>
        <div className={styles['graph-header']}>图形</div>

        <div className={styles['desc-header']}>
          描述
          <i
            ref={descFilterRef}
            className={`codicon codicon-filter ${styles['filter-icon']} ${descFilter ? styles['has-filter'] : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              setActivePopup(activePopup === 'desc' ? null : 'desc');
            }}
          />
          <FilterPopup
            visible={activePopup === 'desc'}
            triggerRef={descFilterRef}
            onClose={() => setActivePopup(null)}
          >
            <input
              type="text"
              value={descFilter}
              onChange={(e) => setDescFilter(e.target.value)}
              placeholder="输入关键词"
              className={styles['filter-input']}
            />
            <div className={styles['filter-actions']}>
              <button className={styles['filter-btn']} onClick={() => setActivePopup(null)}>确定</button>
              <button
                className={`${styles['filter-btn']} ${styles['filter-btn-secondary']}`}
                onClick={() => {
                  setDescFilter('');
                  setActivePopup(null);
                }}
              >
                清除
              </button>
            </div>
          </FilterPopup>
        </div>

        <div className={styles['date-header']}>
          日期
          <i
            ref={dateFilterRef}
            className={`codicon codicon-filter ${styles['filter-icon']} ${(dateFilter.start || dateFilter.end) ? styles['has-filter'] : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              setActivePopup(activePopup === 'date' ? null : 'date');
            }}
          />
          <FilterPopup
            visible={activePopup === 'date'}
            triggerRef={dateFilterRef}
            onClose={() => setActivePopup(null)}
            width={220}
          >
            <div className={styles['date-filter-row']}>
              <span className={styles['date-filter-label']}>开始:</span>
              <input
                type="date"
                value={dateFilter.start}
                onChange={(e) => setDateFilter({ ...dateFilter, start: e.target.value })}
                className={styles['filter-input']}
              />
            </div>
            <div className={styles['date-filter-row']}>
              <span className={styles['date-filter-label']}>结束:</span>
              <input
                type="date"
                value={dateFilter.end}
                onChange={(e) => setDateFilter({ ...dateFilter, end: e.target.value })}
                className={styles['filter-input']}
              />
            </div>
            <div className={styles['filter-actions']}>
              <button className={styles['filter-btn']} onClick={() => setActivePopup(null)}>确定</button>
              <button
                className={`${styles['filter-btn']} ${styles['filter-btn-secondary']}`}
                onClick={() => {
                  setDateFilter({ start: '', end: '' });
                  setActivePopup(null);
                }}
              >
                清除
              </button>
            </div>
          </FilterPopup>
        </div>

        <div className={styles['author-header']}>
          作者
          <i
            ref={authorFilterRef}
            className={`codicon codicon-filter ${styles['filter-icon']} ${authorFilter.length > 0 ? styles['has-filter'] : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              setActivePopup(activePopup === 'author' ? null : 'author');
            }}
          />
          <FilterPopup
            visible={activePopup === 'author'}
            triggerRef={authorFilterRef}
            onClose={() => setActivePopup(null)}
            width={220}
          >
            <div className={styles['filter-checkbox-list']}>
              {allAuthors.map((author) => (
                <label key={author} className={styles['filter-checkbox-label']} title={author}>
                  <input
                    type="checkbox"
                    checked={authorFilter.includes(author)}
                    onChange={(e) => {
                      if (e.target.checked) setAuthorFilter([...authorFilter, author]);
                      else setAuthorFilter(authorFilter.filter((a) => a !== author));
                    }}
                  />
                  <span>{author}</span>
                </label>
              ))}
            </div>
            <div className={styles['filter-actions']}>
              <button className={styles['filter-btn']} onClick={() => setActivePopup(null)}>确定</button>
              <button
                className={`${styles['filter-btn']} ${styles['filter-btn-secondary']}`}
                onClick={() => {
                  setAuthorFilter([]);
                  setActivePopup(null);
                }}
              >
                清除
              </button>
            </div>
          </FilterPopup>
        </div>

        <div className={styles['commit-header']}>
          提交
          <i
            ref={hashFilterRef}
            className={`codicon codicon-filter ${styles['filter-icon']} ${hashFilter ? styles['has-filter'] : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              setActivePopup(activePopup === 'hash' ? null : 'hash');
            }}
          />
          <FilterPopup
            visible={activePopup === 'hash'}
            triggerRef={hashFilterRef}
            onClose={() => setActivePopup(null)}
          >
            <input
              type="text"
              value={hashFilter}
              onChange={(e) => setHashFilter(e.target.value)}
              placeholder="输入 Commit 过滤"
              className={styles['filter-input']}
            />
            <div className={styles['filter-actions']}>
              <button className={styles['filter-btn']} onClick={() => setActivePopup(null)}>确定</button>
              <button
                className={`${styles['filter-btn']} ${styles['filter-btn-secondary']}`}
                onClick={() => {
                  setHashFilter('');
                  setActivePopup(null);
                }}
              >
                清除
              </button>
            </div>
          </FilterPopup>
        </div>
      </div>

      <div className={styles['git-detail-content']}>
        {loading ? (
          <div className={styles['loading-view']}>
            <i className="codicon codicon-loading codicon-modifier-spin" />
            正在加载提交记录...
          </div>
        ) : filteredCommits.length === 0 ? (
          <div className={styles['empty-view']}>{graphCommits.length === 0 ? '暂无提交记录' : '没有匹配的筛选结果'}</div>
        ) : (
          <div className={styles['commit-list-scroll']} ref={listRef} onScroll={handleScroll}>
            <canvas ref={canvasRef} className={styles['graph-canvas']} style={{ height: `${renderedHeight}px` }} />

            <ul className={styles['commit-list']} style={{ height: `${renderedHeight}px` }}>
              {visibleCommits.map((commit, index) => {
                const vertex = graphData.vertices[index];
                const paddingWidth = (vertex.getNextPoint().x + 1) * LANE_WIDTH + 96;
                const refs = getRefs(commit.refs);
                const isActive = activeCommitHash === commit.hash;

                return (
                  <li key={commit.hash} className={styles['commit-item']} style={{ top: `${yPositions[index]}px` }}>
                    <div
                      className={`${styles['commit-row']} ${isActive ? styles['active'] : ''}`}
                      // @ts-ignore
                      onClick={() => setActivePopup(null) || setActiveCommitHash(isActive ? null : commit.hash)}
                    >
                      <div className={styles['graph-space']} style={{ width: `${paddingWidth}px` }} />

                      <div className={styles['commit-desc']}>
                        <div className={styles['commit-message-line']}>
                          {refs.map((ref) => (
                            <span
                              key={ref}
                              className={`${styles['ref-tag']} ${ref.includes('origin/') ? styles['remote'] : ''} ${ref.includes('HEAD') ? styles['head'] : ''}`}
                              title={ref}
                            >
                              <i className={`codicon codicon-git-branch ${styles['ref-tag-icon']}`} />
                              {renderRefText(ref, styles)}
                            </span>
                          ))}
                          <span className={styles['commit-message']}>{commit.message}</span>
                        </div>
                      </div>

                      <div className={styles['commit-date']}>{formatDate(commit.timestamp)}</div>
                      <div className={styles['commit-author']}>{commit.author}</div>
                      <div className={styles['commit-hash']}>{commit.hash.substring(0, 7)}</div>
                    </div>

                    {isActive && (
                      <div className={styles['commit-detail-box']} style={{ top: `${ROW_HEIGHT}px` }}>
                        <div className={styles['detail-left-space']} />

                        <div className={styles['detail-info']}>
                          {/* 🌟 区域2 改成中文 */}
                          <div className={styles['detail-row']}>
                            <span className={styles['detail-label']}>提交:</span>
                            <span className={styles['detail-value']}>{commit.hash}</span>
                          </div>
                          <div className={styles['detail-row']}>
                            <span className={styles['detail-label']}>父节点:</span>
                            <span className={styles['detail-link']}>{commit.parents?.join(' ') || ''}</span>
                          </div>
                          <div className={styles['detail-row']}>
                            <span className={styles['detail-label']}>作者:</span>
                            <span className={styles['detail-value']}>{commit.author}</span>
                          </div>
                          <div className={styles['detail-row']}>
                            <span className={styles['detail-label']}>提交者:</span>
                            <span className={styles['detail-value']}>{commit.author}</span>
                          </div>
                          <div className={styles['detail-row']}>
                            <span className={styles['detail-label']}>日期:</span>
                            <span className={styles['detail-value']}>{formatDate(commit.timestamp)}</span>
                          </div>
                          <div className={styles['detail-row']}>
                            <span className={styles['detail-label']}>远程:</span>
                            <span className={styles['detail-value']}>{remoteUrl}</span>
                          </div>
                          <div className={styles['detail-message']}>{commit.message}</div>
                        </div>

                        <div className={styles['detail-actions']}>
                          <button className={styles['open-changes-btn']} onClick={() => handleOpenChanges(commit.hash)}>
                            <i className="codicon codicon-diff-multiple" />
                            打开更改
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}