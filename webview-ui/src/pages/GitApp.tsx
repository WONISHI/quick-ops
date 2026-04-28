import React, { useState, useEffect, useRef } from 'react';
import { vscode } from '../utils/vscode';
import styles from '../assets/css/GitApp.module.css';

import '@vscode/codicons/dist/codicon.css';

import Tooltip from '../components/Tooltip';
import GitGraph, { type GraphCommit } from '../components/GitGraph';
import GitCompareList from '../components/GitCompareList';
import type { GitFile, TreeNode } from '../types/GitApp';

import { GitContextMenu, type ContextMenuState } from '../components/GitContextMenu';
import FileIcon from '../components/FileIcon';

function buildTree(files: GitFile[]): TreeNode[] {
  const root: TreeNode[] = [];

  files.forEach((f) => {
    const parts = f.file.split('/');
    let currentLevel = root;
    let currentPath = '';

    parts.forEach((part, index) => {
      const isFile = index === parts.length - 1;
      currentPath = currentPath ? `${currentPath}/${part}` : part;

      let existingNode = currentLevel.find((n) => n.name === part);
      if (!existingNode) {
        existingNode = {
          name: part,
          fullPath: currentPath,
          isDirectory: !isFile,
          children: [],
          file: isFile ? f : undefined,
        };
        currentLevel.push(existingNode);
      }

      currentLevel = existingNode.children;
    });
  });

  const compressTree = (nodes: TreeNode[]) => {
    nodes.forEach((node) => {
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

  const sortTree = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });
    nodes.forEach((n) => {
      if (n.isDirectory) sortTree(n.children);
    });
  };

  compressTree(root);
  sortTree(root);

  return root;
}

