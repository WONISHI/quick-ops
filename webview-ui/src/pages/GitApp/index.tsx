import React, { useState, useEffect, useRef, useCallback } from 'react';
import { vscode } from '../../utils/vscode';
import styles from './index.module.css';
import Tooltip from '../../components/Tooltip';
import GitGraph, { type GraphCommit } from '../../components/GitGraph';
import GitCompareList from '../../components/GitCompareList';
import GitFileList from '../../components/GitFileList';
import GitNotInstalled from '../../components/GitNotInstalled';
import LoadingMask from '../../components/LoadingMask';
import type { GitFile } from '../../types/GitApp';
import CommitTypeTag, { type CommitType } from '../../components/CommitTypeTag';
import GraphMoreMenu from '../../components/GraphMoreMenu';
import { GitContextMenu, type ContextMenuState } from '../../components/GitContextMenu';

interface RemoteSyncState {
  hasRemote: boolean;
  hasUpstream: boolean;
  branch: string;
  upstream: string;
  ahead: number;
  behind: number;
  needsPull: boolean;
  needsPush: boolean;
  checkedAt: number;
  error?: string;
}

const EMPTY_REMOTE_SYNC: RemoteSyncState = {
  hasRemote: false,
  hasUpstream: false,
  branch: '',
  upstream: '',
  ahead: 0,
  behind: 0,
  needsPull: false,
  needsPush: false,
  checkedAt: 0,
};

interface CommitDraftSnapshot {
  message: string;
  commitType: CommitType;
  commitTypeEnabled: boolean;
  finalMessage: string;
}

const COMMIT_TYPE_ALIAS_MAP: Record<string, CommitType> = {
  feat: 'feat' as CommitType,
  feature: 'feat' as CommitType,
  fix: 'fix' as CommitType,
  bugfix: 'fix' as CommitType,
  docs: 'docs' as CommitType,
  doc: 'docs' as CommitType,
  style: 'style' as CommitType,
  refactor: 'refactor' as CommitType,
  perf: 'perf' as CommitType,
  performance: 'perf' as CommitType,
  test: 'test' as CommitType,
  tests: 'test' as CommitType,
  chore: 'chore' as CommitType,
  build: 'build' as CommitType,
  ci: 'ci' as CommitType,
  revert: 'revert' as CommitType,
};

const normalizeCommitTypeText = (value: string) => {
  return value.trim().toLowerCase();
};

const parseCommitTypeFromText = (value: string) => {
  const text = value.replace(/\r\n/g, '\n').trimStart();
  const match = text.match(/^([a-zA-Z][a-zA-Z0-9_-]*?)\s*[:：]\s*([\s\S]*)$/);

  if (!match) {
    return null;
  }

  const type = COMMIT_TYPE_ALIAS_MAP[normalizeCommitTypeText(match[1])];

  if (!type) {
    return null;
  }

  return {
    type,
    message: match[2].replace(/^\s+/, ''),
  };
};

