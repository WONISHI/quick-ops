import React, { useEffect, useState, useMemo } from 'react';
import { vscode } from '../utils/vscode';
// 1. 引入 FontAwesome 组件和需要的具体图标
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faServer, faCircle, faGear, faTrash, faPen, faPlus, faFileCode } from '@fortawesome/free-solid-svg-icons';
import { faFolderOpen, faCopy, faFile } from '@fortawesome/free-regular-svg-icons';

export default function MockSidebarApp() {
  const [proxies, setProxies] = useState<any[]>([]);
  const [mocks, setMocks] = useState<any[]>([]);
  const [runningProxies, setRunningProxies] = useState<string[]>([]);
  const [globalMockDir, setGlobalMockDir] = useState<string>('');
  const [copiedUrl, setCopiedUrl] = useState<string>('');

  const isGlobalRunning = useMemo(() => proxies.some((p) => p.enabled), [proxies]);

  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      const { type, proxy, mock, mockDir, runningProxies: rp } = e.data;
      if (type === 'config') {
        setProxies(proxy || []);
        setMocks(mock || []);
        setGlobalMockDir(mockDir || '');
      }
      if (type === 'status') {
        setRunningProxies(rp || []);
      }
    };
    window.addEventListener('message', handleMessage);
    vscode.postMessage({ type: 'refresh' });
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const toggleGlobalServer = () => vscode.postMessage({ type: 'toggleServer', value: !isGlobalRunning });
  const selectGlobalMockDir = () => vscode.postMessage({ type: 'selectGlobalMockDir', currentPath: globalMockDir });
  const openProxyModal = (id?: string) => vscode.postMessage({ type: 'openProxyPanel', id });
  const openRuleModal = (proxyId: string, ruleId?: string) => vscode.postMessage({ type: 'openRulePanel', proxyId, ruleId });
  const toggleProxy = (id: string, enabled: boolean) => vscode.postMessage({ type: 'toggleProxy', id, enabled });
  const delProxy = (id: string) => vscode.postMessage({ type: 'deleteProxy', id });
  const toggleRule = (ruleId: string, enabled: boolean) => vscode.postMessage({ type: 'toggleRule', ruleId, enabled });
  const delRule = (ruleId: string) => vscode.postMessage({ type: 'deleteRule', ruleId });

  const copyMockUrl = (url: string) => {
    vscode.postMessage({ type: 'copyText', payload: url });
    setCopiedUrl(url);
    setTimeout(() => setCopiedUrl(''), 3000);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <style>{`
        :root { --primary: var(--vscode-textLink-activeForeground); --border: var(--vscode-panel-border); --bg: var(--vscode-editor-background); --bg-hover: var(--vscode-list-hoverBackground); --text: var(--vscode-editor-foreground); --text-sub: var(--vscode-descriptionForeground); --error: var(--vscode-errorForeground); --success: #4caf50; }
        html { min-width: 298px }
        body { font-family: var(--vscode-font-family); padding: 0; margin: 0; color: var(--text); background: var(--bg); display: flex; flex-direction: column; height: 100vh; font-size: 13px; }
        .header { padding: 12px 16px; border-bottom: 1px solid var(--border); background: var(--vscode-sideBar-background); display: flex; flex-direction: column; gap: 10px; }
        .header-top { width:100%; display: flex; justify-content: space-between; align-items: center; }
        .header-title { font-weight: 600; font-size: 13px; display: flex; align-items: center; gap: 8px; }
        .server-status { font-size: 12px; padding: 4px 10px; border-radius: 20px; background: #444; color: #ccc; cursor: pointer; user-select: none; display: flex; align-items: center; gap: 6px; }
        .server-status.on { background: rgba(76, 175, 80, 0.15); color: var(--success); }
        .mock-dir-setting { width:100%; font-size: 11px; padding: 4px 8px; border-radius: 4px; border: 1px solid var(--border); cursor: pointer; display: flex; align-items: center; gap: 6px; }
        .content { flex: 1; overflow-y: auto; padding: 16px 12px; }
        .proxy-container { border: 1px solid var(--border); border-radius: 8px; margin-bottom: 20px; background: var(--bg); overflow: hidden; }
        .proxy-header { background: var(--vscode-sideBar-background); padding: 12px 14px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; }
        .port-badge { background: var(--primary); color: white; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: bold;}
        .rule-list { padding: 10px; display: flex; flex-direction: column; gap: 8px; }
        .rule-card { border: 1px solid var(--border); border-radius: 6px; padding: 10px; display: flex; align-items: center; gap: 12px; position: relative; }
        .rule-card.disabled { opacity: 0.6; filter: grayscale(0.8); }
        .rule-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
        .url-container { display: flex; align-items: center; gap: 6px; width: 100%; }
        .url-text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .copy-icon { opacity: 0; cursor: pointer; color: var(--primary); transition: opacity 0.2s; font-size: 12px; }
        .url-container:hover .copy-icon { opacity: 1; }
        .data-path { font-size: 11px; color: var(--text-sub); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 50px; }
        .tag { font-size: 10px; font-weight: bold; padding: 2px 6px; border-radius: 3px; flex-shrink: 0; }
        .tag.GET { background: rgba(52, 152, 219, 0.1); color: #3498db; }
        .tag.POST { background: rgba(46, 204, 113, 0.1); color: #2ecc71; }
        .tag.PUT { background: rgba(243, 156, 18, 0.1); color: #f39c12; }
        .tag.DELETE { background: rgba(231, 76, 60, 0.1); color: #e74c3c; }
        .icon-btn { background: transparent; border: none; color: var(--text-sub); cursor: pointer; padding: 4px 6px; }
        .switch { position: relative; display: inline-block; width: 32px; height: 18px; }
        .switch input { opacity: 0; width: 0; height: 0; }
        .slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: #555; transition: .3s; border-radius: 18px; }
        .slider:before { position: absolute; content: ""; height: 14px; width: 14px; left: 2px; bottom: 2px; background-color: white; transition: .3s; border-radius: 50%; }
        input:checked + .slider { background-color: var(--success); }
        input:checked + .slider:before { transform: translateX(14px); }
        .add-rule-btn { width: 100%; padding: 8px; border: 1px dashed var(--border); background: transparent; color: var(--text-sub); border-radius: 4px; cursor: pointer; text-align: center; }
        .footer { padding: 12px; border-top: 1px solid var(--border); background: var(--vscode-sideBar-background); }
        .btn-pri { background: var(--primary); color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; width: 100%; }
      `}</style>
      <div className="header">
        <div className="header-top">
          <div className="header-title">
            <FontAwesomeIcon icon={faServer} /> Mock 服务管理
          </div>
          <div className={`server-status ${isGlobalRunning ? 'on' : ''}`} title="点击一键开启/关闭所有端口" onClick={toggleGlobalServer}>
            <FontAwesomeIcon icon={faCircle} /> <span>{isGlobalRunning ? `运行中 (${runningProxies.length})` : '已停止'}</span>
          </div>
        </div>
        <div className="mock-dir-setting" onClick={selectGlobalMockDir} title="设置全局数据存放目录">
          <FontAwesomeIcon icon={faFolderOpen} /> <span>{globalMockDir || '未设置全局路径'}</span>
        </div>
      </div>
      <div className="content">
        {proxies.map(p => {
          const isProxyRunning = runningProxies.includes(p.id);
          const proxyMocks = mocks.filter(m => m.proxyId === p.id);
          return (
            <div key={p.id} className="proxy-container">
              <div className="proxy-header">
                <div title="当前监听端口">
                  <FontAwesomeIcon icon={faCircle} style={{ color: isProxyRunning ? 'var(--success)' : '#555', fontSize: '10px', marginRight: '6px' }} />
                  <span className="port-badge">端口: {p.port}</span>
                </div>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <label className="switch" title="启用/停用此端口">
                    <input type="checkbox" checked={!!p.enabled} onChange={(e) => toggleProxy(p.id, e.target.checked)} />
                    <span className="slider"></span>
                  </label>
                  <button className="icon-btn" onClick={() => openProxyModal(p.id)} title="配置端口">
                    <FontAwesomeIcon icon={faGear} />
                  </button>
                  <button className="icon-btn del" onClick={() => delProxy(p.id)} title="删除此服务及下属规则">
                    <FontAwesomeIcon icon={faTrash} />
                  </button>
                </div>
              </div>
              <div className="rule-list">
                {proxyMocks.map(item => {
                  const isFile = item.mode === 'file';
                  const fullUrl = `http://localhost:${p.port}${item.url.startsWith('/') ? '' : '/'}${item.url}`;
                  return (
                    <div key={item.id} className={`rule-card ${item.enabled ? 'active' : 'disabled'}`}>
                      <div className="rule-main">
                        <div className="url-container">
                          <span className={`tag ${item.method}`}>{item.method}</span>
                          {isFile && <span className="tag" style={{ background: '#8e44ad', color: '#fff', marginLeft: '4px' }} title="此接口返回本地文件">FILE</span>}
                          <strong className="url-text" title={`完整路径: ${fullUrl}`}>{item.url}</strong>
                          {copiedUrl !== fullUrl ? (
                            <FontAwesomeIcon 
                              icon={faCopy} 
                              className="copy-icon" 
                              title={`复制完整路径: ${fullUrl}`} 
                              onClick={() => copyMockUrl(fullUrl)} 
                            />
                          ) : (
                            <span style={{ color: 'var(--success)', fontSize: '11px', flexShrink: 0 }}>已复制!</span>
                          )}
                        </div>
                        <div className="data-path" title={`配置文件路径: ${isFile ? item.filePath : item.dataPath}`}>
                          <FontAwesomeIcon icon={isFile ? faFile : faFileCode} /> {isFile ? item.filePath : item.dataPath}
                        </div>
                      </div>
                      <div style={{ display: 'flex' }}>
                        <label className="switch" title="启用/停用此规则">
                          <input type="checkbox" checked={!!item.enabled} onChange={(e) => toggleRule(item.id, e.target.checked)} />
                          <span className="slider"></span>
                        </label>
                        <button className="icon-btn" onClick={() => openRuleModal(p.id, item.id)} title="编辑规则">
                          <FontAwesomeIcon icon={faPen} />
                        </button>
                        <button className="icon-btn del" onClick={() => delRule(item.id)} title="删除规则">
                          <FontAwesomeIcon icon={faTrash} />
                        </button>
                      </div>
                    </div>
                  );
                })}
                <button className="add-rule-btn" title="为此服务新增一个拦截规则" onClick={() => openRuleModal(p.id)}>
                  <FontAwesomeIcon icon={faPlus} /> 添加接口规则
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <div className="footer">
        <button onClick={() => openProxyModal()} className="btn-pri" title="新增 Mock 本地服务端口">
          <FontAwesomeIcon icon={faPlus} /> 添加 Mock 服务
        </button>
      </div>
    </div>
  );
}