import { useState, useEffect } from 'react';
import '../assets/css/MockPanel.css'; // 🌟 关键：引入 1:1 还原的 CSS 文件
import { vscode } from '../utils/vscode'; // 如果你有全局单例，请引用

export default function OldStylePanelApp() {
  const [proxyList, setProxyList] = useState<any[]>([]);
  const [mockList, setMockList] = useState<any[]>([]);
  const [mockDir, setMockDir] = useState<string>('');
  const [runningProxies, setRunningProxies] = useState<string[]>([]);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  useEffect(() => {
    // 组件加载完成后，通过握手告诉后端加载完毕
    vscode.postMessage({ type: 'webviewLoaded' });

    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      if (message.type === 'config') {
        // 🌟 100% 还原：同步原版 proxies, mocks 和 mockDir 状态
        setProxyList(message.proxy || []);
        setMockList(message.mock || []);
        setMockDir(message.mockDir || '');
      } else if (message.type === 'status') {
        setRunningProxies(message.runningProxies || []);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // 🌟 核心修改：全局运行状态计算
  const isGlobalRunning = proxyList.some(p => p.enabled);

  const handleCopyUrl = (url: string) => {
    vscode.postMessage({ type: 'copyText', payload: url });
    setCopiedUrl(url);
    // 🌟 核心修改：复制反馈延时
    setTimeout(() => setCopiedUrl(null), 3000);
  };

  return (
    // 🌟 核心修改：DOM 结构 1:1 对齐
    <div className="old-sidebar-wrapper">
      {/* 100% 还原头部区 */}
      <div className="header">
        <div className="header-top">
          <div className="header-title"><i className="fa-solid fa-server"></i> Mock 服务管理</div>
          <div 
            className={`server-status ${isGlobalRunning ? 'on' : ''}`} 
            onClick={() => vscode.postMessage({ type: 'toggleServer', value: !isGlobalRunning })}
            title="点击一键开启/关闭所有端口"
          >
            <i className="fa-solid fa-circle"></i> 
            <span>{isGlobalRunning ? `运行中 (${runningProxies.length})` : '已停止'}</span>
          </div>
        </div>
        <div className="mock-dir-setting" onClick={() => vscode.postMessage({ type: 'selectGlobalMockDir', currentPath: mockDir })} title="设置全局数据存放目录">
          <i className="fa-regular fa-folder-open"></i> 
          <span>{mockDir || '未设置全局路径'}</span>
        </div>
      </div>

      {/* 100% 还原列表内容区 */}
      <div className="content" id="proxyList">
        {proxyList.length === 0 ? (
          <div className="empty-state">暂无 Mock 服务，点击 + 号添加</div>
        ) : (
          proxyList.map(p => {
            const isProxyRunning = runningProxies.includes(p.id);
            const proxyRules = mockList.filter(m => m.proxyId === p.id);

            return (
              <div key={p.id} className="proxy-container">
                {/* 100% 还原服务 Header */}
                <div className="proxy-header">
                  <div title="当前监听端口">
                    <i className="fa-solid fa-circle" style={{ color: isProxyRunning ? 'var(--success)' : '#555', fontSize: '10px', marginRight: '6px' }}></i>
                    <span className="port-badge">端口: {p.port}</span> 
                  </div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <label className="switch" title="启用/停用此端口">
                      <input type="checkbox" checked={!!p.enabled} onChange={(e) => vscode.postMessage({ type: 'toggleProxy', id: p.id, enabled: e.target.checked })} />
                      <span className="slider"></span>
                    </label>
                    <button className="icon-btn" onClick={() => vscode.postMessage({ type: 'openProxyPanel', id: p.id })} title="配置端口"><i className="fa-solid fa-gear"></i></button>
                    <button className="icon-btn del" onClick={() => vscode.postMessage({ type: 'deleteProxy', id: p.id })} title="删除此服务及下属规则"><i className="fa-solid fa-trash"></i></button>
                  </div>
                </div>

                {/* 100% 还原规则列表 */}
                <div className="rule-list">
                  {proxyRules.length === 0 ? (
                    <div className="empty-state small">无规则</div>
                  ) : (
                    proxyRules.map(item => {
                      const isFile = item.mode === 'file';
                      const fullUrl = `http://localhost:${p.port}${item.url.startsWith('/') ? '' : '/'}${item.url}`;
                      const isCopied = copiedUrl === fullUrl;

                      return (
                        <div key={item.id} className={`rule-card ${item.enabled ? 'active' : 'disabled'}`}>
                          <div className="rule-main">
                            <div className="url-container">
                              <span className={`method-badge ${item.method.toLowerCase()}`}>{item.method}</span>
                              {isFile && <span className="tag" style={{ background: '#8e44ad', color: '#fff', marginLeft: '4px' }} title="此接口返回本地文件">FILE</span>}
                              
                              <strong className="url-text" title={`完整路径: ${fullUrl}`}>{item.url}</strong>
                              
                              {!isCopied && <i className="fa-regular fa-copy copy-icon" title={`复制完整路径: ${fullUrl}`} onClick={() => handleCopyUrl(fullUrl)}></i>}
                              {isCopied && <span className="copy-feedback">已复制!</span>}
                            </div>
                            <div className="data-path" title={`配置文件路径: ${isFile ? item.filePath : item.dataPath}`}>
                              <i className={isFile ? 'fa-regular fa-file' : 'fa-solid fa-file-code'}></i> {isFile ? item.filePath : item.dataPath}
                            </div>
                          </div>
                          
                          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                            <label className="switch" title="启用/停用此规则">
                              <input type="checkbox" checked={!!item.enabled} onChange={(e) => vscode.postMessage({ type: 'toggleRule', ruleId: item.id, enabled: e.target.checked })} />
                              <span className="slider"></span>
                            </label>
                            <button className="icon-btn" onClick={() => vscode.postMessage({ type: 'openRulePanel', proxyId: p.id, ruleId: item.id })} title="编辑规则"><i className="fa-solid fa-pen"></i></button>
                            <button className="icon-btn del" onClick={() => vscode.postMessage({ type: 'deleteRule', ruleId: item.id })} title="删除规则"><i className="fa-solid fa-trash"></i></button>
                          </div>
                        </div>
                      );
                    })
                  )}
                  <button className="add-rule-btn" title="为此服务新增一个拦截规则" onClick={() => vscode.postMessage({ type: 'openRulePanel', proxyId: p.id })}>
                    <i className="fa-solid fa-plus"></i> 添加接口规则
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 100% 还原底部按钮区 */}
      <div className="footer">
        <button onClick={() => vscode.postMessage({ type: 'openProxyPanel' })} className="btn-pri" title="新增 Mock 本地服务端口">
          <i className="fa-solid fa-plus"></i> 添加 Mock 服务
        </button>
      </div>
    </div>
  );
}