export default function GitApp() {
  const [isRepo, setIsRepo] = useState<boolean>(true);
  const [isGitInstalled, setIsGitInstalled] = useState<boolean | null>(null);

  const [stagedFiles, setStagedFiles] = useState<GitFile[]>([]);
  const [unstagedFiles, setUnstagedFiles] = useState<GitFile[]>([]);
  const [conflictedFiles, setConflictedFiles] = useState<GitFile[]>([]);

  const [branch, setBranch] = useState('');
  const [commitMsg, setCommitMsg] = useState('');
  const [commitTypeEnabled, setCommitTypeEnabled] = useState(false);
  const [commitType, setCommitType] = useState<CommitType>('feat');
  const [loading, setLoading] = useState(false);
  const [changesRefreshing, setChangesRefreshing] = useState(false);
  const [activeFile, setActiveFile] = useState<string | null>(null);

  const [isChangesOpen, setIsChangesOpen] = useState(true);
  const [isStashesOpen, setIsStashesOpen] = useState(false);
  const [isGraphOpen, setIsGraphOpen] = useState(true);
  const [isGraphSearchOpen, setIsGraphSearchOpen] = useState(false);

  const [justCommitted, setJustCommitted] = useState(false);
  const currentBranchRef = useRef('');
  const justCommittedBranchRef = useRef('');
  const pendingCommitSnapshotRef = useRef<CommitDraftSnapshot | null>(null);
  const lastCommittedSnapshotRef = useRef<CommitDraftSnapshot | null>(null);

  const [graphCommits, setGraphCommits] = useState<GraphCommit[]>([]);
  const [isGraphLoading, setIsGraphLoading] = useState(true);
  const [remoteUrl, setRemoteUrl] = useState<string>('');
  const [remoteSync, setRemoteSync] = useState<RemoteSyncState>(EMPTY_REMOTE_SYNC);
  const [totalCommits, setTotalCommits] = useState(0);

  const [viewMode, setViewMode] = useState<'list' | 'tree'>('list');
  const [expandedDirs, setExpandedDirs] = useState<Record<string, boolean>>({});

  const [displayCount, setDisplayCount] = useState(100);

  const [expandedCommitHashes, setExpandedCommitHashes] = useState<string[]>([]);
  const [activeCommitHash, setActiveCommitHash] = useState<string | null>(null);

  const [commitFilesMap, setCommitFilesMap] = useState<Record<string, GitFile[]>>({});
  const [commitFilesLoadingMap, setCommitFilesLoadingMap] = useState<Record<string, boolean>>({});
  const [commitParentHashMap, setCommitParentHashMap] = useState<Record<string, string | undefined>>({});

  const [compareTarget, setCompareTarget] = useState<string | null>(null);
  const [compareBase, setCompareBase] = useState<string | null>(null);
  const [compareCommits, setCompareCommits] = useState<GraphCommit[]>([]);
  const [isCompareOpen, setIsCompareOpen] = useState(false);
  const [activeCompareCommitHash, setActiveCompareCommitHash] = useState<string | null>(null);

  const [skipVerify, setSkipVerify] = useState(false);
  const [selectedGraphFilter, setSelectedGraphFilter] = useState('全部分支');
  const filterRef = useRef('全部分支');
  const [flashBranchBtn, setFlashBranchBtn] = useState(false);

  const [folderName, setFolderName] = useState('');

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  const [stashes, setStashes] = useState<any[]>([]);
  const [expandedStashIndex, setExpandedStashIndex] = useState<number | null>(null);
  const [stashFilesMap, setStashFilesMap] = useState<Record<number, GitFile[]>>({});
  const [stashFilesLoading, setStashFilesLoading] = useState<Record<number, boolean>>({});

  const lastRefreshRef = useRef<number>(0);
  const commitInputRef = useRef<HTMLDivElement>(null);
  const graphSectionRef = useRef<HTMLDivElement>(null);
  const graphResizeStartRef = useRef({ y: 0, height: 50 });
  const [graphSectionHeight, setGraphSectionHeight] = useState(50);

  const getNormalizedCommitMessage = () => {
    return commitMsg.replace(/\n/g, '').trim();
  };

  const clampGraphSectionHeight = (height: number) => {
    return Math.min(70, Math.max(30, height));
  };

  const handleGraphResizeMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!isGraphOpen) return;

      e.preventDefault();
      e.stopPropagation();

      graphResizeStartRef.current = {
        y: e.clientY,
        height: graphSectionHeight,
      };

      document.body.classList.add(styles['graph-resizing']);

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 1;
        const deltaY = moveEvent.clientY - graphResizeStartRef.current.y;
        const deltaPercent = (deltaY / viewportHeight) * 100;
        const nextHeight = clampGraphSectionHeight(graphResizeStartRef.current.height - deltaPercent);

        setGraphSectionHeight(nextHeight);
      };

      const handleMouseUp = () => {
        document.body.classList.remove(styles['graph-resizing']);
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    },
    [graphSectionHeight, isGraphOpen],
  );

  const canCommit = isRepo && !loading && !!getNormalizedCommitMessage() && stagedFiles.length > 0;


  const setCommitInputValue = (value: string) => {
    setCommitMsg(value);

    requestAnimationFrame(() => {
      if (commitInputRef.current) {
        commitInputRef.current.innerText = value;
      }
    });
  };

  const clearCommitDraft = () => {
    setCommitMsg('');

    requestAnimationFrame(() => {
      if (commitInputRef.current) {
        commitInputRef.current.innerText = '';
      }
    });
  };

  const restoreCommitDraft = (snapshot: CommitDraftSnapshot) => {
    setCommitType(snapshot.commitType);
    setCommitTypeEnabled(snapshot.commitTypeEnabled);
    setCommitInputValue(snapshot.message);
    setJustCommitted(false);

    requestAnimationFrame(() => {
      commitInputRef.current?.focus();
    });
  };

  const restoreCommitMessageText = (value: string) => {
    const message = value.trim();

    if (!message) return;

    const parsed = parseCommitTypeFromText(message);

    if (parsed) {
      setCommitType(parsed.type);
      setCommitTypeEnabled(true);
      setCommitInputValue(parsed.message);
    } else {
      setCommitInputValue(message);
    }

    setJustCommitted(false);

    requestAnimationFrame(() => {
      commitInputRef.current?.focus();
    });
  };

  useEffect(() => {
    lastRefreshRef.current = Date.now();
    vscode.postMessage({ command: 'webviewLoaded' });

    const handleMsg = (e: MessageEvent) => {
      const msg = e.data;

      if (msg.type === 'startLoading') {
        setIsGraphLoading(true);
      } else if (msg.type === 'noWorkspace' || msg.type === 'notRepo') {
        setLoading(false);
        setChangesRefreshing(false);
        setIsGraphLoading(false);
        setIsRepo(false);
        setBranch(msg.type === 'noWorkspace' ? '无工作区' : '未初始化');
        setStagedFiles([]);
        setUnstagedFiles([]);
        setConflictedFiles([]);
        setGraphCommits([]);
        setTotalCommits(0);
        setCompareCommits([]);
        setExpandedCommitHashes([]);
        setCommitFilesMap({});
        setCommitFilesLoadingMap({});
        setCommitParentHashMap({});
        setActiveCommitHash(null);
        setActiveCompareCommitHash(null);
        setStashes([]);
        setStashFilesMap({});
        setStashFilesLoading({});
        setExpandedStashIndex(null);
        setRemoteSync(EMPTY_REMOTE_SYNC);
        currentBranchRef.current = '';
        justCommittedBranchRef.current = '';
        setJustCommitted(false);
      } else if (msg.type === 'statusData') {
        setIsRepo(true);
        setChangesRefreshing(false);
        setStagedFiles(msg.stagedFiles || []);
        setUnstagedFiles(msg.unstagedFiles || []);
        setConflictedFiles(msg.conflictedFiles || []);

        const nextBranch = msg.branch || '';

        if (justCommittedBranchRef.current && nextBranch && nextBranch !== justCommittedBranchRef.current) {
          justCommittedBranchRef.current = '';
          setJustCommitted(false);
        }

        currentBranchRef.current = nextBranch;
        setBranch(nextBranch);
        setRemoteUrl(msg.remoteUrl || '');
        setFolderName(msg.folderName || '');

        if (msg.defaultCommitTypeEnabled !== undefined) {
          setCommitTypeEnabled(!!msg.defaultCommitTypeEnabled);
        }

        if (msg.remoteSync) {
          setRemoteSync(msg.remoteSync);
        } else {
          setRemoteSync(EMPTY_REMOTE_SYNC);
        }

        if (msg.stashes) {
          setStashes(msg.stashes);
        }

        setLoading(false);
      } else if (msg.type === 'remoteSyncData') {
        setRemoteSync(msg.remoteSync || EMPTY_REMOTE_SYNC);
      } else if (msg.type === 'stopGraphLoading') {
        setIsGraphLoading(false);
      } else if (msg.type === 'stashData') {
        setStashes(msg.stashes || []);
      } else if (msg.type === 'stashFilesData') {
        setStashFilesMap((prev) => ({ ...prev, [msg.index]: msg.files || [] }));
        setStashFilesLoading((prev) => ({ ...prev, [msg.index]: false }));
      } else if (msg.type === 'graphData') {
        const commits = msg.graphCommits || [];

        setGraphCommits(commits);
        setTotalCommits(msg.totalCommits ?? commits.length);
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
        setCommitFilesMap((prev) => ({ ...prev, [msg.hash]: msg.files || [] }));
        setCommitParentHashMap((prev) => ({ ...prev, [msg.hash]: msg.parentHash }));
        setCommitFilesLoadingMap((prev) => ({ ...prev, [msg.hash]: false }));
      } else if (msg.type === 'activeEditorChanged') {
        setActiveFile(msg.file);

        if (msg.file) {
          const parts = msg.file.split('/');
          parts.pop();

          if (parts.length > 0) {
            setExpandedDirs((prev) => {
              const next = { ...prev };
              let currentPath = '';

              parts.forEach((p: string) => {
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
        setActiveCompareCommitHash(null);
        setIsCompareOpen(true);
      } else if (msg.type === 'error') {
        setLoading(false);
        setChangesRefreshing(false);
        setIsGraphLoading(false);

        if (pendingCommitSnapshotRef.current) {
          restoreCommitDraft(pendingCommitSnapshotRef.current);
          pendingCommitSnapshotRef.current = null;
        }
      } else if (msg.type === 'commitSuccess') {
        if (pendingCommitSnapshotRef.current) {
          lastCommittedSnapshotRef.current = pendingCommitSnapshotRef.current;
          pendingCommitSnapshotRef.current = null;
        }

        clearCommitDraft();
        justCommittedBranchRef.current = currentBranchRef.current;
        setJustCommitted(true);
      } else if (msg.type === 'undoLastCommitSuccess') {
        const lastCommittedSnapshot = lastCommittedSnapshotRef.current;
        const undoMessage = typeof msg.message === 'string' ? msg.message : '';

        lastCommittedSnapshotRef.current = null;
        pendingCommitSnapshotRef.current = null;
        justCommittedBranchRef.current = '';
        setJustCommitted(false);

        if (undoMessage) {
          restoreCommitMessageText(undoMessage);
        } else if (lastCommittedSnapshot) {
          restoreCommitDraft(lastCommittedSnapshot);
        }
      } else if (msg.type === 'clearJustCommitted') {
        justCommittedBranchRef.current = '';
        setJustCommitted(false);
      } else if (msg.type === 'gitInstallationStatus') {
        setIsGitInstalled(msg.isInstalled);

        if (msg.isInit && msg.defaultSkipVerify !== undefined) {
          setSkipVerify(msg.defaultSkipVerify);
        }

        if (msg.defaultCommitTypeEnabled !== undefined) {
          setCommitTypeEnabled(!!msg.defaultCommitTypeEnabled);
        }
      } else if (msg.type === 'gitConfigChanged') {
        if (msg.defaultSkipVerify !== undefined) {
          setSkipVerify(msg.defaultSkipVerify);
        }

        if (msg.defaultCommitTypeEnabled !== undefined) {
          setCommitTypeEnabled(!!msg.defaultCommitTypeEnabled);
        }
      }
    };

    window.addEventListener('message', handleMsg);

    const triggerSmartRefresh = () => {
      const now = Date.now();

      if (now - lastRefreshRef.current > 5000 && isRepo) {
        vscode.postMessage({ command: 'refreshStatusOnly' });
        lastRefreshRef.current = now;
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        triggerSmartRefresh();
      }
    };

    const handleFocus = () => {
      triggerSmartRefresh();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);

    return () => {
      window.removeEventListener('message', handleMsg);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, [isRepo]);

  const syncCommitInputValue = (value: string) => {
    const text = value.replace(/\n/g, '').trim();

    if (!text) {
      if (commitInputRef.current) {
        commitInputRef.current.innerHTML = '';
      }

      setCommitMsg('');
      return;
    }

    setCommitMsg(value);
  };

  const setCommitInputText = (text: string) => {
    const el = commitInputRef.current;

    if (!el) return;

    el.innerText = text;

    const selection = window.getSelection();
    const range = document.createRange();

    range.selectNodeContents(el);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);

    syncCommitInputValue(text);
  };

  const insertPlainTextAtCursor = (text: string) => {
    const selection = window.getSelection();

    if (!selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    range.deleteContents();

    const lines = text.replace(/\r\n/g, '\n').split('\n');
    const fragment = document.createDocumentFragment();

    lines.forEach((line, index) => {
      if (index > 0) {
        fragment.appendChild(document.createElement('br'));
      }

      fragment.appendChild(document.createTextNode(line));
    });

    const lastNode = fragment.lastChild;
    range.insertNode(fragment);

    if (lastNode) {
      const newRange = document.createRange();
      newRange.setStartAfter(lastNode);
      newRange.collapse(true);
      selection.removeAllRanges();
      selection.addRange(newRange);
    }
  };

  const applyCommitTypeFromPastedText = (text: string) => {
    const parsed = parseCommitTypeFromText(text);

    if (!parsed) {
      return false;
    }

    setCommitType(parsed.type);

    if (!commitTypeEnabled) {
      setCommitTypeEnabled(true);

      vscode.postMessage({
        command: 'toggleCommitTypeEnabled',
        value: true,
      });
    }

    setCommitInputText(parsed.message);
    setJustCommitted(false);

    return true;
  };

  const createCommitDraftSnapshot = (finalMessage: string): CommitDraftSnapshot => {
    return {
      message: getNormalizedCommitMessage(),
      commitType,
      commitTypeEnabled,
      finalMessage,
    };
  };

  const getFinalCommitMessage = () => {
    const message = getNormalizedCommitMessage();

    if (!message) return '';

    if (!commitTypeEnabled) {
      return message;
    }

    return `${commitType}: ${message}`;
  };

  const handleCommit = () => {
    const finalMessage = getFinalCommitMessage();

    if (!finalMessage) return;

    pendingCommitSnapshotRef.current = createCommitDraftSnapshot(finalMessage);

    setLoading(true);
    setJustCommitted(false);

    vscode.postMessage({
      command: 'commit',
      message: finalMessage,
      skipVerify,
    });
  };

  const toggleCommit = (hash: string) => {
    setActiveCommitHash(hash);

    const alreadyExpanded = expandedCommitHashes.includes(hash);

    setExpandedCommitHashes((prev) => {
      return alreadyExpanded ? prev.filter((item) => item !== hash) : [...prev, hash];
    });

    if (alreadyExpanded) return;
    if (commitFilesMap[hash]) return;

    setCommitFilesLoadingMap((prev) => ({
      ...prev,
      [hash]: true,
    }));

    vscode.postMessage({
      command: 'getCommitFiles',
      hash,
    });
  };

  const collapseGraphCommitFiles = () => {
    setActiveCommitHash(null);
    setExpandedCommitHashes([]);

    setExpandedDirs((prev) => {
      let changed = false;
      const next = { ...prev };

      Object.keys(next).forEach((key) => {
        if (key.startsWith('history:') && next[key] !== false) {
          next[key] = false;
          changed = true;
        }
      });

      return changed ? next : prev;
    });
  };

  const toggleCompareCommit = (hash: string) => {
    const nextHash = activeCompareCommitHash === hash ? null : hash;

    setActiveCompareCommitHash(nextHash);

    if (!nextHash) return;
    if (commitFilesMap[nextHash]) return;

    setCommitFilesLoadingMap((prev) => ({
      ...prev,
      [nextHash]: true,
    }));

    vscode.postMessage({
      command: 'getCommitFiles',
      hash: nextHash,
    });
  };

  const toggleDir = (path: string, e: React.MouseEvent) => {
    e.stopPropagation();

    setExpandedDirs((prev) => ({
      ...prev,
      [path]: prev[path] === false ? true : false,
    }));
  };

  const collapseDirs = (paths: string[], e: React.MouseEvent) => {
    e.stopPropagation();

    setExpandedDirs((prev) => {
      const next = { ...prev };

      paths.forEach((path) => {
        next[path] = false;
      });

      return next;
    });
  };

  const openHistoryDiff = (file: GitFile, historyHash?: string) => {
    if (!historyHash) return;

    vscode.postMessage({
      command: 'diffCommitFile',
      file: file.file,
      hash: historyHash,
      parentHash: commitParentHashMap[historyHash],
      status: file.status,
    });
  };

  const openCompareDiff = (file: GitFile) => {
    if (!compareTarget || !compareBase) return;

    vscode.postMessage({
      command: 'diffBranchFile',
      file: file.file,
      targetBranch: activeCompareCommitHash || compareTarget,
      baseBranch: compareBase,
      status: file.status,
    });
  };

  const getChangesSectionStateClass = (open: boolean) => {
    return open ? styles['changes-section-expanded'] : styles['changes-section-collapsed'];
  };

  const getChangesSectionClassName = (open: boolean, extraClassNames: string[] = []) => {
    return [styles['changes-section'], getChangesSectionStateClass(open), ...extraClassNames].filter(Boolean).join(' ');
  };

  const getPullTooltip = () => {
    if (remoteSync.needsPull) {
      return `需要 Pull：当前分支落后 ${remoteSync.upstream || '远程分支'} ${remoteSync.behind} 个提交`;
    }

    if (remoteSync.hasRemote && !remoteSync.hasUpstream) {
      return '当前分支没有绑定上游分支';
    }

    return '拉取 (Pull)';
  };

  const hasUnpushedCommit = remoteSync.needsPush && remoteSync.ahead > 0;
  const canUndoLastCommit = justCommitted || hasUnpushedCommit;

  if (isGitInstalled === false) {
    return <GitNotInstalled />;
  }

  return (
    <div className={styles['git-sidebar']}>
      <GitContextMenu contextMenu={contextMenu} onClose={() => setContextMenu(null)} />

      <div className={styles['git-toolbar']}>
        <div className={styles['toolbar-title-container']}>
          <Tooltip content={`${folderName || '当前工作区'} (${branch})`}>
            <span className={styles['toolbar-title']}>
              {folderName || '当前工作区'} ({branch})
            </span>
          </Tooltip>
        </div>

        <div className={styles['git-actions']}>
          {isRepo ? (
            <>
              <Tooltip content={commitTypeEnabled ? '关闭提交类型 Tag' : '添加提交类型 Tag'}>
                <button
                  className={`${styles['icon-btn']} ${commitTypeEnabled ? styles['action-btn-active-solid'] : ''}`}
                  onClick={() => {
                    const nextValue = !commitTypeEnabled;

                    setCommitTypeEnabled(nextValue);

                    vscode.postMessage({
                      command: 'toggleCommitTypeEnabled',
                      value: nextValue,
                    });

                    requestAnimationFrame(() => {
                      commitInputRef.current?.focus();
                    });
                  }}
                >
                  <i className="codicon codicon-tag" />
                </button>
              </Tooltip>

              <Tooltip content={!skipVerify ? '校验开启' : '校验关闭'}>
                <button
                  className={`${styles['icon-btn']} ${!skipVerify ? styles['shield-enabled'] : ''}`}
                  onClick={() => {
                    const newValue = !skipVerify;

                    setSkipVerify(newValue);

                    vscode.postMessage({
                      command: 'toggleSkipVerify',
                      value: newValue,
                    });
                  }}
                >
                  <i className="codicon codicon-shield" />
                </button>
              </Tooltip>

              <Tooltip content={getPullTooltip()}>
                <button className={`${styles['icon-btn']} ${remoteSync.needsPull ? styles['pull-needed'] : ''}`} onClick={() => vscode.postMessage({ command: 'pull' })}>
                  <i className="codicon codicon-repo-pull" />

                  {remoteSync.needsPull && <span className={styles['pull-badge']}>{remoteSync.behind > 99 ? '99+' : remoteSync.behind}</span>}
                </button>
              </Tooltip>

              <Tooltip content={remoteSync.needsPush ? `需要 Push：当前分支领先远程 ${remoteSync.ahead} 个提交` : '推送 (Push)'}>
                <button className={`${styles['icon-btn']} ${remoteSync.needsPush ? styles['push-needed'] : ''}`} onClick={() => vscode.postMessage({ command: 'push' })}>
                  <i className="codicon codicon-repo-push" />

                  {remoteSync.needsPush && <span className={styles['pull-badge']}>{remoteSync.ahead > 99 ? '99+' : remoteSync.ahead}</span>}
                </button>
              </Tooltip>

              <Tooltip content={viewMode === 'list' ? '以树状视图查看' : '以列表视图查看'}>
                <button className={styles['icon-btn']} onClick={() => setViewMode((value) => (value === 'list' ? 'tree' : 'list'))}>
                  <i className={`codicon ${viewMode === 'list' ? 'codicon-list-tree' : 'codicon-list-flat'}`} />
                </button>
              </Tooltip>
            </>
          ) : null}
        </div>
      </div>

      <div className={styles['commit-box']}>
        <div
          className={`${styles['commit-input-wrap']} ${commitTypeEnabled ? styles['commit-input-wrap-with-tag'] : ''} ${!isRepo || loading ? styles['commit-input-wrap-disabled'] : ''}`}
          onClick={() => {
            if (!isRepo || loading) return;
            commitInputRef.current?.focus();
          }}
        >
          {commitTypeEnabled && (
            <CommitTypeTag
              value={commitType}
              disabled={!isRepo || loading}
              onChange={(nextType) => {
                setCommitType(nextType);

                requestAnimationFrame(() => {
                  commitInputRef.current?.focus();
                });
              }}
            />
          )}

          <div
            ref={commitInputRef}
            className={styles['commit-input']}
            contentEditable={isRepo && !loading}
            data-placeholder={commitTypeEnabled ? '输入提交内容' : '消息 (按 Ctrl+Enter 提交)'}
            onInput={(e) => {
              const el = e.currentTarget;

              syncCommitInputValue(el.innerText);
              setJustCommitted(false);
            }}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                handleCommit();
              }
            }}
            onPaste={(e) => {
              e.preventDefault();

              const text = e.clipboardData.getData('text/plain');

              if (!text) return;

              if (applyCommitTypeFromPastedText(text)) {
                return;
              }

              insertPlainTextAtCursor(text);
              syncCommitInputValue(e.currentTarget.innerText);
              setJustCommitted(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
            }}
            suppressContentEditableWarning={true}
          />
        </div>

        <button className={styles['commit-btn']} disabled={!canCommit} onClick={handleCommit}>
          {loading ? <i className={`codicon codicon-loading codicon-modifier-spin ${styles['icon-right-6']}`} /> : <i className={`codicon codicon-check ${styles['icon-right-6']}`} />}
          提交 (Commit)
        </button>
      </div>

      <div className={`${styles['changes-scroll-area']} ${styles['changes-scroll-area-expanded']}`}>
        <div className={getChangesSectionClassName(isChangesOpen)}>
          <div className={`${styles['changes-header']} ${styles['header-between']}`} onClick={() => setIsChangesOpen(!isChangesOpen)}>
            <div className={styles['header-title-row']}>
              <i className={`codicon ${isChangesOpen ? 'codicon-chevron-down' : 'codicon-chevron-right'} ${styles['section-chevron']}`} />
              更改 <span className={styles['badge']}>{stagedFiles.length + unstagedFiles.length + conflictedFiles.length}</span>
            </div>

            {isRepo && (
              <div className={styles['header-actions']}>
                <Tooltip content="刷新状态和更改">
                  <button
                    className={`${styles['action-btn']} ${styles['section-action-btn']}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setChangesRefreshing(true);
                      lastRefreshRef.current = Date.now();

                      vscode.postMessage({
                        command: 'refreshStatusOnly',
                      });
                    }}
                  >
                    <i className="codicon codicon-refresh" />
                  </button>
                </Tooltip>

                {canUndoLastCommit && (
                  <Tooltip content="撤销刚刚的提交 (退回工作区)">
                    <button
                      className={`${styles['action-btn']} ${styles['section-action-btn']}`}
                      onClick={(e) => {
                        e.stopPropagation();

                        vscode.postMessage({
                          command: 'undoLastCommit',
                        });

                        justCommittedBranchRef.current = '';
                        setJustCommitted(false);
                      }}
                    >
                      <i className="codicon codicon-debug-restart-frame" />
                    </button>
                  </Tooltip>
                )}
              </div>
            )}
          </div>

          {isChangesOpen && (
            <div className={styles['changes-content']}>
              {stagedFiles.length > 0 && (
                <div className={`${styles['changes-section']} ${styles['nested-section']}`}>
                  <div className={`${styles['changes-header']} ${styles['subsection-header']}`}>
                    <div className={styles['header-title-row']}>
                      <i className={`codicon codicon-git-pull-request-done ${styles['section-chevron']}`} />
                      暂存区 <span className={styles['badge']}>{stagedFiles.length}</span>
                    </div>

                    <div className={styles['inline-actions']}>
                      <Tooltip content="打开更改">
                        <button
                          className={`${styles['action-btn']} ${styles['section-action-btn']}`}
                          onClick={(e) => {
                            e.stopPropagation();

                            vscode.postMessage({
                              command: 'openStagedChanges',
                            });
                          }}
                        >
                          <i className="codicon codicon-diff-multiple" />
                        </button>
                      </Tooltip>

                      <Tooltip content="取消暂存所有更改">
                        <button
                          className={`${styles['action-btn']} ${styles['section-action-btn']}`}
                          onClick={(e) => {
                            e.stopPropagation();

                            vscode.postMessage({
                              command: 'unstageAll',
                            });
                          }}
                        >
                          <i className="codicon codicon-remove" />
                        </button>
                      </Tooltip>
                    </div>
                  </div>

                  <GitFileList
                    files={stagedFiles}
                    listType="staged"
                    viewMode={viewMode}
                    activeFile={activeFile}
                    setActiveFile={setActiveFile}
                    expandedDirs={expandedDirs}
                    toggleDir={toggleDir}
                    collapseDirs={collapseDirs}
                    openHistoryDiff={openHistoryDiff}
                    openCompareDiff={openCompareDiff}
                    setContextMenu={setContextMenu}
                  />
                </div>
              )}

              <div className={`${styles['changes-section']} ${styles['nested-section']}`}>
                <div className={`${styles['changes-header']} ${styles['subsection-header']}`}>
                  <div className={styles['header-title-row']}>
                    <i className={`codicon codicon-git-branch-changes ${styles['section-chevron']}`} />
                    工作区 <span className={styles['badge']}>{unstagedFiles.length}</span>
                  </div>

                  <div className={styles['inline-actions']}>
                    {unstagedFiles.length > 0 && (
                      <Tooltip content="打开更改">
                        <button
                          className={`${styles['action-btn']} ${styles['section-action-btn']}`}
                          onClick={(e) => {
                            e.stopPropagation();

                            vscode.postMessage({
                              command: 'openWorkingTreeChanges',
                            });
                          }}
                        >
                          <i className="codicon codicon-diff-multiple" />
                        </button>
                      </Tooltip>
                    )}

                    {unstagedFiles.length > 0 && (
                      <Tooltip content="贮藏更改 (Stash)">
                        <button
                          className={`${styles['action-btn']} ${styles['section-action-btn']}`}
                          onClick={(e) => {
                            e.stopPropagation();

                            vscode.postMessage({
                              command: 'stash',
                            });
                          }}
                        >
                          <i className="codicon codicon-archive" />
                        </button>
                      </Tooltip>
                    )}

                    {unstagedFiles.length > 0 && (
                      <>
                        <Tooltip content="放弃所有更改">
                          <button
                            className={`${styles['action-btn']} ${styles['section-action-btn']}`}
                            onClick={(e) => {
                              e.stopPropagation();

                              if (unstagedFiles.length === 1) {
                                vscode.postMessage({
                                  command: 'discard',
                                  file: unstagedFiles[0].file,
                                  status: unstagedFiles[0].status,
                                });
                              } else {
                                vscode.postMessage({
                                  command: 'discardAll',
                                  count: unstagedFiles.length,
                                });
                              }
                            }}
                          >
                            <i className="codicon codicon-discard" />
                          </button>
                        </Tooltip>

                        <Tooltip content="暂存所有更改">
                          <button
                            className={`${styles['action-btn']} ${styles['section-action-btn']}`}
                            onClick={(e) => {
                              e.stopPropagation();

                              vscode.postMessage({
                                command: 'stageAll',
                              });
                            }}
                          >
                            <i className="codicon codicon-plus" />
                          </button>
                        </Tooltip>
                      </>
                    )}
                  </div>
                </div>

                {unstagedFiles.length === 0 && stagedFiles.length === 0 && conflictedFiles.length === 0 ? (
                  <div className={styles['empty-message']}>{!isRepo ? '在此打开项目或进行克隆' : '没有需要提交的更改'}</div>
                ) : (
                  <GitFileList
                    files={unstagedFiles}
                    listType="unstaged"
                    viewMode={viewMode}
                    activeFile={activeFile}
                    setActiveFile={setActiveFile}
                    expandedDirs={expandedDirs}
                    toggleDir={toggleDir}
                    collapseDirs={collapseDirs}
                    openHistoryDiff={openHistoryDiff}
                    openCompareDiff={openCompareDiff}
                    setContextMenu={setContextMenu}
                  />
                )}
              </div>

              {conflictedFiles.length > 0 && (
                <div className={`${styles['changes-section']} ${styles['nested-section']} ${styles['conflict-section']}`}>
                  <div className={`${styles['changes-header']} ${styles['subsection-header']}`}>
                    <div className={`${styles['header-title-row']} ${styles['conflict-title']}`}>
                      <i className={`codicon codicon-warning ${styles['section-chevron']}`} />
                      冲突区 <span className={`${styles['badge']} ${styles['conflict-badge']}`}>{conflictedFiles.length}</span>
                    </div>
                  </div>

                  <GitFileList
                    files={conflictedFiles}
                    listType="unstaged"
                    viewMode={viewMode}
                    activeFile={activeFile}
                    setActiveFile={setActiveFile}
                    expandedDirs={expandedDirs}
                    toggleDir={toggleDir}
                    collapseDirs={collapseDirs}
                    openHistoryDiff={openHistoryDiff}
                    openCompareDiff={openCompareDiff}
                    setContextMenu={setContextMenu}
                  />
                </div>
              )}

              <LoadingMask visible={changesRefreshing} />
            </div>
          )}
        </div>

        {stashes.length > 0 && (
          <div className={getChangesSectionClassName(isStashesOpen, [styles['section-top-gap'],styles['change-stash']])}>
            <div className={`${styles['changes-header']} ${styles['header-between']}`} onClick={() => setIsStashesOpen(!isStashesOpen)}>
              <div className={styles['header-flex-title']}>
                <i className={`codicon ${isStashesOpen ? 'codicon-chevron-down' : 'codicon-chevron-right'} ${styles['section-chevron-fixed']}`} />
                <span className={styles['text-no-shrink']}>贮藏</span>
                <span className={`${styles['badge']} ${styles['text-no-shrink']}`}>{stashes.length}</span>
              </div>
            </div>

            {isStashesOpen && (
              <div className={styles['panel-scroll']}>
                <ul className={styles['file-list']}>
                  {stashes.map((stash, idx) => {
                    const isExpanded = expandedStashIndex === stash.index;
                    const isLoading = stashFilesLoading[stash.index];
                    const files = stashFilesMap[stash.index] || [];

                    return (
                      <React.Fragment key={idx}>
                        <Tooltip content={stash.message} placement="bottom" delay={1000}>
                          <li
                            className={`${styles['file-item']} ${styles['stash-row']}`}
                            onClick={() => {
                              if (isExpanded) {
                                setExpandedStashIndex(null);
                              } else {
                                setExpandedStashIndex(stash.index);

                                if (!stashFilesMap[stash.index]) {
                                  setStashFilesLoading((prev) => ({
                                    ...prev,
                                    [stash.index]: true,
                                  }));

                                  vscode.postMessage({
                                    command: 'getStashFiles',
                                    index: stash.index,
                                  });
                                }
                              }
                            }}
                          >
                            <i className={`codicon ${isExpanded ? 'codicon-chevron-down' : 'codicon-chevron-right'} ${styles['stash-chevron']}`} />
                            <i className={`codicon codicon-archive ${styles['stash-icon']}`} />
                            <div className={styles['file-name']} title={stash.message}>
                              {stash.message}
                            </div>

                            <div className={styles['file-actions']}>
                              <Tooltip content="应用贮藏并保留 (Apply)">
                                <button
                                  className={styles['action-btn']}
                                  onClick={(e) => {
                                    e.stopPropagation();

                                    vscode.postMessage({
                                      command: 'stashApply',
                                      index: stash.index,
                                    });
                                  }}
                                >
                                  <i className="codicon codicon-git-stash-apply" />
                                </button>
                              </Tooltip>

                              <Tooltip content="应用并删除贮藏 (Pop)">
                                <button
                                  className={styles['action-btn']}
                                  onClick={(e) => {
                                    e.stopPropagation();

                                    vscode.postMessage({
                                      command: 'stashPop',
                                      index: stash.index,
                                    });
                                  }}
                                >
                                  <i className="codicon codicon-git-stash-pop" />
                                </button>
                              </Tooltip>

                              <Tooltip content="删除此贮藏 (Drop)">
                                <button
                                  className={styles['action-btn']}
                                  onClick={(e) => {
                                    e.stopPropagation();

                                    vscode.postMessage({
                                      command: 'stashDrop',
                                      index: stash.index,
                                    });
                                  }}
                                >
                                  <i className="codicon codicon-trash" />
                                </button>
                              </Tooltip>
                            </div>
                          </li>
                        </Tooltip>

                        {isExpanded && (
                          <div className={styles['stash-expanded']}>
                            {isLoading ? (
                              <div className={styles['stash-loading']}>
                                <i className={`codicon codicon-loading codicon-modifier-spin ${styles['icon-right-6']}`} />
                                加载变动文件...
                              </div>
                            ) : (
                              <div className={styles['stash-files-wrap']}>
                                <GitFileList
                                  files={files}
                                  listType="stash-file"
                                  viewMode={viewMode}
                                  historyHash={`stash@{${stash.index}}`}
                                  activeFile={activeFile}
                                  setActiveFile={setActiveFile}
                                  expandedDirs={expandedDirs}
                                  toggleDir={toggleDir}
                                  collapseDirs={collapseDirs}
                                  openHistoryDiff={openHistoryDiff}
                                  openCompareDiff={openCompareDiff}
                                  setContextMenu={setContextMenu}
                                />
                              </div>
                            )}
                          </div>
                        )}
                      </React.Fragment>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        )}

        <div className={getChangesSectionClassName(isCompareOpen, [styles['section-top-gap'],styles['change-diff']])}>
          <div className={`${styles['changes-header']} ${styles['header-between']}`} onClick={() => setIsCompareOpen(!isCompareOpen)}>
            <div className={styles['header-flex-title']}>
              <i className={`codicon ${isCompareOpen ? 'codicon-chevron-down' : 'codicon-chevron-right'} ${styles['section-chevron-fixed']}`} />
              <span className={styles['text-no-shrink']}>{compareBase === '文件历史' ? '文件历史' : '对比'}</span>

              {compareTarget && compareBase && (
                <span className={styles['compare-title']} title={compareBase === '文件历史' ? `文件: ${compareTarget}` : `${compareTarget} ↔ ${compareBase}`}>
                  {compareBase === '文件历史' ? `(${compareTarget})` : `(${compareTarget} ↔ ${compareBase})`}
                </span>
              )}

              <span className={`${styles['badge']} ${styles['text-no-shrink']}`}>{compareCommits.length}</span>
            </div>

            {isRepo && (
              <div className={styles['inline-actions-fixed']}>
                {(!compareTarget || !compareBase) && (
                  <>
                    <Tooltip content={activeFile ? `查看当前文件历史` : '查看当前文件历史 (请先打开文件)'}>
                      <button
                        className={`${styles['action-btn']} ${styles['section-action-btn']} ${!activeFile ? styles['action-btn-disabled'] : ''}`}
                        onClick={(e) => {
                          e.stopPropagation();

                          if (!activeFile) {
                            vscode.postMessage({
                              command: 'error',
                              message: '当前没有在编辑器中打开任何文件，无法查看历史记录。',
                            });

                            return;
                          }

                          vscode.postMessage({
                            command: 'viewFileHistory',
                            file: activeFile,
                          });
                        }}
                      >
                        <i className="codicon codicon-history" />
                      </button>
                    </Tooltip>

                    <Tooltip content="跨分支对比">
                      <button
                        className={`${styles['action-btn']} ${styles['section-action-btn']}`}
                        onClick={(e) => {
                          e.stopPropagation();

                          vscode.postMessage({
                            command: 'compareFileAcrossBranches',
                          });
                        }}
                      >
                        <i className="codicon codicon-git-compare" />
                      </button>
                    </Tooltip>
                  </>
                )}

                {compareTarget && compareBase && compareBase !== '文件历史' && (
                  <Tooltip content="重新打开分支文件对比">
                    <button
                      className={`${styles['action-btn']} ${styles['section-action-btn']}`}
                      onClick={(e) => {
                        e.stopPropagation();

                        vscode.postMessage({
                          command: 'compareFileAcrossBranches',
                          baseBranch: compareBase,
                          targetBranch: compareTarget,
                        });
                      }}
                    >
                      <i className="codicon codicon-diff-multiple" />
                    </button>
                  </Tooltip>
                )}

                {compareTarget && compareBase && (
                  <Tooltip content="关闭对比">
                    <button
                      className={`${styles['action-btn']} ${styles['section-action-btn']}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setCompareTarget(null);
                        setCompareBase(null);
                        setCompareCommits([]);
                        setActiveCompareCommitHash(null);
                      }}
                    >
                      <i className="codicon codicon-close" />
                    </button>
                  </Tooltip>
                )}
              </div>
            )}
          </div>

          {isCompareOpen && (
            <div className={styles['panel-scroll']}>
              {!compareTarget || !compareBase ? (
                <div className={styles['empty-message']}>{!isRepo ? '未连接至 Git 仓库' : '点击右上角图标选择分支或查看文件历史'}</div>
              ) : (
                <GitCompareList
                  commits={compareCommits}
                  activeCommitHash={activeCompareCommitHash}
                  loadedCommitHash={activeCompareCommitHash && commitFilesMap[activeCompareCommitHash] ? activeCompareCommitHash : null}
                  commitFilesLoading={!!commitFilesLoadingMap[activeCompareCommitHash || '']}
                  commitFiles={activeCompareCommitHash ? commitFilesMap[activeCompareCommitHash] || [] : []}
                  remoteUrl={remoteUrl}
                  onCommitClick={toggleCompareCommit}
                  renderCommitFiles={(files) => (
                    <GitFileList
                      files={files}
                      listType={compareBase === '文件历史' ? 'history' : 'compare'}
                      historyHash={activeCompareCommitHash || undefined}
                      viewMode={viewMode}
                      activeFile={activeFile}
                      setActiveFile={setActiveFile}
                      expandedDirs={expandedDirs}
                      toggleDir={toggleDir}
                      collapseDirs={collapseDirs}
                      openHistoryDiff={openHistoryDiff}
                      openCompareDiff={openCompareDiff}
                      setContextMenu={setContextMenu}
                    />
                  )}
                  onOpenCommitMultiDiff={(hash) => {
                    vscode.postMessage({
                      command: 'openCommitMultiDiff',
                      hash,
                    });
                  }}
                />
              )}
            </div>
          )}
        </div>
      </div>

      <div
        ref={graphSectionRef}
        className={getChangesSectionClassName(isGraphOpen, [styles['git-graph-section'], styles['section-top-gap']])}
        style={isGraphOpen ? { height: `${graphSectionHeight}vh` } : undefined}
      >
        {isGraphOpen && <div className={styles['graph-resize-handle']} onMouseDown={handleGraphResizeMouseDown} />}

        <div className={`${styles['changes-header']} ${styles['header-between']}`} onClick={() => setIsGraphOpen(!isGraphOpen)}>
          <div className={styles['header-flex-title']}>
            <i className={`codicon ${isGraphOpen ? 'codicon-chevron-down' : 'codicon-chevron-right'} ${styles['section-chevron-fixed']}`} />
            <span className={styles['text-no-shrink']}>图形</span>

            {totalCommits > 0 && (
              <span className={`${styles['badge']} ${styles['graph-total-badge']}`} title={`总提交记录: ${totalCommits} 次`}>
                {totalCommits}
              </span>
            )}
          </div>

          {isRepo && (
            <div className={styles['graph-actions']}>
              <Tooltip content="新建本地分支">
                <button
                  className={`${styles['action-btn']} ${styles['section-action-btn']}`}
                  onClick={(e) => {
                    e.stopPropagation();

                    vscode.postMessage({
                      command: 'createBranch',
                    });
                  }}
                >
                  <i className="codicon codicon-git-branch-staged-changes" />
                </button>
              </Tooltip>

              <Tooltip content="切换分支 (Checkout)">
                <button
                  className={`${styles['action-btn']} ${styles['section-action-btn']}`}
                  onClick={(e) => {
                    e.stopPropagation();

                    vscode.postMessage({
                      command: 'checkoutBranch',
                    });
                  }}
                >
                  <i className="codicon codicon-git-branch" />
                </button>
              </Tooltip>

              <Tooltip content="合并本地分支 (Merge)">
                <button
                  className={`${styles['action-btn']} ${styles['section-action-btn']}`}
                  onClick={(e) => {
                    e.stopPropagation();

                    vscode.postMessage({
                      command: 'mergeBranch',
                    });
                  }}
                >
                  <i className="codicon codicon-merge" />
                </button>
              </Tooltip>

              <Tooltip content={`筛选分支 (${selectedGraphFilter})`}>
                <button
                  className={`${styles['action-btn']} ${styles['section-action-btn']} ${selectedGraphFilter !== '全部分支' ? styles['action-btn-active'] : ''} ${
                    flashBranchBtn ? styles['action-btn-flash'] : ''
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();

                    vscode.postMessage({
                      command: 'changeGraphFilter',
                      current: selectedGraphFilter,
                    });
                  }}
                >
                  <i className="codicon codicon-filter" />
                </button>
              </Tooltip>

              <Tooltip content="更多">
                <GraphMoreMenu
                  isSearchOpen={isGraphSearchOpen}
                  onToggleSearch={() => {
                    setIsGraphSearchOpen((prev) => !prev);
                  }}
                  onCollapseCommitFiles={collapseGraphCommitFiles}
                  triggerClassName={`${styles['action-btn']} ${styles['section-action-btn']} ${isGraphSearchOpen ? styles['action-btn-active-solid'] : ''}`}
                  activeTriggerClassName={styles['action-btn-active-solid']}
                />
              </Tooltip>

              <Tooltip content="刷新">
                <button
                  className={`${styles['action-btn']} ${styles['section-action-btn']}`}
                  onClick={(e) => {
                    e.stopPropagation();

                    setIsGraphLoading(true);
                    lastRefreshRef.current = Date.now();

                    vscode.postMessage({
                      command: 'refresh',
                    });
                  }}
                >
                  <i className="codicon codicon-refresh" />
                </button>
              </Tooltip>
            </div>
          )}
        </div>

        {isGraphOpen && (
          <div className={styles['graph-content']}>
            {graphCommits.length === 0 ? (
              <div className={styles['git-graph-fallback']}>{!isRepo ? '未连接至 Git 仓库' : isGraphLoading ? '' : '暂无记录'}</div>
            ) : (
              <GitGraph
                graphCommits={graphCommits}
                displayCount={displayCount}
                setDisplayCount={setDisplayCount}
                expandedCommitHashes={expandedCommitHashes}
                commitFilesLoadingMap={commitFilesLoadingMap}
                commitFilesMap={commitFilesMap}
                activeCommitHash={activeCommitHash}
                branch={branch}
                onCommitClick={toggleCommit}
                remoteUrl={remoteUrl}
                isSearchOpen={isGraphSearchOpen}
                setIsSearchOpen={setIsGraphSearchOpen}
                renderCommitFiles={(hash, files) => (
                  <GitFileList
                    files={files}
                    listType="history"
                    historyHash={hash}
                    viewMode={viewMode}
                    activeFile={activeFile}
                    setActiveFile={setActiveFile}
                    expandedDirs={expandedDirs}
                    toggleDir={toggleDir}
                    collapseDirs={collapseDirs}
                    openHistoryDiff={openHistoryDiff}
                    openCompareDiff={openCompareDiff}
                    setContextMenu={setContextMenu}
                  />
                )}
                onCommitContextMenu={(e, commit) => {
                  e.preventDefault();

                  setContextMenu({
                    visible: true,
                    x: e.clientX,
                    y: e.clientY,
                    type: 'commit',
                    commit,
                  });
                }}
                onOpenCommitMultiDiff={(hash) => {
                  vscode.postMessage({
                    command: 'openCommitMultiDiff',
                    hash,
                  });
                }}
              />
            )}

            <LoadingMask visible={isGraphLoading} />
          </div>
        )}
      </div>
    </div>
  );
}
