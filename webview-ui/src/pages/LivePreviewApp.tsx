import React, { useState, useEffect, useRef } from 'react';
import { vscode } from '../utils/vscode';

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faArrowLeft,
  faRotateRight,
  faGlobe,
  faXmark,
  faStar as faStarSolid,
  faArrowRight,
  faRotate,
  faArrowUpRightFromSquare,
  faEllipsis,
  faLayerGroup,
  faClockRotateLeft,
} from '@fortawesome/free-solid-svg-icons';
import { faStar as faStarRegular } from '@fortawesome/free-regular-svg-icons';
import { faVuejs, faNodeJs, faReact } from '@fortawesome/free-brands-svg-icons';

const isUrlLike = (str: string) => /^(https?:\/\/|file:\/\/)?(localhost|\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}|([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,})(:\d+)?(\/.*)?$/i.test(str);
const escapeRegExp = (string: string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export default function LivePreviewApp() {
  const [urlInput, setUrlInput] = useState('');
  const [frameUrl, setFrameUrl] = useState('');
  const [frameData, setFrameData] = useState<string>('');

  const [device, setDevice] = useState('device-responsive');
  const [isRotated, setIsRotated] = useState(false);

  const [favorites, setFavorites] = useState<any[]>([]);
  const [historyStack, setHistoryStack] = useState<{ url: string; title: string; timestamp: number }[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const isInternalNav = useRef(false);

  const [activeModal, setActiveModal] = useState<'none' | 'fav' | 'history'>('none');
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });

  const [showSuggest, setShowSuggest] = useState(false);
  const [suggestIndex, setSuggestIndex] = useState(-1);

  const imgContainerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const moreBtnRef = useRef<HTMLButtonElement>(null);
  const suggestBoxRef = useRef<HTMLDivElement>(null);

  // 🌟 修复：提升到 useEffect 之前，解决报错
  const pushHistory = (url: string, defaultTitle: string) => {
    if (isInternalNav.current) {
      isInternalNav.current = false;
      return;
    }
    setHistoryStack((prev) => {
      if (historyIdx > -1 && prev[historyIdx]?.url === url) return prev;
      const nextStack = prev.slice(0, historyIdx + 1);
      nextStack.push({ url, title: defaultTitle || url, timestamp: Date.now() });
      setHistoryIdx(nextStack.length - 1);
      return nextStack;
    });
  };

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      if (message.type === 'init') {
        if (message.device) setDevice(message.device);
        if (message.url) {
          const initUrl = message.url.trim();
          setUrlInput(initUrl);
          if (initUrl) {
            setFrameUrl(initUrl);
            pushHistory(initUrl, initUrl);
            vscode?.postMessage({ type: 'navigateScreencast', url: initUrl });
          }
        }
        vscode?.postMessage({ type: 'reqSyncFavorites' });
      } else if (message.type === 'syncFavorites') {
        setFavorites(message.favorites || []);
      } else if (message.type === 'renderFrame') {
        setFrameData(message.base64Data);
      }
    };
    window.addEventListener('message', handleMessage);

    const handleClickOutside = (e: MouseEvent) => {
      if (!moreBtnRef.current?.contains(e.target as Node)) setMenuOpen(false);
      if (!suggestBoxRef.current?.contains(e.target as Node) && !(e.target as Element).closest('.address-bar-wrapper')) setShowSuggest(false);
    };
    window.addEventListener('click', handleClickOutside);

    return () => {
      window.removeEventListener('message', handleMessage);
      window.removeEventListener('click', handleClickOutside);
    };
  }, []);

  // 响应式监听壳子大小，同步给后台渲染器
  useEffect(() => {
    if (!imgContainerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (let entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          vscode?.postMessage({ type: 'changeViewport', width: Math.round(width), height: Math.round(height) });
        }
      }
    });
    observer.observe(imgContainerRef.current);
    return () => observer.disconnect();
  }, [device, isRotated]);

  const navigateToHistory = (index: number) => {
    if (index < 0 || index >= historyStack.length) return;
    isInternalNav.current = true;
    const targetUrl = historyStack[index].url;
    setHistoryIdx(index);
    setUrlInput(targetUrl);
    setFrameUrl(targetUrl);
    vscode?.postMessage({ type: 'saveUrl', url: targetUrl });
    vscode?.postMessage({ type: 'navigateScreencast', url: targetUrl });
    setActiveModal('none');
  };

  const handleGo = (forceUrl?: string) => {
    let finalUrl = (forceUrl !== undefined ? forceUrl : urlInput).trim();
    setShowSuggest(false);
    if (!finalUrl) {
      setFrameUrl('');
      setFrameData('');
      vscode?.postMessage({ type: 'saveUrl', url: '' });
      return;
    }
    if (!isUrlLike(finalUrl)) {
      vscode?.postMessage({ type: 'searchWorkspace', query: finalUrl });
      return;
    }
    if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://') && !finalUrl.startsWith('file://')) {
      finalUrl = 'http://' + finalUrl;
    }
    setUrlInput(finalUrl);
    setFrameUrl(finalUrl);
    pushHistory(finalUrl, finalUrl);
    vscode?.postMessage({ type: 'saveUrl', url: finalUrl });
    vscode?.postMessage({ type: 'navigateScreencast', url: finalUrl });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (showSuggest && suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSuggestIndex((prev) => (prev + 1) % suggestions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSuggestIndex((prev) => (prev - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowSuggest(false);
        return;
      }
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (showSuggest && suggestIndex > -1) handleGo(suggestions[suggestIndex].url);
      else handleGo();
    }
  };

  const handleRefresh = () => {
    if (frameUrl) vscode?.postMessage({ type: 'navigateScreencast', url: frameUrl });
    setMenuOpen(false);
  };

  const handleDeviceChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newDevice = e.target.value;
    setDevice(newDevice);
    if (newDevice === 'device-responsive') setIsRotated(false);
    vscode?.postMessage({ type: 'saveDevice', device: newDevice });
  };

  const toggleFavorite = () => {
    if (!frameUrl) return;
    vscode?.postMessage({ type: 'toggleFavorite', url: frameUrl, title: frameUrl });
  };

