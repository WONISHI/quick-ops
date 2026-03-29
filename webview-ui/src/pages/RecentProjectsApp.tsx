import { useState, useEffect } from 'react';
import { vscode } from '../utils/vscode';

// 定义你的项目数据结构
interface Project {
  id: string;
  name: string;
  path: string;
}

export default function RecentProjectsApp() {
  const [projects, setProjects] = useState<Project[]>([]);

  // 1. 监听后端发来的项目列表数据
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      if (message.type === 'updateProjects') {
        setProjects(message.data);
      }
    };
    window.addEventListener('message', handleMessage);
    
    // 告诉后端：前端已加载完毕，把数据发过来吧！
    if (vscode) vscode.postMessage({ type: 'webviewLoaded' });

    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // 2. 触发后端命令
  const openProject = (path: string) => {
    if (vscode) vscode.postMessage({ type: 'openProject', path });
  };

  const removeProject = (id: string) => {
    if (vscode) vscode.postMessage({ type: 'removeProject', id });
  };

  return (
    <div className="container">
      <div className="header">
        <h2>📁 历史项目管理器</h2>
        <button onClick={() => { if (vscode) vscode.postMessage({ type: 'clearAll' }) }}>
          清空历史
        </button>
      </div>

      <div className="project-list">
        {projects.length === 0 ? (
          <p style={{ opacity: 0.5 }}>暂无历史项目...</p>
        ) : (
          <ul>
            {projects.map(proj => (
              <li key={proj.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0' }}>
                <span style={{ cursor: 'pointer', color: '#3794ff' }} onClick={() => openProject(proj.path)}>
                  {proj.name}
                </span>
                <button onClick={() => removeProject(proj.id)}>移除</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}