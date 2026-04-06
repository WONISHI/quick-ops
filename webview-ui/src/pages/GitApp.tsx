import { useState, useEffect } from 'react';
import { vscode } from '../utils/vscode';
import '../assets/css/GitApp.css';

interface GitFile {
  status: string;
  file: string;
}

export default function GitApp() {
  const [files, setFiles] = useState<GitFile[]>([]);
  const [branch, setBranch] = useState('');
  const [commitMsg, setCommitMsg] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // 告诉后端页面加载完毕，请求初始数据
    vscode.postMessage({ command: 'webviewLoaded' });

    const handleMsg = (e: MessageEvent) => {
      const msg = e.data;
      if (msg.type === 'statusData') {
        setFiles(msg.files || []);
        setBranch(msg.branch || '');
        setLoading(false);
      } else if (msg.type === 'error') {
        setLoading(false);
      }
    };
    window.addEventListener('message', handleMsg);
    return () => window.removeEventListener('message', handleMsg);
  }, []);

  const handleCommit = () => {
    if (!commitMsg.trim()) return;
    setLoading(true);
    vscode.postMessage({ command: 'commit', message: commitMsg });
    setCommitMsg('');
  };

  // 格式化 Git 状态
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

  return (
    <div className="git-sidebar">
      {/* 顶部：标题和操作按钮 */}
      <div className="git-toolbar">
        <span>Git 管理 <span style={{textTransform: 'none', opacity: 0.7}}>({branch})</span></span>
        <div className="git-actions">
          <button className="icon-btn" title="刷新" onClick={() => vscode.postMessage({command: 'refresh'})}>
            <i className="fa-solid fa-rotate-right"></i>
          </button>
          <button className="icon-btn" title="拉取 (Pull)" onClick={() => vscode.postMessage({command: 'pull'})}>
            <i className="fa-solid fa-arrow-down"></i>
          </button>
          <button className="icon-btn" title="推送 (Push)" onClick={() => vscode.postMessage({command: 'push'})}>
            <i className="fa-solid fa-arrow-up"></i>
          </button>
        </div>
      </div>

      {/* 提交表单区 */}
      <div className="commit-box">
        <textarea
          className="commit-input"
          placeholder="消息 (按 Cmd+Enter 提交)"
          value={commitMsg}
          onChange={(e) => setCommitMsg(e.target.value)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') handleCommit();
          }}
        />
        <button 
          className="commit-btn" 
          disabled={loading || !commitMsg.trim() || files.length === 0}
          onClick={handleCommit}
        >
          {loading ? '提交中...' : '提交 (Commit)'}
        </button>
      </div>

      {/* 更改文件列表区 */}
      <div className="changes-header">
        <i className="fa-solid fa-chevron-down" style={{ fontSize: '10px' }}></i>
        更改
        <span className="badge">{files.length}</span>
      </div>

      <ul className="file-list">
        {files.length === 0 ? (
          <div style={{ padding: '20px 0', textAlign: 'center', opacity: 0.6 }}>
            没有需要提交的更改
          </div>
        ) : (
          files.map((item, idx) => {
            const parts = item.file.split('/');
            const fileName = parts.pop();
            const dirPath = parts.length > 0 ? parts.join('/') : '';
            return (
              <li key={idx} className="file-item" title={item.file}>
                <i className="fa-regular fa-file file-icon"></i>
                <div className="file-name">{fileName}</div>
                {dirPath && <div className="file-dir">{dirPath}</div>}
                <div className={`status-badge ${getStatusClass(item.status)}`}>
                  {getStatusText(item.status)}
                </div>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}