// 交给 React Compiler 自动优化，移除手动的 useMemo
  const suggestions = (() => {
    const query = urlInput.trim().toLowerCase();
    if (!query || favorites.length === 0) return [];
    return favorites.filter(f => f.title.toLowerCase().includes(query) || f.url.toLowerCase().includes(query));
  })();

  const renderHighlighted = (text: string) => {
    const query = urlInput.trim();
    if (!query) return text;
    const parts = text.split(new RegExp(`(${escapeRegExp(query)})`, 'gi'));
    return parts.map((part, i) =>
      part.toLowerCase() === query.toLowerCase() ? (
        <span key={i} className="highlight-match">
          {part}
        </span>
      ) : (
        part
      ),
    );
  };

  const isFav = favorites.some((f) => f.url === frameUrl);

  const openContextMenu = () => {
    if (!moreBtnRef.current) return;
    const rect = moreBtnRef.current.getBoundingClientRect();
    let x = rect.left - 180;
    const y = rect.bottom + 5;
    if (x + 200 > window.innerWidth) x = window.innerWidth - 210;
    setMenuPos({ x, y });
    setMenuOpen(!menuOpen);
  };

  const getMappedCoordinates = (e: React.MouseEvent | React.WheelEvent) => {
    if (!imgRef.current) return { x: 0, y: 0 };
    const rect = imgRef.current.getBoundingClientRect();
    return { x: Math.round(e.clientX - rect.left), y: Math.round(e.clientY - rect.top) };
  };

  const onImgMouseMove = (e: React.MouseEvent) => {
    const { x, y } = getMappedCoordinates(e);
    vscode?.postMessage({ type: 'mouseMove', x, y });
  };
  const onImgMouseDown = (e: React.MouseEvent) => {
    const { x, y } = getMappedCoordinates(e);
    imgRef.current?.focus();
    vscode?.postMessage({ type: 'mouseDown', x, y });
  };
  const onImgMouseUp = (e: React.MouseEvent) => {
    const { x, y } = getMappedCoordinates(e);
    vscode?.postMessage({ type: 'mouseUp', x, y });
  };
  const onImgWheel = (e: React.WheelEvent) => vscode?.postMessage({ type: 'mouseScroll', deltaY: e.deltaY });
  const onImgKeyDown = (e: React.KeyboardEvent) => vscode?.postMessage({ type: 'keyboardType', key: e.key });

  return (
    <div className="live-preview-container">
      <style>{`
        :root {
          --bg: var(--vscode-editor-background); --fg: var(--vscode-editor-foreground);
          --border: var(--vscode-panel-border); --input-bg: var(--vscode-input-background);
          --input-fg: var(--vscode-input-foreground); --input-border: var(--vscode-input-border);
          --btn-hover: var(--vscode-toolbar-hoverBackground); --menu-bg: var(--vscode-menu-background);
          --menu-fg: var(--vscode-menu-foreground); --menu-border: var(--vscode-menu-border);
          --menu-hover-bg: var(--vscode-menu-selectionBackground); --menu-hover-fg: var(--vscode-menu-selectionForeground);
          --focus-border: var(--vscode-focusBorder);
        }
        .live-preview-container { height: 100vh; display: flex; flex-direction: column; background-color: var(--vscode-editorPane-background, #1e1e1e); color: var(--fg); user-select: none; overflow: hidden; }
        .toolbar { display: flex; padding: 6px 10px; background: var(--bg); border-bottom: 1px solid var(--border); gap: 6px; align-items: center; flex-shrink: 0; }
        .address-bar-wrapper { flex: 1; min-width: 150px; padding: 4px 8px; border: 1px solid var(--input-border); background: var(--input-bg); border-radius: 2px; display: flex; align-items: center; gap: 8px; position: relative; }
        .address-bar-wrapper:focus-within { border-color: var(--focus-border); }
        .address-bar { flex: 1; border: none; background: transparent; color: var(--input-fg); outline: none; font-family: monospace; font-size: 12px; padding: 0; min-width: 0; }
        .suggest-box { position: absolute; top: 100%; left: 0; width: 100%; margin-top: 4px; background: var(--menu-bg); border: 1px solid var(--menu-border); border-radius: 4px; box-shadow: 0 6px 16px rgba(0,0,0,0.4); z-index: 100000; flex-direction: column; max-height: 280px; overflow-y: auto; }
        .suggest-item { padding: 8px 12px; border-bottom: 1px solid var(--menu-border); cursor: pointer; display: flex; flex-direction: column; gap: 4px; }
        .suggest-item:hover, .suggest-item.selected { background: var(--menu-hover-bg); }
        .suggest-title { font-size: 13px; font-weight: 500; }
        .suggest-url { font-size: 11px; color: var(--vscode-descriptionForeground); }
        .highlight-match { color: #5dade2; font-weight: bold; }
        .action-icon { color: var(--vscode-icon-foreground); cursor: pointer; font-size: 14px; padding: 0 4px; opacity: 0.7; }
        .action-icon:hover { opacity: 1; color: var(--fg); }
        .icon-btn { background: transparent; color: var(--vscode-icon-foreground); border: none; padding: 4px 6px; border-radius: 4px; cursor: pointer; display: inline-flex; min-width: 28px; min-height: 28px; outline: none; }
        .icon-btn:hover { background: var(--btn-hover); color: var(--fg); }
        .icon-btn:disabled { opacity: 0.3; cursor: not-allowed; }
        .vscode-select { background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--input-border); padding: 4px; border-radius: 2px; outline: none; cursor: pointer; font-size: 12px; width: 125px; }
        .vscode-select:focus { border-color: var(--focus-border); }
        .divider { width: 1px; height: 18px; background: var(--border); margin: 0 2px; }
        .preview-container { flex: 1; overflow: auto; display: flex; justify-content: center; align-items: flex-start; padding: 20px; position: relative; }
        .preview-container.no-padding { padding: 0 !important; }
        #deviceWrapper { background: #fff; transition: width 0.3s ease, height 0.3s ease; box-shadow: 0 4px 16px rgba(0,0,0,0.4); border-radius: 2px; overflow: hidden; position: relative; z-index: 2; display: flex; }
        .device-responsive { width: 100%; height: 100%; box-shadow: none !important; border-radius: 0 !important; }
        .device-iphone-se { width: 375px; height: 667px; } .device-iphone-se.rotated { width: 667px; height: 375px; }
        .device-iphone-xr { width: 414px; height: 896px; } .device-iphone-xr.rotated { width: 896px; height: 414px; }
        .device-iphone-12-pro { width: 390px; height: 844px; } .device-iphone-12-pro.rotated { width: 844px; height: 390px; }
        .device-iphone-14-pro-max { width: 430px; height: 932px; } .device-iphone-14-pro-max.rotated { width: 932px; height: 430px; }
        .device-pixel-7 { width: 412px; height: 915px; } .device-pixel-7.rotated { width: 915px; height: 412px; }
        .device-galaxy-s8-plus { width: 360px; height: 740px; } .device-galaxy-s8-plus.rotated { width: 740px; height: 360px; }
        .device-ipad-mini { width: 768px; height: 1024px; } .device-ipad-mini.rotated { width: 1024px; height: 768px; }
        .welcome-page { position: absolute; top: 0; left: 0; width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; background-color: var(--bg); z-index: 1; }
        .welcome-icon { font-size: 56px; color: var(--vscode-descriptionForeground); margin-bottom: 24px; opacity: 0.5; }
        .welcome-title { font-size: 24px; font-weight: 300; margin-bottom: 12px; color: var(--fg); }
        .welcome-subtitle { font-size: 13px; color: var(--vscode-descriptionForeground); margin-bottom: 32px; text-align: center; max-width: 400px; line-height: 1.6; }
        .quick-links { display: flex; flex-direction: column; gap: 12px; width: 100%; max-width: 300px; }
        .quick-link-btn { display: flex; align-items: center; gap: 12px; padding: 10px 16px; background: rgba(255,255,255,0.05); color: var(--fg); border: 1px solid var(--border); border-radius: 4px; cursor: pointer; font-size: 13px; text-align: left; }
        .quick-link-btn:hover { background: rgba(255,255,255,0.1); border-color: var(--focus-border); }
        .context-menu { position: absolute; z-index: 9999; background: var(--menu-bg); border: 1px solid var(--menu-border); box-shadow: 0 2px 8px rgba(0,0,0,0.3); border-radius: 4px; padding: 4px 0; min-width: 180px; }
        .menu-item { padding: 6px 12px; font-size: 12px; color: var(--menu-fg); cursor: pointer; display: flex; align-items: center; gap: 8px; }
        .menu-item:hover { background: var(--menu-hover-bg); color: var(--menu-hover-fg); }
        .fav-overlay { position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); z-index: 100000; display: flex; justify-content: center; align-items: center; }
        .fav-modal { background: var(--bg); width: 440px; max-height: 80vh; display: flex; flex-direction: column; border: 1px solid var(--border); border-radius: 6px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
        .fav-header { padding: 12px 16px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; }
        .fav-header h3 { margin: 0; font-size: 14px; font-weight: bold; display: flex; align-items: center; gap: 8px; }
        .fav-close { cursor: pointer; color: var(--vscode-icon-foreground); } .fav-close:hover { color: #e74c3c; }
        .fav-list { flex: 1; overflow-y: auto; padding: 6px 0; }
        .fav-item { padding: 10px 16px; border-bottom: 1px solid var(--vscode-panel-border); display: flex; justify-content: space-between; align-items: center; cursor: pointer; gap: 12px; }
        .fav-item:hover { background: var(--menu-hover-bg); }
        .fav-title { font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .fav-url { font-size: 11px; color: var(--vscode-descriptionForeground); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      `}</style>

      <div className="toolbar">
        <button className="icon-btn" disabled={historyIdx <= 0} onClick={() => navigateToHistory(historyIdx - 1)} title="后退">
          <FontAwesomeIcon icon={faArrowLeft} />
        </button>
        <button className="icon-btn" onClick={handleRefresh} title="刷新页面">
          <FontAwesomeIcon icon={faRotateRight} />
        </button>

        <div className="address-bar-wrapper">
          <FontAwesomeIcon icon={faGlobe} style={{ fontSize: 13, color: 'var(--vscode-descriptionForeground)' }} />
          <input
            type="text"
            className="address-bar"
            value={urlInput}
            onChange={(e) => {
              setUrlInput(e.target.value);
              setShowSuggest(true);
              setSuggestIndex(-1);
            }}
            onKeyDown={handleKeyDown}
            onFocus={() => {
              if (urlInput.trim()) setShowSuggest(true);
            }}
            placeholder="输入网址回车，或输入文本进行全局搜索"
            spellCheck="false"
            autoComplete="off"
          />
          {urlInput && (
            <FontAwesomeIcon
              icon={faXmark}
              className="action-icon"
              onClick={() => {
                setUrlInput('');
                setShowSuggest(false);
              }}
              title="清除"
            />
          )}
          <FontAwesomeIcon icon={isFav ? faStarSolid : faStarRegular} className="action-icon" style={{ color: isFav ? '#f1c40f' : '' }} onClick={toggleFavorite} title="添加/取消收藏" />
          {showSuggest && suggestions.length > 0 && (
            <div className="suggest-box" ref={suggestBoxRef} style={{ display: 'flex' }}>
              {suggestions.map((item, index) => (
                <div key={index} className={`suggest-item ${index === suggestIndex ? 'selected' : ''}`} onMouseEnter={() => setSuggestIndex(index)} onClick={() => handleGo(item.url)}>
                  <div className="suggest-title">{renderHighlighted(item.title)}</div>
                  <div className="suggest-url">{renderHighlighted(item.url)}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <button className="icon-btn" onClick={() => handleGo()} title="访问 / 搜索">
          <FontAwesomeIcon icon={faArrowRight} />
        </button>

        <div className="divider"></div>

        <select className="vscode-select" value={device} onChange={handleDeviceChange} title="选择预览设备">
          <optgroup label="响应式">
            <option value="device-responsive">响应式铺满</option>
          </optgroup>
          <optgroup label="Apple">
            <option value="device-iphone-se">iPhone SE</option>
            <option value="device-iphone-xr">iPhone XR</option>
            <option value="device-iphone-12-pro">iPhone 12 Pro</option>
            <option value="device-iphone-14-pro-max">iPhone 14 Pro Max</option>
          </optgroup>
          <optgroup label="Android">
            <option value="device-pixel-7">Pixel 7</option>
            <option value="device-galaxy-s8-plus">Galaxy S8+</option>
          </optgroup>
          <optgroup label="平板电脑">
            <option value="device-ipad-mini">iPad Mini</option>
          </optgroup>
        </select>

        <button className="icon-btn" disabled={device === 'device-responsive'} onClick={() => setIsRotated(!isRotated)} style={{ color: isRotated ? '#3498db' : '' }} title="横屏/竖屏切换">
          <FontAwesomeIcon icon={faRotate} />
        </button>

        <div className="divider"></div>
        <button className="icon-btn" disabled={!urlInput.trim()} onClick={() => vscode?.postMessage({ type: 'openExternalBrowser', url: frameUrl || urlInput })} title="在外部默认浏览器中打开">
          <FontAwesomeIcon icon={faArrowUpRightFromSquare} />
        </button>
        <button className="icon-btn" ref={moreBtnRef} onClick={openContextMenu} title="更多操作">
          <FontAwesomeIcon icon={faEllipsis} />
        </button>
      </div>

      {menuOpen && (
        <div className="context-menu" style={{ left: menuPos.x, top: menuPos.y, display: 'block' }}>
          <div
            className="menu-item"
            onClick={() => {
              setActiveModal('fav');
              setMenuOpen(false);
            }}
          >
            <FontAwesomeIcon icon={faStarSolid} style={{ width: 16, color: '#f1c40f' }} /> 打开收藏夹
          </div>
          <div
            className="menu-item"
            onClick={() => {
              setActiveModal('history');
              setMenuOpen(false);
            }}
          >
            <FontAwesomeIcon icon={faClockRotateLeft} style={{ width: 16 }} /> 历史记录
          </div>
        </div>
      )}

      <div className={`preview-container ${device === 'device-responsive' ? 'no-padding' : ''}`}>
        {!frameUrl ? (
          <div className="welcome-page">
            <FontAwesomeIcon icon={faLayerGroup} className="welcome-icon" />
            <h1 className="welcome-title">Live Preview</h1>
            <p className="welcome-subtitle">输入本地开发服务器地址以原生内核无界渲染。输入纯文本可直接全局搜索。</p>
            <div className="quick-links">
              <button className="quick-link-btn" onClick={() => handleGo('localhost:5173')}>
                <FontAwesomeIcon icon={faVuejs} style={{ color: '#42b883' }} /> Vite 默认端口 (5173)
              </button>
              <button className="quick-link-btn" onClick={() => handleGo('localhost:8080')}>
                <FontAwesomeIcon icon={faNodeJs} style={{ color: '#8cc84b' }} /> Vue CLI (8080)
              </button>
              <button className="quick-link-btn" onClick={() => handleGo('localhost:3000')}>
                <FontAwesomeIcon icon={faReact} style={{ color: '#61dafb' }} /> React / Next.js (3000)
              </button>
            </div>
          </div>
        ) : (
          <div id="deviceWrapper" ref={imgContainerRef} className={`${device} ${isRotated ? 'rotated' : ''}`}>
            <img
              ref={imgRef}
              src={frameData ? `data:image/jpeg;base64,${frameData}` : undefined}
              draggable={false}
              onMouseDown={onImgMouseDown}
              onMouseUp={onImgMouseUp}
              onMouseMove={onImgMouseMove}
              onWheel={onImgWheel}
              onKeyDown={onImgKeyDown}
              tabIndex={0}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'fill',
                cursor: 'crosshair',
                outline: 'none',
                display: frameData ? 'block' : 'none',
              }}
            />
            {!frameData && <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999' }}>引擎加载中...</div>}
          </div>
        )}
      </div>

      {activeModal === 'history' && (
        <div className="fav-overlay" onClick={() => setActiveModal('none')}>
          <div className="fav-modal" onClick={(e) => e.stopPropagation()}>
            <div className="fav-header">
              <h3>
                <FontAwesomeIcon icon={faClockRotateLeft} style={{ color: '#3498db' }} /> 历史记录
              </h3>
              <FontAwesomeIcon icon={faXmark} className="fav-close" onClick={() => setActiveModal('none')} />
            </div>
            <div className="fav-list">
              {[...historyStack].reverse().map((entry, index) => (
                <div key={index} className="fav-item" onClick={() => navigateToHistory(historyStack.length - 1 - index)}>
                  <div>
                    <div className="fav-title">{entry.title}</div>
                    <div className="fav-url">{entry.url}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {activeModal === 'fav' && (
        <div className="fav-overlay" onClick={() => setActiveModal('none')}>
          <div className="fav-modal" onClick={(e) => e.stopPropagation()}>
            <div className="fav-header">
              <h3>
                <FontAwesomeIcon icon={faStarSolid} style={{ color: '#f1c40f' }} /> 我的收藏夹
              </h3>
              <FontAwesomeIcon icon={faXmark} className="fav-close" onClick={() => setActiveModal('none')} />
            </div>
            <div className="fav-list">
              {favorites.map((f, i) => (
                <div
                  key={i}
                  className="fav-item"
                  onClick={() => {
                    handleGo(f.url);
                    setActiveModal('none');
                  }}
                >
                  <div>
                    <div className="fav-title">{f.title}</div>
                    <div className="fav-url">{f.url}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
