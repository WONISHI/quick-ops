import React, { useState, useEffect, useRef } from 'react';
import '../assets/css/LivePreviewApp.css'; // 我们稍后把 CSS 抽离出来

const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;

export default function LivePreviewApp() {
  const [urlInput, setUrlInput] = useState('');
  const [frameUrl, setFrameUrl] = useState('');
  const [device, setDevice] = useState('device-responsive');
  const [isRotated, setIsRotated] = useState(false);
  const [favorites, setFavorites] = useState<any[]>([]);
  
  // 弹窗与菜单状态
  const [showFavModal, setShowFavModal] = useState(false);
  const [showMenu, setShowMenu] = useState(false);

  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      if (message.type === 'init') {
        if (message.device) setDevice(message.device);
        if (message.url) {
          setUrlInput(message.url);
          setFrameUrl(message.url);
        }
        vscode?.postMessage({ type: 'reqSyncFavorites' });
      } else if (message.type === 'syncFavorites') {
        setFavorites(message.favorites || []);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleGo = () => {
    let finalUrl = urlInput.trim();
    if (!finalUrl) {
      setFrameUrl('');
      return;
    }
    if (!/^https?:\/\//i.test(finalUrl) && !finalUrl.startsWith('localhost') && finalUrl.includes('.')) {
      finalUrl = 'http://' + finalUrl;
    } else if (!finalUrl.includes('.') && !finalUrl.startsWith('localhost')) {
      finalUrl = 'https://www.bing.com/search?q=' + encodeURIComponent(finalUrl);
    }
    setUrlInput(finalUrl);
    setFrameUrl(finalUrl);
    vscode?.postMessage({ type: 'saveUrl', url: finalUrl });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleGo();
  };

  const toggleFavorite = () => {
    if (!frameUrl) return;
    vscode?.postMessage({ type: 'toggleFavorite', url: frameUrl, title: frameUrl });
  };

  const handleRefresh = () => {
    if (!frameUrl) return;
    const temp = frameUrl;
    setFrameUrl('about:blank');
    setTimeout(() => setFrameUrl(temp), 50);
  };

  const handleDeviceChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newDevice = e.target.value;
    setDevice(newDevice);
    if (newDevice === 'device-responsive') setIsRotated(false);
    vscode?.postMessage({ type: 'saveDevice', device: newDevice });
  };

  const isFav = favorites.some(f => f.url === frameUrl);

  return (
    <div className="live-preview-container" onClick={() => setShowMenu(false)}>
      {/* 顶部工具栏 */}
      <div className="toolbar">
        <button className="icon-btn" onClick={handleRefresh} title="刷新页面">
          <i className="fa-solid fa-rotate-right"></i>
        </button>
        
        <div className="address-bar-wrapper">
          <i className="fa-solid fa-globe" style={{ color: 'var(--vscode-descriptionForeground)' }}></i>
          <input 
            type="text" 
            className="address-bar" 
            value={urlInput} 
            onChange={e => setUrlInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入网址 或 搜索内容" 
          />
          {urlInput && (
            <i className="fa-solid fa-xmark action-icon" onClick={() => setUrlInput('')}></i>
          )}
          <i 
            className={`fa-${isFav ? 'solid' : 'regular'} fa-star action-icon`} 
            style={{ color: isFav ? '#f1c40f' : '' }}
            onClick={toggleFavorite} 
            title="收藏"
          ></i>
        </div>

        <button className="icon-btn" onClick={handleGo}><i className="fa-solid fa-arrow-right"></i></button>
        <div className="divider"></div>

        <select className="vscode-select" value={device} onChange={handleDeviceChange}>
          <option value="device-responsive">响应式铺满</option>
          <option value="device-iphone-14-pro-max">iPhone 14 Pro Max</option>
          <option value="device-ipad-pro">iPad Pro</option>
          {/* ...可自行补充设备选项... */}
        </select>

        <button 
          className="icon-btn" 
          disabled={device === 'device-responsive'} 
          onClick={() => setIsRotated(!isRotated)}
          style={{ color: isRotated ? '#3498db' : '' }}
        >
          <i className="fa-solid fa-rotate"></i>
        </button>

        <div className="divider"></div>
        <button className="icon-btn" onClick={() => setShowFavModal(true)} title="收藏夹">
          <i className="fa-solid fa-star"></i>
        </button>
      </div>

      {/* 预览区域 */}
      <div className={`preview-container ${device === 'device-responsive' ? 'no-padding' : ''}`}>
        {!frameUrl ? (
          <div className="welcome-page">
            <i className="fa-solid fa-layer-group welcome-icon" style={{ fontSize: 56, opacity: 0.5 }}></i>
            <h2>Live Preview</h2>
            <p>在上方输入地址开始预览。例如：<code>localhost:5173</code></p>
          </div>
        ) : (
          <div id="deviceWrapper" className={`${device} ${isRotated ? 'rotated' : ''}`}>
            <iframe ref={iframeRef} src={frameUrl} title="preview" sandbox="allow-scripts allow-same-origin allow-forms"></iframe>
          </div>
        )}
      </div>

      {/* 收藏夹弹窗 */}
      {showFavModal && (
        <div className="fav-overlay" onClick={() => setShowFavModal(false)}>
          <div className="fav-modal" onClick={e => e.stopPropagation()}>
            <div className="fav-header">
              <h3>我的收藏</h3>
              <i className="fa-solid fa-xmark fav-close" onClick={() => setShowFavModal(false)}></i>
            </div>
            <div className="fav-list">
              {favorites.map((f, i) => (
                <div key={i} className="fav-item" onClick={() => { setUrlInput(f.url); setFrameUrl(f.url); setShowFavModal(false); }}>
                  <div className="fav-title">{f.title}</div>
                  <div className="fav-url">{f.url}</div>
                </div>
              ))}
              {favorites.length === 0 && <div style={{ padding: 20, textAlign: 'center' }}>暂无收藏</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}