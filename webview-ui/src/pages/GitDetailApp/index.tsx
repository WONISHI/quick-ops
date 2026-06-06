import React, { useEffect, useMemo, useRef, useState } from 'react';
import FilterPopup, {
  FilterPopupActions,
  FilterPopupButton,
  FilterPopupCheckboxLabel,
  FilterPopupCheckboxList,
  FilterPopupDateRow,
  FilterPopupInput,
} from '../../components/FilterPopup';
import { vscode } from '../../utils/vscode';
import styles from './index.module.css';
import FileIcon from '../../components/FileIcon';

interface GitFileItem {
  status: string;
  file: string;
  baseRef?: string;
}

interface CommitFilesState {
  parentHash?: string;
  files: GitFileItem[];
}

interface CommitFileTreeNode {
  name: string;
  fullPath: string;
  isDirectory: boolean;
  children: CommitFileTreeNode[];
  file?: GitFileItem;
}

export interface GraphCommit {
  hash: string;
  parents?: string[];
  author: string;
  email?: string;
  message: string;
  timestamp?: number;
  refs?: string;
  type?: 'commit' | 'uncommitted' | 'stash';
}

const COLORS = ['#007acc', '#f14c4c', '#89d185', '#cca700', '#c586c0', '#4fc1ff'];
const LANE_WIDTH = 14;
const ROW_HEIGHT = 28;
const DETAIL_HEIGHT = 206;
const CY = 14;

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
    this.lines.push({
      p1,
      p2,
      lockedFirst,
    });
  }
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

  constructor(id: number) {
    this.id = id;
  }

  addChild(v: Vertex) {
    this.children.push(v);
  }

  addParent(v: Vertex) {
    this.parents.push(v);
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
    return {
      x: this.x,
      y: this.id,
    };
  }

  getNextPoint(): Point {
    return {
      x: this.nextX,
      y: this.id,
    };
  }

  getPointConnectingTo(v: Vertex | null, b: Branch) {
    for (let i = 0; i < this.connections.length; i++) {
      if (
        this.connections[i] &&
        this.connections[i].connectsTo === v &&
        this.connections[i].onBranch === b
      ) {
        return {
          x: i,
          y: this.id,
        };
      }
    }

    return null;
  }

  registerUnavailablePoint(x: number, v: Vertex | null, b: Branch) {
    if (x === this.nextX) {
      this.nextX = x + 1;
      this.connections[x] = {
        connectsTo: v,
        onBranch: b,
      };
    }
  }
}

