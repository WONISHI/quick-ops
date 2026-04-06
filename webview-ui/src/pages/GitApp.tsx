import { useState, useEffect, useRef } from 'react';
import { vscode } from '../utils/vscode';
import '../assets/css/GitApp.css';

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faRotateRight, faArrowDown, faArrowUp, faCheck, faChevronDown, faChevronRight, faSpinner, faPlus, faMinus, faRotateLeft, faFolderOpen, faCopy } from '@fortawesome/free-solid-svg-icons';
import { faImage, faCode, faFile } from '@fortawesome/free-solid-svg-icons'; 
import { faMarkdown, faHtml5, faCss3Alt, faVuejs, faJs, faGithub, faGitlab } from '@fortawesome/free-brands-svg-icons';

interface GitFile { status: string; file: string; }
interface GraphCommit { hash: string; author: string; email?: string; message: string; timestamp?: number; }

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
  return `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日 ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
}

function parseRemoteInfo(url: string, hash: string) {
  if (!url) return null;
  let cleanUrl = url.replace(/\.git$/, '');
  if (cleanUrl.startsWith('git@')) {
    cleanUrl = cleanUrl.replace(/^git@([^:]+):/, 'https://$1/');
  }
  let platform = 'GitLab';
  let icon = faGitlab;
  if (cleanUrl.includes('github.com')) { platform = 'GitHub'; icon = faGithub; }
  else if (cleanUrl.includes('gitee.com')) { platform = 'Gitee'; }
  
  return { platform, icon, url: `${cleanUrl}/commit/${hash}` };
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
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [remoteUrl, setRemoteUrl] = useState<string>('');

  const [activeCommitHash, setActiveCommitHash] = useState<string | null>(null);
  const [loadedCommitHash, setLoadedCommitHash] = useState<string | null>(null);
  const [activeCommitParentHash, setActiveCommitParentHash] = useState<string | undefined>();
  const [commitFiles, setCommitFiles] = useState<GitFile[]>([]);
  const [commitFilesLoading, setCommitFilesLoading] = useState(false);

  const [hoverInfo, setHoverInfo] = useState<{ commit: GraphCommit, x: number, y: number } | null>(null);
  const hoverTimeoutRef = useRef<any>(null);

  useEffect(() => {
    vscode.postMessage({ command: 'webviewLoaded' });

    const handleMsg = (e: MessageEvent) => {
      const msg = e.data;
      if (msg.type === 'statusData') {
        setStagedFiles(msg.stagedFiles || []);
        setUnstagedFiles(msg.unstagedFiles || []);
        setBranch(msg.branch || '');
        setRemoteUrl(msg.remoteUrl || '');
        
        const commits = msg.graphCommits || [];
        setGraphCommits(commits); 
        setHasMoreCommits(commits.length >= 30); 
        setLoading(false);
        setIsLoadingMore(false);
      } 
      else if (msg.type === 'moreCommitsData') {
        const newCommits = msg.commits || [];
        setGraphCommits(prev => [...prev, ...newCommits]); 
        setHasMoreCommits(newCommits.length >= 30); 
        setIsLoadingMore(false);
      }
      else if (msg.type === 'commitFilesData') {
        setCommitFiles(msg.files || []);
        setActiveCommitParentHash(msg.parentHash);
        setLoadedCommitHash(msg.hash);
        setCommitFilesLoading(false);
      }
      else if (msg.type === 'error') {
        setLoading(false);
        setIsLoadingMore(false);
        setCommitFilesLoading(false);
      }
    };
    window.addEventListener('message', handleMsg);
    return () => window.removeEventListener('message', handleMsg);
  }, []);

  // 🌟 修改：加入 600ms 悬浮延迟，防止鼠标划过时闪烁弹出
  const handleMouseEnter = (e: React.MouseEvent, commit: GraphCommit) => {
    const rect = e.currentTarget.getBoundingClientRect();
    clearTimeout(hoverTimeoutRef.current);
    
    hoverTimeoutRef.current = setTimeout(() => {
      // 防止弹窗在底部被切掉，动态计算 Y 坐标
      const safeY = Math.min(rect.bottom + 4, window.innerHeight - 120);
      setHoverInfo({ commit, x: rect.left + 24, y: safeY });
    }, 600); // <--- 600毫秒延迟
  };

  const handleMouseLeave = () => {
    clearTimeout(hoverTimeoutRef.current);
    hoverTimeoutRef.current = setTimeout(() => {
      setHoverInfo(null);
    }, 150);
  };

  const handleCommit = () => {
    if (!commitMsg.trim()) return;
    setLoading(true);
    vscode.postMessage({ command: 'commit', message: commitMsg });
    setCommitMsg('');
  };

  const getStatusClass = (status: string) => {
    if (status.includes('M')) return 'status-M';
    if (status.includes('D')) return 'status-D';
    return 'status-A'; 
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
      case 'ts':
      case 'tsx': return <FontAwesomeIcon icon={faJs} className="file-icon" style={{color: '#3178c6'}} />;
      case 'js':
      case 'jsx': return <FontAwesomeIcon icon={faJs} className="file-icon" style={{color: '#f1e05a'}} />;
      case 'vue': return <FontAwesomeIcon icon={faVuejs} className="file-icon" style={{color: '#41b883'}} />;
      case 'css':
      case 'less':
      case 'scss': return <FontAwesomeIcon icon={faCss3Alt} className="file-icon" style={{color: '#264de4'}} />;
      case 'html': return <FontAwesomeIcon icon={faHtml5} className="file-icon" style={{color: '#e34c26'}} />;
      case 'json': return <FontAwesomeIcon icon={faCode} className="file-icon" style={{color: '#cbcb41'}} />;
      case 'md': return <FontAwesomeIcon icon={faMarkdown} className="file-icon" style={{color: '#4daafc'}} />;
      case 'png':
      case 'jpg':
      case 'svg': return <FontAwesomeIcon icon={faImage} className="file-icon" style={{color: '#a074c4'}} />;
      default: return <FontAwesomeIcon icon={faFile} className="file-icon" style={{color: 'var(--vscode-descriptionForeground)'}} />;
    }
  };

  const renderFileList = (files: GitFile[], listType: 'staged' | 'unstaged' | 'history') => {
    return (
      <ul className="file-list">
        {files.map((item, idx) => {
          const parts = item.file.split('/');
          const fileName = parts.pop();
          const dirPath = parts.length > 0 ? parts.join('/') : '';
          return (
            <li 
              key={idx} 
              className={`file-item ${activeFile === item.file ? 'active' : ''}`} 
              title={item.file}
              onClick={() => {
                setActiveFile(item.file);
                if (listType === 'history') {
                  vscode.postMessage({ 
                    command: 'diffCommitFile', 
                    file: item.file, 
                    hash: activeCommitHash, 
                    parentHash: activeCommitParentHash,
                    status: item.status
                  });
                } else {
                  vscode.postMessage({ command: 'diff', file: item.file, status: item.status });
                }
              }}
            >
              {getFileIcon(fileName || '')}
              <div className="file-name">{fileName}</div>
              {dirPath && <div className="file-dir">{dirPath}</div>}
              
              <div className="file-actions" onClick={(e) => e.stopPropagation()}>
                <button className="action-btn" title="打开文件" onClick={() => vscode.postMessage({command: 'open', file: item.file})}>
                  <FontAwesomeIcon icon={faFolderOpen} />
                </button>
                {listType !== 'history' && (
                  <>
                    <button className="action-btn" title="放弃更改" onClick={() => vscode.postMessage({command: 'discard', file: item.file, status: item.status})}>
                      <FontAwesomeIcon icon={faRotateLeft} />
                    </button>
                    {listType === 'staged' ? (
                      <button className="action-btn" title="取消暂存更改" onClick={() => vscode.postMessage({command: 'unstage', file: item.file})}>
                        <FontAwesomeIcon icon={faMinus} />
                      </button>
                    ) : (
                      <button className="action-btn" title="暂存更改" onClick={() => vscode.postMessage({command: 'stage', file: item.file, status: item.status})}>
                        <FontAwesomeIcon icon={faPlus} />
                      </button>
                    )}
                  </>
                )}
              </div>
              <div className={`status-badge ${getStatusClass(item.status)}`}>{getStatusText(item.status)}</div>
            </li>
          );
        })}
      </ul>
    );
  }

  const toggleCommit = (hash: string) => {
    // 🌟 展开时立刻清除掉 hover 的计时器和窗口，防止重叠
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
    <div className="git-sidebar">
      {hoverInfo && (
        <div 
          className="commit-hover-widget"
          style={{ left: Math.min(hoverInfo.x, window.innerWidth - 300), top: hoverInfo.y }}
          onMouseEnter={() => clearTimeout(hoverTimeoutRef.current)}
          onMouseLeave={handleMouseLeave}
        >
          <div className="hover-header">
            <div className="hover-avatar">{hoverInfo.commit.author[0].toUpperCase()}</div>
            <span className="hover-author">{hoverInfo.commit.author}</span>
            {hoverInfo.commit.timestamp && (
              <span className="hover-time">
                , {formatRelativeTime(hoverInfo.commit.timestamp)} ({formatAbsoluteTime(hoverInfo.commit.timestamp)})
              </span>
            )}
          </div>
          <div className="hover-message">{hoverInfo.commit.message}</div>
          
          <div className="hover-divider"></div>
          <div className="hover-footer">
            <span 
              className="hover-action-btn" 
              onClick={() => vscode.postMessage({command: 'copy', text: hoverInfo.commit.hash})}
              title="复制 Hash"
            >
              <FontAwesomeIcon icon={faCopy} /> {hoverInfo.commit.hash.substring(0, 7)}
            </span>
            
            {remoteUrl && parseRemoteInfo(remoteUrl, hoverInfo.commit.hash) && (
              <>
                <span className="hover-separator">|</span>
                <span 
                  className="hover-action-btn"
                  onClick={() => vscode.postMessage({command: 'openExternal', url: parseRemoteInfo(remoteUrl, hoverInfo.commit.hash)!.url})}
                >
                  <FontAwesomeIcon icon={parseRemoteInfo(remoteUrl, hoverInfo.commit.hash)!.icon} /> 
                  在 {parseRemoteInfo(remoteUrl, hoverInfo.commit.hash)!.platform} 上打开
                </span>
              </>
            )}
          </div>
        </div>
      )}

      <div className="git-toolbar">
        <span>Git 管理 <span style={{textTransform: 'none', opacity: 0.7}}>({branch})</span></span>
        <div className="git-actions">
          <button className="icon-btn" title="刷新" onClick={() => vscode.postMessage({command: 'refresh'})}>
            <FontAwesomeIcon icon={faRotateRight} />
          </button>
          <button className="icon-btn" title="拉取 (Pull)" onClick={() => vscode.postMessage({command: 'pull'})}>
            <FontAwesomeIcon icon={faArrowDown} />
          </button>
          <button className="icon-btn" title="推送 (Push)" onClick={() => vscode.postMessage({command: 'push'})}>
            <FontAwesomeIcon icon={faArrowUp} />
          </button>
        </div>
      </div>

      <div className="commit-box">
        <textarea
          className="commit-input"
          placeholder="消息 (按 Ctrl+Enter 提交)"
          value={commitMsg}
          onChange={(e) => setCommitMsg(e.target.value)}
          onKeyDown={(e) => {
            if (e.ctrlKey && e.key === 'Enter') handleCommit();
          }}
        />
        <button 
          className="commit-btn" 
          disabled={loading || (!commitMsg.trim() || (stagedFiles.length === 0 && unstagedFiles.length === 0))}
          onClick={handleCommit}
          title={stagedFiles.length === 0 ? "暂存所有文件并提交" : "提交已暂存的更改"}
        >
          {loading ? <FontAwesomeIcon icon={faSpinner} spin style={{marginRight: '6px'}} /> : <FontAwesomeIcon icon={faCheck} style={{marginRight: '6px'}} />}
          提交 (Commit)
        </button>
      </div>

      <div className="changes-scroll-area">
        {stagedFiles.length > 0 && (
          <div className="changes-section">
            <div className="changes-header" onClick={() => setIsStagedOpen(!isStagedOpen)}>
              <FontAwesomeIcon icon={isStagedOpen ? faChevronDown : faChevronRight} style={{ fontSize: '10px', width: '12px' }} />
              暂存的更改
              <span className="badge">{stagedFiles.length}</span>
            </div>
            {isStagedOpen && renderFileList(stagedFiles, 'staged')}
          </div>
        )}

        <div className="changes-section">
          <div className="changes-header" onClick={() => setIsUnstagedOpen(!isUnstagedOpen)}>
            <FontAwesomeIcon icon={isUnstagedOpen ? faChevronDown : faChevronRight} style={{ fontSize: '10px', width: '12px' }} />
            更改
            <span className="badge">{unstagedFiles.length}</span>
          </div>
          {isUnstagedOpen && (
            unstagedFiles.length === 0 && stagedFiles.length === 0 ? (
              <div className="empty-message">没有需要提交的更改</div>
            ) : (
              renderFileList(unstagedFiles, 'unstaged')
            )
          )}
        </div>
      </div>

      <div className="git-graph-section">
          <div className="changes-header" onClick={() => setIsGraphOpen(!isGraphOpen)} style={{ marginTop: 0 }}>
            <FontAwesomeIcon icon={isGraphOpen ? faChevronDown : faChevronRight} style={{ fontSize: '10px', width: '12px' }} />
            图形
          </div>
          {isGraphOpen && (
            graphCommits.length === 0 ? (
                <div className="git-graph-fallback">暂无记录</div>
            ) : (
                <div className="git-graph-view" onScroll={handleGraphScroll}>
                    <ul className="commit-timeline">
                        {graphCommits.map(c => (
                            <li 
                              key={c.hash} 
                              className="commit-log-item"
                              onMouseEnter={(e) => handleMouseEnter(e, c)}
                              onMouseLeave={handleMouseLeave}
                            >
                                <div onClick={() => toggleCommit(c.hash)} style={{cursor: 'pointer'}}>
                                  <div className="commit-node"></div>
                                  <div className="commit-message">{c.message}</div>
                                  <div className="commit-meta">
                                      <span>{c.author}</span>
                                      <span className="commit-hash">{c.hash.substring(0, 7)}</span>
                                  </div>
                                </div>
                                
                                {activeCommitHash === c.hash && (
                                  <div className="commit-files-wrapper">
                                    {(commitFilesLoading || loadedCommitHash !== c.hash) ? (
                                      <div style={{opacity: 0.6, fontSize: '11px', padding: '6px 12px'}}>
                                        <FontAwesomeIcon icon={faSpinner} spin /> 加载变动文件...
                                      </div>
                                    ) : (
                                      renderFileList(commitFiles, 'history')
                                    )}
                                  </div>
                                )}
                            </li>
                        ))}
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