export default function GitApp() {
  const [isRepo, setIsRepo] = useState<boolean>(true);
  const [isGitInstalled, setIsGitInstalled] = useState<boolean | null>(null);

  const [stagedFiles, setStagedFiles] = useState<GitFile[]>([]);
  const [unstagedFiles, setUnstagedFiles] = useState<GitFile[]>([]);
  const [conflictedFiles, setConflictedFiles] = useState<GitFile[]>([]);

  const [branch, setBranch] = useState('');
  const [commitMsg, setCommitMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeFile, setActiveFile] = useState<string | null>(null);

  const [isChangesOpen, setIsChangesOpen] = useState(true);
  const [isStashesOpen, setIsStashesOpen] = useState(false);
  const [isGraphOpen, setIsGraphOpen] = useState(true);
  const [isGraphSearchOpen, setIsGraphSearchOpen] = useState(false);

  const [justCommitted, setJustCommitted] = useState(false);

  const [graphCommits, setGraphCommits] = useState<GraphCommit[]>([]);
  const [isGraphLoading, setIsGraphLoading] = useState(true);
  const [remoteUrl, setRemoteUrl] = useState<string>('');

  const [viewMode, setViewMode] = useState<'list' | 'tree'>('list');
  const [expandedDirs, setExpandedDirs] = useState<Record<string, boolean>>({});

  const [displayCount, setDisplayCount] = useState(100);

  const [expandedCommitHashes, setExpandedCommitHashes] = useState<string[]>([]);
  const [commitFilesMap, setCommitFilesMap] = useState<Record<string, GitFile[]>>({});
  const [commitFilesLoadingMap, setCommitFilesLoadingMap] = useState<Record<string, boolean>>({});
  const [commitParentHashMap, setCommitParentHashMap] = useState<Record<string, string | undefined>>({});

  const [compareTarget, setCompareTarget] = useState<string | null>(null);
  const [compareBase, setCompareBase] = useState<string | null>(null);
  const [compareCommits, setCompareCommits] = useState<GraphCommit[]>([]);
  const [isCompareOpen, setIsCompareOpen] = useState(false);

  const [skipVerify, setSkipVerify] = useState(false);
  const [selectedGraphFilter, setSelectedGraphFilter] = useState('全部分支');
  const filterRef = useRef('全部分支');
  const [flashBranchBtn, setFlashBranchBtn] = useState(false);

  const [activeCommitHash, setActiveCommitHash] = useState<string | null>(null);
  const [folderName, setFolderName] = useState('');

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  const [stashes, setStashes] = useState<any[]>([]);
  const [expandedStashIndex, setExpandedStashIndex] = useState<number | null>(null);
  const [stashFilesMap, setStashFilesMap] = useState<Record<number, GitFile[]>>({});
  const [stashFilesLoading, setStashFilesLoading] = useState<Record<number, boolean>>({});

  const lastRefreshRef = useRef<number>(0);
  const commitInputRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    lastRefreshRef.current = Date.now();
    vscode.postMessage({ command: 'webviewLoaded' });

    const handleMsg = (e: MessageEvent) => {
      const msg = e.data;

      if (msg.type === 'startLoading') {
        setIsGraphLoading(true);
      } else if (msg.type === 'noWorkspace' || msg.type === 'notRepo') {
        setLoading(false);
        setIsGraphLoading(false);
        setIsRepo(false);
        setBranch(msg.type === 'noWorkspace' ? '无工作区' : '未初始化');
        setStagedFiles([]);
        setUnstagedFiles([]);
        setConflictedFiles([]);
        setGraphCommits([]);
        setCompareCommits([]);
        setExpandedCommitHashes([]);
        setCommitFilesMap({});
        setCommitFilesLoadingMap({});
        setCommitParentHashMap({});
        setActiveCommitHash(null);
        setStashes([]);
        setStashFilesMap({});
        setStashFilesLoading({});
        setExpandedStashIndex(null);
      } else if (msg.type === 'statusData') {
        setIsRepo(true);
        setStagedFiles(msg.stagedFiles || []);
        setUnstagedFiles(msg.unstagedFiles || []);
        setConflictedFiles(msg.conflictedFiles || []);
        setBranch(msg.branch || '');
        setRemoteUrl(msg.remoteUrl || '');
        setFolderName(msg.folderName || '');
        if (msg.stashes) setStashes(msg.stashes);
        setLoading(false);
      } else if (msg.type === 'stashData') {
        setStashes(msg.stashes || []);
      } else if (msg.type === 'stashFilesData') {
        setStashFilesMap((prev) => ({ ...prev, [msg.index]: msg.files || [] }));
        setStashFilesLoading((prev) => ({ ...prev, [msg.index]: false }));
        setCommitParentHashMap((prev) => ({ ...prev, [msg.hash]: msg.parentHash }));
      } else if (msg.type === 'graphData') {
        const commits = msg.graphCommits || [];
        setGraphCommits(commits);
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
        setIsCompareOpen(true);
      } else if (msg.type === 'error') {
        setLoading(false);
        setIsGraphLoading(false);
      } else if (msg.type === 'commitSuccess') {
        setJustCommitted(true);
      } else if (msg.type === 'clearJustCommitted') {
        setJustCommitted(false);
      } else if (msg.type === 'gitInstallationStatus') {
        setIsGitInstalled(msg.isInstalled);
        if (msg.isInit && msg.defaultSkipVerify !== undefined) {
          setSkipVerify(msg.defaultSkipVerify);
        }
      } else if (msg.type === 'gitConfigChanged') {
        if (msg.defaultSkipVerify !== undefined) {
          setSkipVerify(msg.defaultSkipVerify);
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
      if (document.visibilityState === 'visible') triggerSmartRefresh();
    };

    const handleFocus = () => triggerSmartRefresh();

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);

    return () => {
      window.removeEventListener('message', handleMsg);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, [isRepo]);

  const insertPlainTextAtCursor = (text: string) => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    range.deleteContents();

    const lines = text.replace(/\r\n/g, '\n').split('\n');
    const fragment = document.createDocumentFragment();

    lines.forEach((line, index) => {
      if (index > 0) fragment.appendChild(document.createElement('br'));
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

  const handleCommit = () => {
    if (!commitMsg.trim()) return;

    setLoading(true);
    vscode.postMessage({ command: 'commit', message: commitMsg, skipVerify });
    setCommitMsg('');

    if (commitInputRef.current) {
      commitInputRef.current.innerText = '';
    }
  };

  const toggleCommit = (hash: string) => {
    setActiveCommitHash(hash);

    const alreadyExpanded = expandedCommitHashes.includes(hash);

    setExpandedCommitHashes((prev) => (alreadyExpanded ? prev.filter((h) => h !== hash) : [...prev, hash]));

    if (alreadyExpanded) return;
    if (commitFilesMap[hash]) return;

    setCommitFilesLoadingMap((prev) => ({
      ...prev,
      [hash]: true,
    }));

    vscode.postMessage({ command: 'getCommitFiles', hash });
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
    if (status.includes('C')) return 'C';
    return 'U';
  };

  const toggleDir = (path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedDirs((prev) => ({
      ...prev,
      [path]: prev[path] === false ? true : false,
    }));
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
      targetBranch: activeCommitHash || compareTarget,
      baseBranch: compareBase,
      status: file.status,
    });
  };

  // 🌟 修改点 1: 在渲染节点的地方拦截 stash-file 类型，直接发送 open 命令
  const renderTreeNodes = (nodes: TreeNode[], listType: 'staged' | 'unstaged' | 'history' | 'compare' | 'stash-file', depth = 0, historyHash?: string): React.ReactNode => {
    return nodes.map((node) => {
      if (node.isDirectory) {
        const isOpen = expandedDirs[node.fullPath] !== false;

        return (
          <React.Fragment key={node.fullPath}>
            <li className={styles['file-item']} style={{ paddingLeft: `${depth * 12 + 4}px`, cursor: 'pointer' }} onClick={(e) => toggleDir(node.fullPath, e)}>
              <i className={`codicon ${isOpen ? 'codicon-chevron-down' : 'codicon-chevron-right'}`} style={{ fontSize: '14px', width: '16px', opacity: 0.8, marginRight: '2px' }} />
              <i className="codicon codicon-folder" style={{ marginRight: '6px', color: 'var(--vscode-icon-foreground)' }} />
              <div className={styles['file-name']} style={{ opacity: 0.9 }}>
                {node.name}
              </div>
            </li>
            {isOpen && renderTreeNodes(node.children, listType, depth + 1, historyHash)}
          </React.Fragment>
        );
      }

      const item = node.file!;
      const parts = item.file.split('/');
      const fileName = parts.pop();

      return (
        <li
          key={item.file}
          className={`${styles['file-item']} ${activeFile === item.file ? styles['active'] : ''}`}
          style={{ paddingLeft: `${depth * 12 + 24}px` }}
          title={item.file}
          onClick={() => {
            setActiveFile(item.file);
            if (listType === 'history') {
              openHistoryDiff(item, historyHash);
            } else if (listType === 'compare') {
              openCompareDiff(item);
            } else if (listType === 'stash-file') {
              vscode.postMessage({ command: 'open', file: item.file });
            } else {
              vscode.postMessage({ command: 'diff', file: item.file, status: item.status });
            }
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            setActiveFile(item.file);
            setContextMenu({ visible: true, x: e.clientX, y: e.clientY, type: 'file', file: item, listType: listType as any });
          }}
        >
          <FileIcon fileName={fileName || ''} className={styles['file-icon']} style={{ marginRight: '6px' }} />
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

            {listType !== 'history' && listType !== 'compare' && listType !== 'stash-file' && (
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

          <div className={`${styles['status-badge']} ${getStatusClass(item.status)}`} style={item.status === 'C' ? { color: '#f14c4c', fontWeight: 'bold' } : {}}>
            {getStatusText(item.status)}
          </div>
        </li>
      );
    });
  };

  const renderFileList = (files: GitFile[], listType: 'staged' | 'unstaged' | 'history' | 'compare' | 'stash-file', historyHash?: string) => {
    if (viewMode === 'tree') {
      const treeNodes = buildTree(files);
      return <ul className={styles['file-list']}>{renderTreeNodes(treeNodes, listType, 0, historyHash)}</ul>;
    }

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
                  openHistoryDiff(item, historyHash);
                } else if (listType === 'compare') {
                  openCompareDiff(item);
                } else if (listType === 'stash-file') {
                  // 🌟 贮藏文件直接打开
                  vscode.postMessage({ command: 'open', file: item.file });
                } else {
                  vscode.postMessage({ command: 'diff', file: item.file, status: item.status });
                }
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setActiveFile(item.file);
                setContextMenu({ visible: true, x: e.clientX, y: e.clientY, type: 'file', file: item, listType: listType as any });
              }}
            >
              <FileIcon fileName={fileName || ''} className={styles['file-icon']} style={{ marginRight: '6px' }} />
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

                {listType !== 'history' && listType !== 'compare' && listType !== 'stash-file' && (
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

              <div className={`${styles['status-badge']} ${getStatusClass(item.status)}`} style={item.status === 'C' ? { color: '#f14c4c', fontWeight: 'bold' } : {}}>
                {getStatusText(item.status)}
              </div>
            </li>
          );
        })}
      </ul>
    );
  };

  if (isGitInstalled === false) {
    return (
      <div
        className={styles['git-sidebar']}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '20px',
          textAlign: 'center',
          height: '100vh',
        }}
      >
        <i className="codicon codicon-git-merge" style={{ fontSize: '48px', marginBottom: '16px', color: 'var(--vscode-textLink-foreground)', opacity: 0.8 }} />
        <div style={{ fontSize: '15px', marginBottom: '8px', color: 'var(--vscode-editor-foreground)', fontWeight: 600 }}>未检测到 Git 环境</div>
        <div style={{ fontSize: '12px', marginBottom: '24px', color: 'var(--vscode-descriptionForeground)', lineHeight: 1.5 }}>
          当前系统未安装 Git，或环境变量未配置。
          <br />
          请安装 Git 后 <span style={{ color: 'var(--vscode-textLink-foreground)' }}>重启 VS Code</span>。
        </div>
        <button
          className={styles['commit-btn']}
          onClick={() => vscode.postMessage({ command: 'openExternal', url: 'https://git-scm.com/downloads' })}
          style={{ width: 'auto', padding: '0 20px', borderRadius: '4px', height: '32px' }}
        >
          <i className="codicon codicon-cloud-download" style={{ marginRight: '6px' }} />
          前往官网下载 Git
        </button>
      </div>
    );
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
              <Tooltip content={!skipVerify ? '校验开启' : '校验关闭'}>
                <button
                  className={styles['icon-btn']}
                  onClick={() => {
                    const newValue = !skipVerify;
                    setSkipVerify(newValue);
                    vscode.postMessage({ command: 'toggleSkipVerify', value: newValue });
                  }}
                  style={{ color: !skipVerify ? '#3168d1' : 'inherit' }}
                >
                  <i className="codicon codicon-shield" />
                </button>
              </Tooltip>

              <Tooltip content="拉取 (Pull)">
                <button className={styles['icon-btn']} onClick={() => vscode.postMessage({ command: 'pull' })}>
                  <i className="codicon codicon-repo-pull" />
                </button>
              </Tooltip>

              <Tooltip content="推送 (Push)">
                <button className={styles['icon-btn']} onClick={() => vscode.postMessage({ command: 'push' })}>
                  <i className="codicon codicon-repo-push" />
                </button>
              </Tooltip>

              <Tooltip content={viewMode === 'list' ? '以树状视图查看' : '以列表视图查看'}>
                <button className={styles['icon-btn']} onClick={() => setViewMode((v) => (v === 'list' ? 'tree' : 'list'))}>
                  <i className={`codicon ${viewMode === 'list' ? 'codicon-list-tree' : 'codicon-list-flat'}`} />
                </button>
              </Tooltip>
            </>
          ) : (
            <Tooltip content="克隆仓库 (Clone)">
              <button className={styles['icon-btn']} onClick={() => vscode.postMessage({ command: 'clone' })}>
                <i className="codicon codicon-repo-clone" />
              </button>
            </Tooltip>
          )}
        </div>
      </div>

      <div className={styles['commit-box']}>
        <div
          ref={commitInputRef}
          className={styles['commit-input']}
          contentEditable={isRepo && !loading}
          data-placeholder="消息 (按 Ctrl+Enter 提交)"
          onInput={(e) => {
            const el = e.currentTarget;
            const text = el.innerText.replace(/\n/g, '').trim();

            if (!text) {
              el.innerHTML = '';
              setCommitMsg('');
            } else {
              setCommitMsg(el.innerText);
            }

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
            insertPlainTextAtCursor(text);

            const el = e.currentTarget;
            const currentText = el.innerText.replace(/\n/g, '').trim();

            if (!currentText) {
              el.innerHTML = '';
              setCommitMsg('');
            } else {
              setCommitMsg(el.innerText);
            }

            setJustCommitted(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
          }}
          suppressContentEditableWarning={true}
        />

        <button className={styles['commit-btn']} disabled={!isRepo || loading || !commitMsg.trim() || (stagedFiles.length === 0 && unstagedFiles.length === 0)} onClick={handleCommit}>
          {loading ? <i className="codicon codicon-loading codicon-modifier-spin" style={{ marginRight: '6px' }} /> : <i className="codicon codicon-check" style={{ marginRight: '6px' }} />}
          提交 (Commit)
        </button>
      </div>

      <div className={styles['changes-scroll-area']} style={{ maxHeight: 'none', overflowY: 'visible', flexShrink: 0 }}>
        <div className={styles['changes-section']}>
          <div className={styles['changes-header']} onClick={() => setIsChangesOpen(!isChangesOpen)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <i className={`codicon ${isChangesOpen ? 'codicon-chevron-down' : 'codicon-chevron-right'}`} style={{ fontSize: '14px', width: '16px' }} />
              更改 <span className={styles['badge']}>{stagedFiles.length + unstagedFiles.length + conflictedFiles.length}</span>
            </div>

            {isRepo && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Tooltip content="刷新状态和更改">
                  <button
                    className={styles['action-btn']}
                    onClick={(e) => {
                      e.stopPropagation();
                      vscode.postMessage({ command: 'refreshStatusOnly' });
                    }}
                    style={{ opacity: 0.8, width: '20px', height: '20px', display: 'flex', justifyContent: 'center' }}
                  >
                    <i className="codicon codicon-refresh" />
                  </button>
                </Tooltip>

                {justCommitted && (
                  <Tooltip content="撤销刚刚的提交 (退回工作区)">
                    <button
                      className={styles['action-btn']}
                      onClick={(e) => {
                        e.stopPropagation();
                        vscode.postMessage({ command: 'undoLastCommit' });
                        setJustCommitted(false);
                      }}
                      style={{ opacity: 0.8, width: '20px', height: '20px', display: 'flex', justifyContent: 'center' }}
                    >
                      <i className="codicon codicon-debug-restart-frame" />
                    </button>
                  </Tooltip>
                )}
              </div>
            )}
          </div>

          {isChangesOpen && (
            <div style={{ maxHeight: '30vh', overflowY: 'auto', paddingBottom: '4px' }}>
              {/* 1. 暂存区 */}
              {stagedFiles.length > 0 && (
                <div className={styles['changes-section']} style={{ marginLeft: '12px' }}>
                  <div className={styles['changes-header']} style={{ cursor: 'default', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <i className="codicon codicon-git-pull-request-done" style={{ fontSize: '14px', width: '16px' }} />
                      暂存区 <span className={styles['badge']}>{stagedFiles.length}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                      <Tooltip content="取消暂存所有更改">
                        <button
                          className={styles['action-btn']}
                          onClick={(e) => {
                            e.stopPropagation();
                            vscode.postMessage({ command: 'unstageAll' });
                          }}
                          style={{ opacity: 0.8, width: '20px', height: '20px', display: 'flex', justifyContent: 'center' }}
                        >
                          <i className="codicon codicon-remove" />
                        </button>
                      </Tooltip>
                    </div>
                  </div>
                  {renderFileList(stagedFiles, 'staged')}
                </div>
              )}

              {/* 2. 工作区 */}
              <div className={styles['changes-section']} style={{ marginLeft: '12px' }}>
                <div className={styles['changes-header']} style={{ cursor: 'default', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <i className="codicon codicon-git-branch-changes" style={{ fontSize: '14px', width: '16px' }} />
                    工作区 <span className={styles['badge']}>{unstagedFiles.length}</span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                    {(unstagedFiles.length > 0 || stagedFiles.length > 0 || conflictedFiles.length > 0) && (
                      <Tooltip content="贮藏更改 (Stash)">
                        <button
                          className={styles['action-btn']}
                          onClick={(e) => {
                            e.stopPropagation();
                            vscode.postMessage({ command: 'stash' });
                          }}
                          style={{ opacity: 0.8, width: '20px', height: '20px', display: 'flex', justifyContent: 'center' }}
                        >
                          <i className="codicon codicon-archive" />
                        </button>
                      </Tooltip>
                    )}

                    {unstagedFiles.length > 0 && (
                      <>
                        <Tooltip content="放弃所有更改">
                          <button
                            className={styles['action-btn']}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (unstagedFiles.length === 1) {
                                vscode.postMessage({ command: 'discard', file: unstagedFiles[0].file, status: unstagedFiles[0].status });
                              } else {
                                vscode.postMessage({ command: 'discardAll', count: unstagedFiles.length });
                              }
                            }}
                            style={{ opacity: 0.8, width: '20px', height: '20px', display: 'flex', justifyContent: 'center' }}
                          >
                            <i className="codicon codicon-discard" />
                          </button>
                        </Tooltip>

                        <Tooltip content="暂存所有更改">
                          <button
                            className={styles['action-btn']}
                            onClick={(e) => {
                              e.stopPropagation();
                              vscode.postMessage({ command: 'stageAll' });
                            }}
                            style={{ opacity: 0.8, width: '20px', height: '20px', display: 'flex', justifyContent: 'center' }}
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
                  renderFileList(unstagedFiles, 'unstaged')
                )}
              </div>

              {/* 3. 冲突区 */}
              {conflictedFiles.length > 0 && (
                <div className={styles['changes-section']} style={{ marginLeft: '12px', marginTop: '8px' }}>
                  <div className={styles['changes-header']} style={{ cursor: 'default', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--vscode-errorForeground, #f14c4c)' }}>
                      <i className="codicon codicon-warning" style={{ fontSize: '14px', width: '16px' }} />
                      冲突区{' '}
                      <span className={styles['badge']} style={{ backgroundColor: 'var(--vscode-errorForeground, #f14c4c)', color: '#fff', border: 'none' }}>
                        {conflictedFiles.length}
                      </span>
                    </div>
                  </div>
                  {renderFileList(conflictedFiles, 'unstaged')}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 🌟 贮藏 (Stashes) 面板 */}
        <div className={styles['changes-section']} style={{ marginTop: '8px' }}>
          <div className={styles['changes-header']} onClick={() => setIsStashesOpen(!isStashesOpen)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flex: 1, minWidth: 0 }}>
              <i className={`codicon ${isStashesOpen ? 'codicon-chevron-down' : 'codicon-chevron-right'}`} style={{ fontSize: '14px', width: '16px', flexShrink: 0 }} />
              <span style={{ flexShrink: 0 }}>贮藏</span>
              <span className={styles['badge']} style={{ flexShrink: 0 }}>
                {stashes.length}
              </span>
            </div>
          </div>

          {isStashesOpen && (
            <div style={{ maxHeight: '30vh', overflowY: 'auto', paddingBottom: '4px' }}>
              {stashes.length === 0 ? (
                <div className={styles['empty-message']}>没有贮藏记录</div>
              ) : (
                <ul className={styles['file-list']}>
                  {stashes.map((stash, idx) => {
                    const isExpanded = expandedStashIndex === stash.index;
                    const isLoading = stashFilesLoading[stash.index];
                    const files = stashFilesMap[stash.index] || [];

                    return (
                      <React.Fragment key={idx}>
                        <li
                          // 🌟 修改点 2: 移除了 isExpanded 时的 active 高亮背景，仅保留点击功能
                          className={styles['file-item']}
                          title={stash.message}
                          style={{ paddingLeft: '12px', cursor: 'pointer' }}
                          onClick={() => {
                            if (isExpanded) {
                              setExpandedStashIndex(null);
                            } else {
                              setExpandedStashIndex(stash.index);
                              if (!stashFilesMap[stash.index]) {
                                setStashFilesLoading((prev) => ({ ...prev, [stash.index]: true }));
                                vscode.postMessage({ command: 'getStashFiles', index: stash.index });
                              }
                            }
                          }}
                        >
                          <i className={`codicon ${isExpanded ? 'codicon-chevron-down' : 'codicon-chevron-right'}`} style={{ fontSize: '14px', width: '16px', opacity: 0.8, marginRight: '2px' }} />
                          <i className="codicon codicon-archive" style={{ marginRight: '6px', color: 'var(--vscode-icon-foreground)' }} />
                          <div className={styles['file-name']}>{stash.message}</div>
                          <div style={{ flex: 1 }}></div>

                          <div className={styles['file-actions']}>
                            <Tooltip content="应用贮藏并保留 (Apply)">
                              <button
                                className={styles['action-btn']}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  vscode.postMessage({ command: 'stashApply', index: stash.index });
                                }}
                              >
                                {/* 🌟 修改点 3: 替换成了 git-stash-apply 图标 */}
                                <i className="codicon codicon-git-stash-apply" />
                              </button>
                            </Tooltip>
                            <Tooltip content="应用并删除贮藏 (Pop)">
                              <button
                                className={styles['action-btn']}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  vscode.postMessage({ command: 'stashPop', index: stash.index });
                                }}
                              >
                                {/* 🌟 修改点 3: 替换成了 git-stash-pop 图标 */}
                                <i className="codicon codicon-git-stash-pop" />
                              </button>
                            </Tooltip>
                            <Tooltip content="删除此贮藏 (Drop)">
                              <button
                                className={styles['action-btn']}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  vscode.postMessage({ command: 'stashDrop', index: stash.index });
                                }}
                              >
                                <i className="codicon codicon-trash" />
                              </button>
                            </Tooltip>
                          </div>
                        </li>

                        {/* 🌟 修改点 4: 去掉深色背景，增加 paddingLeft 制造显著的间距缩进 */}
                        {isExpanded && (
                          <div style={{ paddingBottom: '4px' }}>
                            {isLoading ? (
                              <div style={{ height: '32px', display: 'flex', alignItems: 'center', opacity: 0.6, fontSize: '11px', padding: '0 24px' }}>
                                <i className="codicon codicon-loading codicon-modifier-spin" style={{ marginRight: '6px' }} />
                                加载变动文件...
                              </div>
                            ) : (
                              <div style={{ paddingLeft: '30px' }}>{renderFileList(files, 'stash-file', `stash@{${stash.index}}`)}</div>
                            )}
                          </div>
                        )}
                      </React.Fragment>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className={styles['changes-section']} style={{ marginTop: '8px' }}>
          <div className={styles['changes-header']} onClick={() => setIsCompareOpen(!isCompareOpen)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flex: 1, minWidth: 0 }}>
              <i className={`codicon ${isCompareOpen ? 'codicon-chevron-down' : 'codicon-chevron-right'}`} style={{ fontSize: '14px', width: '16px', flexShrink: 0 }} />
              <span style={{ flexShrink: 0 }}>{compareBase === '文件历史' ? '文件历史' : '对比'}</span>

              {compareTarget && compareBase && (
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    color: 'var(--vscode-textLink-foreground)',
                    fontSize: '11px',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                  title={compareBase === '文件历史' ? `文件: ${compareTarget}` : `${compareTarget} ↔ ${compareBase}`}
                >
                  {compareBase === '文件历史' ? `(${compareTarget})` : `(${compareTarget} ↔ ${compareBase})`}
                </span>
              )}

              <span className={styles['badge']} style={{ flexShrink: 0 }}>
                {compareCommits.length}
              </span>
            </div>

            {isRepo && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '2px', flexShrink: 0 }}>
                <Tooltip content={activeFile ? `查看当前文件历史` : '查看当前文件历史 (请先打开文件)'}>
                  <button
                    className={styles['action-btn']}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!activeFile) {
                        vscode.postMessage({
                          command: 'error',
                          message: '当前没有在编辑器中打开任何文件，无法查看历史记录。',
                        });
                        return;
                      }
                      vscode.postMessage({ command: 'viewFileHistory', file: activeFile });
                    }}
                    style={{
                      opacity: activeFile ? 0.8 : 0.4,
                      width: '20px',
                      height: '20px',
                      display: 'flex',
                      justifyContent: 'center',
                      cursor: activeFile ? 'pointer' : 'not-allowed',
                    }}
                  >
                    <i className="codicon codicon-history" />
                  </button>
                </Tooltip>

                <Tooltip content="跨分支对比">
                  <button
                    className={styles['action-btn']}
                    onClick={(e) => {
                      e.stopPropagation();
                      vscode.postMessage({ command: 'compareFileAcrossBranches' });
                    }}
                    style={{
                      opacity: 0.8,
                      width: '20px',
                      height: '20px',
                      display: 'flex',
                      justifyContent: 'center',
                      cursor: 'pointer',
                    }}
                  >
                    <i className="codicon codicon-git-compare" />
                  </button>
                </Tooltip>

                {compareTarget && compareBase && (
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
            )}
          </div>

          {isCompareOpen && (
            <div style={{ maxHeight: '30vh', overflowY: 'auto', paddingBottom: '4px' }}>
              {!compareTarget || !compareBase ? (
                <div className={styles['empty-message']}>{!isRepo ? '未连接至 Git 仓库' : '点击右上角图标选择分支或查看文件历史'}</div>
              ) : (
                <GitCompareList
                  commits={compareCommits}
                  activeCommitHash={activeCommitHash}
                  loadedCommitHash={commitFilesMap[activeCommitHash || ''] ? activeCommitHash : null}
                  commitFilesLoading={!!commitFilesLoadingMap[activeCommitHash || '']}
                  commitFiles={commitFilesMap[activeCommitHash || ''] || []}
                  remoteUrl={remoteUrl}
                  onCommitClick={(hash) => {
                    if (activeCommitHash === hash) {
                      setActiveCommitHash(null);
                    } else {
                      toggleCommit(hash);
                    }
                  }}
                  renderCommitFiles={(files) => renderFileList(files, compareBase === '文件历史' ? 'history' : 'compare', activeCommitHash || undefined)}
                />
              )}
            </div>
          )}
        </div>
      </div>

      <div className={styles['git-graph-section']}>
        <div className={styles['changes-header']} onClick={() => setIsGraphOpen(!isGraphOpen)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <i className={`codicon ${isGraphOpen ? 'codicon-chevron-down' : 'codicon-chevron-right'}`} style={{ fontSize: '14px', width: '16px' }} />
            图形
          </div>

          {isRepo && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Tooltip content="新建本地分支">
                <button
                  className={styles['action-btn']}
                  onClick={(e) => {
                    e.stopPropagation();
                    vscode.postMessage({ command: 'createBranch' });
                  }}
                  style={{ opacity: 0.8, width: '20px', height: '20px', display: 'flex', justifyContent: 'center' }}
                >
                  <i className="codicon codicon-git-branch-staged-changes" />
                </button>
              </Tooltip>

              <Tooltip content="切换分支 (Checkout)">
                <button
                  className={styles['action-btn']}
                  onClick={(e) => {
                    e.stopPropagation();
                    vscode.postMessage({ command: 'checkoutBranch' });
                  }}
                  style={{ opacity: 0.8, width: '20px', height: '20px', display: 'flex', justifyContent: 'center' }}
                >
                  <i className="codicon codicon-git-branch" />
                </button>
              </Tooltip>

              <Tooltip content="合并本地分支 (Merge)">
                <button
                  className={styles['action-btn']}
                  onClick={(e) => {
                    e.stopPropagation();
                    vscode.postMessage({ command: 'mergeBranch' });
                  }}
                  style={{ opacity: 0.8, width: '20px', height: '20px', display: 'flex', justifyContent: 'center' }}
                >
                  <i className="codicon codicon-merge" />
                </button>
              </Tooltip>

              <Tooltip content={`筛选分支 (${selectedGraphFilter})`}>
                <button
                  className={styles['action-btn']}
                  onClick={(e) => {
                    e.stopPropagation();
                    vscode.postMessage({ command: 'changeGraphFilter', current: selectedGraphFilter });
                  }}
                  style={{
                    opacity: selectedGraphFilter !== '全部分支' ? 1 : 0.8,
                    width: '20px',
                    height: '20px',
                    display: 'flex',
                    justifyContent: 'center',
                    backgroundColor: flashBranchBtn ? 'var(--vscode-button-background, #3168d1)' : 'transparent',
                    color: flashBranchBtn ? 'var(--vscode-button-foreground, #ffffff)' : 'inherit',
                    borderRadius: '3px',
                    transition: 'all 0.5s ease-out',
                  }}
                >
                  <i className="codicon codicon-filter" />
                </button>
              </Tooltip>

              <Tooltip content={isGraphSearchOpen ? '关闭搜索' : '搜索提交'}>
                <button
                  className={styles['action-btn']}
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsGraphSearchOpen((prev) => !prev);
                  }}
                  style={{
                    opacity: isGraphSearchOpen ? 1 : 0.8,
                    width: '20px',
                    height: '20px',
                    display: 'flex',
                    justifyContent: 'center',
                    backgroundColor: isGraphSearchOpen ? 'var(--vscode-button-background, #3168d1)' : 'transparent',
                    color: isGraphSearchOpen ? 'var(--vscode-button-foreground, #ffffff)' : 'inherit',
                    borderRadius: '3px',
                  }}
                >
                  <i className="codicon codicon-search" />
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
          )}
        </div>

        {isGraphOpen &&
          (isGraphLoading ? (
            <div style={{ textAlign: 'center', padding: '30px 10px', color: 'var(--vscode-descriptionForeground)', fontSize: '12px', opacity: 0.8 }}>
              <i className="codicon codicon-loading codicon-modifier-spin" style={{ marginRight: '8px' }} /> 正在加载历史记录...
            </div>
          ) : graphCommits.length === 0 ? (
            <div className={styles['git-graph-fallback']}>{!isRepo ? '未连接至 Git 仓库' : '暂无记录'}</div>
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
              renderCommitFiles={(hash, files) => renderFileList(files, 'history', hash)}
              onCommitContextMenu={(e, commit) => {
                e.preventDefault();
                setContextMenu({ visible: true, x: e.clientX, y: e.clientY, type: 'commit', commit });
              }}
            />
          ))}
      </div>
    </div>
  );
}
