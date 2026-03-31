import { useEffect, useState } from 'react';
import { vscode } from '../utils/vscode';

export default function MockProxyPanelApp() {
  const [proxyId, setProxyId] = useState('');
  const [port, setPort] = useState('');
  const [isEdit, setIsEdit] = useState(false);

  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      const msg = e.data;
      if (msg.type === 'init' && msg.proxy) {
        setProxyId(msg.proxy.id || '');
        setPort(msg.proxy.port || '');
        setIsEdit(true);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const save = () => {
    const portNum = parseInt(port, 10);
    if (!portNum) return vscode.postMessage({ type: 'error', message: '端口为必填项！' });
    vscode.postMessage({ type: 'saveProxy', payload: { id: proxyId, port: portNum } });
  };

  return (
    <div style={{ padding: '30px' }}>
      <style>{`
        html{ min-width:298px }
        body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size, 13px); background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); }
        .panel-container { max-width: 500px; margin: 0 auto; display: flex; flex-direction: column; gap: 16px; }
        h2 { font-weight: 400; font-size: 20px; margin: 0 0 10px 0; color: var(--vscode-editor-foreground); }
        label { display: block; margin-bottom: 6px; color: var(--vscode-descriptionForeground); font-size: 12px; }
        input { width: 100%; box-sizing: border-box; padding: 6px; border-radius: 2px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); }
        input:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; border-color: var(--vscode-focusBorder); }
        .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; padding-top: 20px; border-top: 1px solid var(--vscode-panel-border); }
        button { padding: 6px 14px; cursor: pointer; border: 1px solid transparent; border-radius: 2px; font-size: 13px; font-family: var(--vscode-font-family); }
        .btn-pri { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
        .btn-pri:hover { background: var(--vscode-button-hoverBackground); }
        .btn-sec { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
        .btn-sec:hover { background: var(--vscode-button-secondaryHoverBackground); }
      `}</style>
      <div className="panel-container">
        <h2>{isEdit ? '编辑 Mock 服务' : '新增 Mock 服务'}</h2>
        <div>
          <label>本地服务监听端口 (Port)</label>
          <input type="number" value={port} onChange={(e) => setPort(e.target.value)} placeholder="例如: 8080" title="请输入一个空闲的端口号" />
        </div>
        <div className="actions">
          <button className="btn-sec" onClick={() => vscode.postMessage({ type: 'cancel' })} title="取消编辑">取消</button>
          <button className="btn-pri" onClick={save} title="保存服务端口配置">保存配置</button>
        </div>
      </div>
    </div>
  );
}