function buildGraphEngine(commits: GraphCommit[]) {
  const vertices = commits.map((_, i) => new Vertex(i));
  const commitLookup: Record<string, number> = {};
  const nullVertex = new Vertex(NULL_VERTEX_ID);

  commits.forEach((commit, index) => {
    commitLookup[commit.hash] = index;
  });

  commits.forEach((commit, index) => {
    const parents = commit.type === 'stash'
      ? (commit.parents || []).slice(0, 1)
      : commit.parents || [];

    parents.forEach((parentHash) => {
      if (commitLookup[parentHash] !== undefined) {
        vertices[index].addParent(vertices[commitLookup[parentHash]]);
        vertices[commitLookup[parentHash]].addChild(vertices[index]);
      } else if (commit.type !== 'stash') {
        vertices[index].addParent(nullVertex);
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
      const branch = new Branch(getAvailableColour(startAt));

      vertex.addToBranch(branch, lastPoint.x);
      vertex.registerUnavailablePoint(lastPoint.x, vertex, branch);

      for (i = startAt + 1; i < vertices.length; i++) {
        curVertex = vertices[i];
        curPoint =
          parentVertex === curVertex && !parentVertex.isNotOnBranch()
            ? curVertex.getPoint()
            : curVertex.getNextPoint();

        branch.addLine(lastPoint, curPoint, lastPoint.x < curPoint.x);
        curVertex.registerUnavailablePoint(curPoint.x, parentVertex, branch);
        lastPoint = curPoint;

        if (parentVertex === curVertex) {
          vertex.registerParentProcessed();

          const parentVertexOnBranch = !parentVertex.isNotOnBranch();

          parentVertex.addToBranch(branch, curPoint.x);
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

      branches.push(branch);
      availableColours[branch.colour] = i;
    }
  };

  let index = 0;

  while (index < vertices.length) {
    if (vertices[index].getNextParent() !== null || vertices[index].isNotOnBranch()) {
      determinePath(index);
    } else {
      index++;
    }
  }

  return {
    vertices,
    branches,
  };
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

  return refs
    .split(',')
    .map((ref) => ref.trim())
    .filter(Boolean);
}

function buildCommitFileTree(files: GitFileItem[]) {
  const roots: CommitFileTreeNode[] = [];
  const dirMap = new Map<string, CommitFileTreeNode>();

  const ensureDir = (name: string, fullPath: string) => {
    const existing = dirMap.get(fullPath);

    if (existing) return existing;

    const node: CommitFileTreeNode = {
      name,
      fullPath,
      isDirectory: true,
      children: [],
    };

    dirMap.set(fullPath, node);

    const parentPath = fullPath.includes('/') ? fullPath.substring(0, fullPath.lastIndexOf('/')) : '';

    if (parentPath) {
      const parentName = parentPath.split('/').pop() || parentPath;
      const parent = ensureDir(parentName, parentPath);
      parent.children.push(node);
    } else {
      roots.push(node);
    }

    return node;
  };

  files.forEach((fileItem) => {
    const parts = fileItem.file.split('/');
    const fileName = parts.pop() || fileItem.file;

    let parentChildren = roots;

    if (parts.length > 0) {
      let currentPath = '';

      parts.forEach((part) => {
        currentPath = currentPath ? `${currentPath}/${part}` : part;
        ensureDir(part, currentPath);
      });

      const parentPath = parts.join('/');
      const parent = dirMap.get(parentPath);

      if (parent) {
        parentChildren = parent.children;
      }
    }

    parentChildren.push({
      name: fileName,
      fullPath: fileItem.file,
      isDirectory: false,
      children: [],
      file: fileItem,
    });
  });

  const sortNodes = (nodes: CommitFileTreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) {
        return a.isDirectory ? -1 : 1;
      }

      return a.name.localeCompare(b.name);
    });

    nodes.forEach((node) => {
      if (node.isDirectory) {
        sortNodes(node.children);
      }
    });
  };

  sortNodes(roots);

  return roots;
}

function getCommitFileStatusText(status: string) {
  if (status === 'A') return 'A';
  if (status === 'D') return 'D';
  if (status === 'M') return 'M';
  if (status === 'R') return 'R';
  if (status === 'C') return 'C';

  return status || '?';
}

function getCommitFileStatusClass(status: string) {
  if (status === 'A') return styles['commit-file-status-added'];
  if (status === 'D') return styles['commit-file-status-deleted'];
  if (status === 'M') return styles['commit-file-status-modified'];

  return styles['commit-file-status-normal'];
}


function getRefTagClassName(ref: string) {
  const refName = ref.trim();

  return [
    styles['ref-tag'],
    refName.includes('HEAD ->') || refName === 'HEAD' ? styles['head'] : '',
    refName.startsWith('origin/') ? styles['remote'] : '',
    refName.startsWith('stash@') ? styles['stash'] : '',
  ]
    .filter(Boolean)
    .join(' ');
}

function getRefTagIcon(ref: string) {
  const refName = ref.trim();

  if (refName.startsWith('stash@')) {
    return 'codicon-archive';
  }

  if (refName.includes('HEAD ->') || refName === 'HEAD') {
    return 'codicon-git-branch';
  }

  if (refName.startsWith('origin/')) {
    return 'codicon-git-branch';
  }

  return 'codicon-git-branch';
}

function getCommitDisplayMessage(commit: GraphCommit) {
  if (commit.type === 'uncommitted') {
    return commit.message || 'Uncommitted Changes';
  }

  return commit.message;
}

function renderRefText(ref: string) {
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

  const [descFilter, setDescFilter] = useState('');
  const [dateFilter, setDateFilter] = useState({
    start: '',
    end: '',
  });
  const [authorFilter, setAuthorFilter] = useState<string[]>([]);
  const [hashFilter, setHashFilter] = useState('');
  const [activePopup, setActivePopup] = useState<'desc' | 'date' | 'author' | 'hash' | null>(null);

  const [commitFilesMap, setCommitFilesMap] = useState<Record<string, CommitFilesState>>({});
  const [commitFilesLoadingMap, setCommitFilesLoadingMap] = useState<Record<string, boolean>>({});
  const [expandedCommitDirs, setExpandedCommitDirs] = useState<Record<string, boolean>>({});

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const descFilterRef = useRef<HTMLElement | null>(null);
  const dateFilterRef = useRef<HTMLElement | null>(null);
  const authorFilterRef = useRef<HTMLElement | null>(null);
  const hashFilterRef = useRef<HTMLElement | null>(null);

  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const [resizeVersion, setResizeVersion] = useState(0);

  const allAuthors = useMemo(() => {
    const authors = new Set<string>();

    graphCommits.forEach((commit) => {
      if (commit.author) {
        authors.add(commit.author);
      }
    });

    return Array.from(authors);
  }, [graphCommits]);

  const filteredCommits = useMemo(() => {
    return graphCommits.filter((commit) => {
      if (descFilter && !commit.message.toLowerCase().includes(descFilter.toLowerCase())) {
        return false;
      }

      if (hashFilter && !commit.hash.toLowerCase().includes(hashFilter.toLowerCase())) {
        return false;
      }

      if (dateFilter.start) {
        const startMs = new Date(dateFilter.start).getTime();

        if (commit.timestamp && commit.timestamp < startMs) {
          return false;
        }
      }

      if (dateFilter.end) {
        const endMs = new Date(dateFilter.end).getTime() + 86399999;

        if (commit.timestamp && commit.timestamp > endMs) {
          return false;
        }
      }

      if (authorFilter.length > 0 && !authorFilter.includes(commit.author)) {
        return false;
      }

      return true;
    });
  }, [graphCommits, descFilter, dateFilter, authorFilter, hashFilter]);

  useEffect(() => {
    setDisplayCount(100);
  }, [filteredCommits.length]);

  const graphData = useMemo(() => {
    return buildGraphEngine(filteredCommits);
  }, [filteredCommits]);

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
    if (!activeCommitHash) return;

    if (commitFilesMap[activeCommitHash] || commitFilesLoadingMap[activeCommitHash]) {
      return;
    }

    setCommitFilesLoadingMap((prev) => ({
      ...prev,
      [activeCommitHash]: true,
    }));

    vscode.postMessage({
      command: 'getGitDetailCommitFiles',
      hash: activeCommitHash,
    });
  }, [activeCommitHash, commitFilesMap, commitFilesLoadingMap]);

  useEffect(() => {
    if (!activeCommitHash || !commitFilesLoadingMap[activeCommitHash]) return;

    const timer = window.setTimeout(() => {
      setCommitFilesLoadingMap((prev) => {
        if (!prev[activeCommitHash]) return prev;

        return {
          ...prev,
          [activeCommitHash]: false,
        };
      });

      setCommitFilesMap((prev) => {
        if (prev[activeCommitHash]) return prev;

        return {
          ...prev,
          [activeCommitHash]: {
            files: [],
          },
        };
      });
    }, 8000);

    return () => {
      window.clearTimeout(timer);
    };
  }, [activeCommitHash, commitFilesLoadingMap]);

  useEffect(() => {
    resizeObserverRef.current?.disconnect();

    const container = listRef.current;

    if (!container) return;

    let frameId = 0;

    const observer = new ResizeObserver(() => {
      if (frameId) {
        cancelAnimationFrame(frameId);
      }

      frameId = requestAnimationFrame(() => {
        setResizeVersion((prev) => prev + 1);
      });
    });

    observer.observe(container);
    resizeObserverRef.current = observer;

    return () => {
      if (frameId) {
        cancelAnimationFrame(frameId);
      }

      observer.disconnect();

      if (resizeObserverRef.current === observer) {
        resizeObserverRef.current = null;
      }
    };
  }, [loading]);

  useEffect(() => {
    const handleResize = () => {
      setResizeVersion((prev) => prev + 1);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  useEffect(() => {
    vscode.postMessage({
      command: 'gitDetailLoaded',
    });

    const handleMessage = (event: MessageEvent) => {
      const msg = event.data;

      if (msg.type === 'gitDetailLoading' || msg.type === 'startLoading') {
        setLoading(true);
        return;
      }

      if (msg.type === 'statusData') {
        setFolderName(msg.folderName || '');
        setBranch(msg.branch || '');
        setRemoteUrl(msg.remoteUrl || '');
        return;
      }

      if (msg.type === 'gitDetailCommitFilesData') {
        setCommitFilesMap((prev) => ({
          ...prev,
          [msg.hash]: {
            files: msg.files || [],
            parentHash: msg.parentHash,
          },
        }));

        setCommitFilesLoadingMap((prev) => ({
          ...prev,
          [msg.hash]: false,
        }));

        return;
      }

      if (msg.type === 'gitDetailGraphData' || msg.type === 'graphData') {
        const commits = msg.graphCommits || [];

        setCommitFilesMap({});
        setCommitFilesLoadingMap({});
        setExpandedCommitDirs({});

        setGraphCommits(commits);
        setTotalCommits(msg.totalCommits ?? commits.length);
        setSelectedGraphFilter(msg.graphFilter || '全部分支');
        setDisplayCount(100);
        setActiveCommitHash(null);

        if (msg.folderName !== undefined) {
          setFolderName(msg.folderName || '');
        }

        if (msg.branch !== undefined) {
          setBranch(msg.branch || '');
        }

        if (msg.remoteUrl !== undefined) {
          setRemoteUrl(msg.remoteUrl || '');
        }

        setResizeVersion((prev) => prev + 1);
        setLoading(false);
        return;
      }

      if (
        [
          'gitDetailNoWorkspace',
          'gitDetailNotRepo',
          'gitDetailError',
          'noWorkspace',
          'notRepo',
          'error',
        ].includes(msg.type)
      ) {
        setGraphCommits([]);
        setTotalCommits(0);
        setActiveCommitHash(null);
        setResizeVersion((prev) => prev + 1);
        setLoading(false);
      }
    };

    window.addEventListener('message', handleMessage);

    return () => {
      window.removeEventListener('message', handleMessage);
    };
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

    canvas.style.width = `${containerWidth}px`;
    canvas.style.height = `${renderedHeight}px`;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, containerWidth, renderedHeight);

    graphData.branches.forEach((branchItem) => {
      const color = COLORS[branchItem.colour % COLORS.length];

      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      let lastPt: { x: number; y: number } | null = null;

      branchItem.lines.forEach((line, index) => {
        const x1 = line.p1.x * LANE_WIDTH + 40;
        const y1Base = yPositions[line.p1.y];
        const y1 = y1Base + CY;

        const x2 = line.p2.x * LANE_WIDTH + 40;
        const y2Base = yPositions[line.p2.y];
        const y2 = y2Base + CY;

        if (index === 0 || lastPt?.x !== x1 || lastPt?.y !== y1) {
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

        lastPt = {
          x: x2,
          y: y2,
        };
      });

      ctx.stroke();
    });

    const bgColor =
      getComputedStyle(document.documentElement).getPropertyValue('--vscode-sideBar-background').trim() ||
      '#252526';

    graphData.vertices.slice(0, displayCount).forEach((vertex, index) => {
      const cx = vertex.getPoint().x * LANE_WIDTH + 40;
      const cy = yPositions[index] + CY;
      const commit = filteredCommits[index];
      const isHead = commit.refs?.includes('HEAD');

      ctx.beginPath();
      ctx.arc(cx, cy, 4, 0, 2 * Math.PI);

      const vertexBranch = vertex.getBranch();
      const dotColor = vertexBranch ? COLORS[vertexBranch.colour % COLORS.length] : '#808080';

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
  }, [
    graphData,
    filteredCommits,
    displayCount,
    yPositions,
    renderedHeight,
    resizeVersion,
  ]);

  const handleScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const target = event.currentTarget;

    if (target.scrollHeight - target.scrollTop <= target.clientHeight + 100) {
      if (displayCount < filteredCommits.length) {
        setDisplayCount((prev) => prev + 50);
      }
    }
  };

  const handleRefresh = () => {
    setLoading(true);

    vscode.postMessage({
      command: 'refreshGitDetail',
      graphFilter: selectedGraphFilter,
    });
  };

  const handleChangeGraphFilter = () => {
    vscode.postMessage({
      command: 'changeGitDetailFilter',
      current: selectedGraphFilter,
    });
  };

  const togglePopup = (popup: 'desc' | 'date' | 'author' | 'hash') => {
    setActivePopup((current) => (current === popup ? null : popup));
  };

  const renderCommitFileTree = (
    hash: string,
    parentHash: string | undefined,
    nodes: CommitFileTreeNode[],
    depth = 0,
  ): React.ReactNode => {
    return nodes.map((node) => {
      if (node.isDirectory) {
        const isOpen = isCommitDirOpen(hash, node.fullPath);

        return (
          <React.Fragment key={node.fullPath}>
            <div
              className={`${styles['commit-file-row']} ${styles['commit-file-dir-row']}`}
              style={{
                paddingLeft: `${depth * 14 + 8}px`,
              }}
              onClick={(event) => toggleCommitDir(hash, node.fullPath, event)}
            >
              <i
                className={`codicon ${isOpen ? 'codicon-chevron-down' : 'codicon-chevron-right'
                  } ${styles['commit-file-chevron']}`}
              />
              <i
                className={`codicon ${isOpen ? 'codicon-folder-opened' : 'codicon-folder'
                  } ${styles['commit-file-icon']}`}
              />
              <span className={styles['commit-file-name']}>{node.name}</span>
            </div>

            {isOpen && renderCommitFileTree(hash, parentHash, node.children, depth + 1)}
          </React.Fragment>
        );
      }

      const file = node.file!;

      return (
        <div
          key={node.fullPath}
          className={`${styles['commit-file-row']} ${styles['commit-file-leaf-row']}`}
          style={{
            paddingLeft: `${depth * 14 + 24}px`,
          }}
          title={file.file}
          onClick={(event) => {
            event.stopPropagation();

            vscode.postMessage({
              command: 'openGitDetailCommitFileDiff',
              hash,
              parentHash,
              file: file.file,
              status: file.status,
            });
          }}
        >
          <FileIcon fileName={node.name} className={styles['commit-file-icon']} />

          <span className={`${styles['commit-file-name']} ${file.status === 'D' ? styles['commit-file-deleted-name'] : ''}`}>
            {node.name}
          </span>

          <span className={styles['commit-file-spacer']} />

          <span className={`${styles['commit-file-status']} ${getCommitFileStatusClass(file.status)}`}>
            {getCommitFileStatusText(file.status)}
          </span>
        </div>
      );
    });
  };

  const getCommitDirKey = (hash: string, dirPath: string) => {
    return `${hash}::${dirPath}`;
  };

  const isCommitDirOpen = (hash: string, dirPath: string) => {
    return expandedCommitDirs[getCommitDirKey(hash, dirPath)] !== false;
  };

  const toggleCommitDir = (hash: string, dirPath: string, event: React.MouseEvent) => {
    event.stopPropagation();

    const key = getCommitDirKey(hash, dirPath);

    setExpandedCommitDirs((prev) => ({
      ...prev,
      [key]: prev[key] === false ? true : false,
    }));
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
            onClick={(event) => {
              event.stopPropagation();
              togglePopup('desc');
            }}
          />

          <FilterPopup
            visible={activePopup === 'desc'}
            anchorRef={descFilterRef}
            width={260}
            onClose={() => setActivePopup(null)}
          >
            <FilterPopupInput
              type="text"
              value={descFilter}
              onChange={(event) => setDescFilter(event.target.value)}
              placeholder="输入关键词"
            />

            <FilterPopupActions>
              <FilterPopupButton onClick={() => setActivePopup(null)}>确定</FilterPopupButton>

              <FilterPopupButton
                secondary
                onClick={() => {
                  setDescFilter('');
                  setActivePopup(null);
                }}
              >
                清除
              </FilterPopupButton>
            </FilterPopupActions>
          </FilterPopup>
        </div>

        <div className={styles['date-header']}>
          日期
          <i
            ref={dateFilterRef}
            className={`codicon codicon-filter ${styles['filter-icon']} ${dateFilter.start || dateFilter.end ? styles['has-filter'] : ''
              }`}
            onClick={(event) => {
              event.stopPropagation();
              togglePopup('date');
            }}
          />

          <FilterPopup
            visible={activePopup === 'date'}
            anchorRef={dateFilterRef}
            width={310}
            onClose={() => setActivePopup(null)}
          >
            <FilterPopupDateRow label="开始:">
              <FilterPopupInput
                type="date"
                value={dateFilter.start}
                onChange={(event) =>
                  setDateFilter({
                    ...dateFilter,
                    start: event.target.value,
                  })
                }
              />
            </FilterPopupDateRow>

            <FilterPopupDateRow label="结束:">
              <FilterPopupInput
                type="date"
                value={dateFilter.end}
                onChange={(event) =>
                  setDateFilter({
                    ...dateFilter,
                    end: event.target.value,
                  })
                }
              />
            </FilterPopupDateRow>

            <FilterPopupActions>
              <FilterPopupButton onClick={() => setActivePopup(null)}>确定</FilterPopupButton>

              <FilterPopupButton
                secondary
                onClick={() => {
                  setDateFilter({
                    start: '',
                    end: '',
                  });
                  setActivePopup(null);
                }}
              >
                清除
              </FilterPopupButton>
            </FilterPopupActions>
          </FilterPopup>
        </div>

        <div className={styles['author-header']}>
          作者
          <i
            ref={authorFilterRef}
            className={`codicon codicon-filter ${styles['filter-icon']} ${authorFilter.length > 0 ? styles['has-filter'] : ''
              }`}
            onClick={(event) => {
              event.stopPropagation();
              togglePopup('author');
            }}
          />

          <FilterPopup
            visible={activePopup === 'author'}
            anchorRef={authorFilterRef}
            width={260}
            onClose={() => setActivePopup(null)}
          >
            <FilterPopupCheckboxList>
              {allAuthors.map((author) => (
                <FilterPopupCheckboxLabel key={author}>
                  <input
                    type="checkbox"
                    checked={authorFilter.includes(author)}
                    onChange={(event) => {
                      if (event.target.checked) {
                        setAuthorFilter([...authorFilter, author]);
                      } else {
                        setAuthorFilter(authorFilter.filter((item) => item !== author));
                      }
                    }}
                  />
                  {author}
                </FilterPopupCheckboxLabel>
              ))}
            </FilterPopupCheckboxList>

            <FilterPopupActions>
              <FilterPopupButton onClick={() => setActivePopup(null)}>确定</FilterPopupButton>

              <FilterPopupButton
                secondary
                onClick={() => {
                  setAuthorFilter([]);
                  setActivePopup(null);
                }}
              >
                清除
              </FilterPopupButton>
            </FilterPopupActions>
          </FilterPopup>
        </div>

        <div className={styles['commit-header']}>
          提交
          <i
            ref={hashFilterRef}
            className={`codicon codicon-filter ${styles['filter-icon']} ${hashFilter ? styles['has-filter'] : ''}`}
            onClick={(event) => {
              event.stopPropagation();
              togglePopup('hash');
            }}
          />

          <FilterPopup
            visible={activePopup === 'hash'}
            anchorRef={hashFilterRef}
            width={260}
            onClose={() => setActivePopup(null)}
          >
            <FilterPopupInput
              type="text"
              value={hashFilter}
              onChange={(event) => setHashFilter(event.target.value)}
              placeholder="输入 Commit 过滤"
            />

            <FilterPopupActions>
              <FilterPopupButton onClick={() => setActivePopup(null)}>确定</FilterPopupButton>

              <FilterPopupButton
                secondary
                onClick={() => {
                  setHashFilter('');
                  setActivePopup(null);
                }}
              >
                清除
              </FilterPopupButton>
            </FilterPopupActions>
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
            <canvas ref={canvasRef} className={styles['graph-canvas']} />

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
                      onClick={() => {
                        setActivePopup(null);
                        setActiveCommitHash(isActive ? null : commit.hash);
                      }}
                    >
                      <div className={styles['graph-space']} style={{ width: `${paddingWidth}px` }} />

                      <div className={styles['commit-desc']}>
                        <div className={styles['commit-message-line']}>
                          {refs.map((ref) => (
                            <span
                              key={ref}
                              className={getRefTagClassName(ref)}
                              title={ref}
                            >
                              <i className={`codicon ${getRefTagIcon(ref)} ${styles['ref-tag-icon']}`} />
                              {renderRefText(ref)}
                            </span>
                          ))}

                          <span className={styles['commit-message']}>{getCommitDisplayMessage(commit)}</span>
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

                          <div className={styles['detail-message']}>{getCommitDisplayMessage(commit)}</div>
                        </div>

                        <div className={styles['detail-actions']}>
                          <div className={styles['commit-files-panel']}>
                            {commitFilesLoadingMap[commit.hash] ? (
                              <div className={styles['commit-files-loading']}>
                                <i className="codicon codicon-loading codicon-modifier-spin" />
                                正在加载文件...
                              </div>
                            ) : !commitFilesMap[commit.hash] || commitFilesMap[commit.hash].files.length === 0 ? (
                              <div className={styles['commit-files-empty']}>暂无文件变更</div>
                            ) : (
                              <div className={styles['commit-files-tree']}>
                                {renderCommitFileTree(
                                  commit.hash,
                                  commitFilesMap[commit.hash].parentHash,
                                  buildCommitFileTree(commitFilesMap[commit.hash].files),
                                )}
                              </div>
                            )}
                          </div>
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