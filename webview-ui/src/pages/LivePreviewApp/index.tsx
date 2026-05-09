import React, { useState, useEffect, useRef, useMemo } from 'react';
import { vscode } from '../../utils/vscode';
import { isUrlLike, escapeRegExp } from "../../utils"
import styles from './index.module.css';

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faArrowLeft, faRotateRight, faGlobe, faXmark, faStar as faStarSolid,
  faArrowRight, faRotate, faArrowUpRightFromSquare, faEllipsis,
  faLayerGroup, faPlus, faClockRotateLeft, faBroom, faChevronRight,
  faDatabase, faBoxArchive, faCookieBite, faTerminal, faBug, faPen,
  faTrash, faCheck
} from '@fortawesome/free-solid-svg-icons';
import { faStar as faStarRegular, faCopy as faCopyRegular } from '@fortawesome/free-regular-svg-icons';
import { faVuejs, faNodeJs, faReact } from '@fortawesome/free-brands-svg-icons';

export default function LivePreviewApp() {
  const [urlInput, setUrlInput] = useState('');
  const [frameUrl, setFrameUrl] = useState('');
  const [device, setDevice] = useState('device-responsive');
  const [isRotated, setIsRotated] = useState(false);
  const [faviconUrl, setFaviconUrl] = useState('');
  const [faviconError, setFaviconError] = useState(false);
  const [favorites, setFavorites] = useState<any[]>([]);
  const [historyStack, setHistoryStack] = useState<{ url: string, title: string, timestamp: number }[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const isInternalNav = useRef(false);
  const [activeModal, setActiveModal] = useState<'none' | 'fav' | 'history'>('none');
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });
  const [cacheSubmenuOpen, setCacheSubmenuOpen] = useState(false);
  const [favSort, setFavSort] = useState<'time' | 'title'>('time');
  const [favForm, setFavForm] = useState({ visible: false, title: '', url: '', editingOriginalUrl: '' });
  const [showSuggest, setShowSuggest] = useState(false);
  const [suggestIndex, setSuggestIndex] = useState(-1);
  const [copiedUrl, setCopiedUrl] = useState('');

  const objectRef = useRef<HTMLObjectElement>(null);
  const moreBtnRef = useRef<HTMLButtonElement>(null);
  const suggestBoxRef = useRef<HTMLDivElement>(null);
  const cacheMenuTimer = useRef<any>(null);

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
            updateFavicon(initUrl);
          }
        }
        vscode?.postMessage({ type: 'reqSyncFavorites' });
      } else if (message.type === 'syncFavorites') {
        setFavorites(message.favorites || []);
      }
    };
    window.addEventListener('message', handleMessage);

    const handleClickOutside = (e: MouseEvent) => {
      if (!moreBtnRef.current?.contains(e.target as Node)) {
        setMenuOpen(false);
        setCacheSubmenuOpen(false);
      }
      if (!suggestBoxRef.current?.contains(e.target as Node) && !(e.target as Element).closest(`.${styles['address-bar-wrapper']}`)) {
        setShowSuggest(false);
      }
    };
    window.addEventListener('click', handleClickOutside);

    return () => {
      window.removeEventListener('message', handleMessage);
      window.removeEventListener('click', handleClickOutside);
    };
  }, []);

  // 🌟 修改点 2：适配 Object 元素的加载事件
  const handleObjectLoad = () => {
    if (!objectRef.current || historyIdx < 0) return;
    try {
      const doc = objectRef.current.contentDocument || objectRef.current.contentWindow?.document;
      if (doc && doc.title) {
        setHistoryStack(prev => {
          const next = [...prev];
          if (next[historyIdx]) next[historyIdx].title = doc.title;
          return next;
        });
      }
    } catch (e) {
      console.log('e', e);
    }
  };

  const pushHistory = (url: string, defaultTitle: string) => {
    if (isInternalNav.current) {
      isInternalNav.current = false;
      return;
    }
    setHistoryStack(prev => {
      if (historyIdx > -1 && prev[historyIdx]?.url === url) return prev;
      const nextStack = prev.slice(0, historyIdx + 1);
      nextStack.push({ url, title: defaultTitle || url, timestamp: Date.now() });
      setHistoryIdx(nextStack.length - 1);
      return nextStack;
    });
  };

  const navigateToHistory = (index: number) => {
    if (index < 0 || index >= historyStack.length) return;
    isInternalNav.current = true;
    const targetUrl = historyStack[index].url;
    setHistoryIdx(index);
    setUrlInput(targetUrl);
    setFrameUrl(targetUrl);
    updateFavicon(targetUrl);
    vscode?.postMessage({ type: 'saveUrl', url: targetUrl });
    setActiveModal('none');
  };

  const updateFavicon = (urlStr: string) => {
    try {
      const urlObj = new URL(urlStr);
      setFaviconUrl(`${urlObj.origin}/favicon.ico`);
      setFaviconError(false);
    } catch {
      setFaviconError(true);
    }
  };

  const handleGo = (forceUrl?: string) => {
    let finalUrl = (forceUrl !== undefined ? forceUrl : urlInput).trim();
    setShowSuggest(false);
    if (!finalUrl) {
      setFrameUrl('');
      updateFavicon('');
      vscode?.postMessage({ type: 'saveUrl', url: '' });
      return;
    }
    if (isUrlLike(finalUrl)) {
      if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://') && !finalUrl.startsWith('file://')) {
        finalUrl = 'http://' + finalUrl;
      }
    } else {
      finalUrl = 'https://www.bing.com/search?q=' + encodeURIComponent(finalUrl);
    }
    setUrlInput(finalUrl);
    setFrameUrl(finalUrl);
    updateFavicon(finalUrl);
    pushHistory(finalUrl, finalUrl);
    vscode?.postMessage({ type: 'saveUrl', url: finalUrl });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;

    if (showSuggest && suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSuggestIndex((prev) => (prev + 1) % suggestions.length);
        return;
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSuggestIndex((prev) => (prev - 1 + suggestions.length) % suggestions.length);
        return;
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setShowSuggest(false);
        return;
      }
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      if (showSuggest && suggestIndex > -1) {
        handleGo(suggestions[suggestIndex].url);
      } else {
        handleGo();
      }
    }
  };

  const handleRefresh = () => {
    if (!frameUrl) return;
    const temp = frameUrl;
    setFrameUrl('about:blank');
    setTimeout(() => setFrameUrl(temp), 50);
    setMenuOpen(false);
  };

  const handleDeviceChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newDevice = e.target.value;
    setDevice(newDevice);
    if (newDevice === 'device-responsive') {
      setIsRotated(false);
    }
    vscode?.postMessage({ type: 'saveDevice', device: newDevice });
  };

  // 🌟 修改点 3：适配 Object 的 contentDocument 获取
  const toggleFavorite = () => {
    if (!frameUrl) return;
    let title = frameUrl;
    try { title = objectRef.current?.contentDocument?.title || urlInput; } catch (e) {
      console.log('e', e);
    }
    vscode?.postMessage({ type: 'toggleFavorite', url: frameUrl, title });
  };

  const suggestions = useMemo(() => {
    const query = urlInput.trim().toLowerCase();
    if (!query || favorites.length === 0) return [];
    return favorites.filter(f => f.title.toLowerCase().includes(query) || f.url.toLowerCase().includes(query));
  }, [urlInput, favorites]);

  const renderHighlighted = (text: string) => {
    const query = urlInput.trim();
    if (!query) return text;
    const parts = text.split(new RegExp(`(${escapeRegExp(query)})`, 'gi'));
    return parts.map((part, i) =>
      part.toLowerCase() === query.toLowerCase() ? <span key={i} className={styles['highlight-match']}>{part}</span> : part
    );
  };

  const isFav = favorites.some(f => f.url === frameUrl);

  const openContextMenu = () => {
    if (!moreBtnRef.current) return;
    const rect = moreBtnRef.current.getBoundingClientRect();
    let x = rect.left - 180;
    const y = rect.bottom + 5;
    if (x + 200 > window.innerWidth) x = window.innerWidth - 210;
    setMenuPos({ x, y });
    setMenuOpen(!menuOpen);
  };

  // 🌟 修改点 4：适配 Object 的 Window 获取
  const handleCacheClear = (type: 'local' | 'session' | 'cookie') => {
    try {
      const win = objectRef.current?.contentWindow;
      if (!win) throw new Error("No Access");
      if (type === 'local') win.localStorage.clear();
      else if (type === 'session') win.sessionStorage.clear();
      else if (type === 'cookie') {
        const cookies = win.document.cookie.split(";");
        for (let i = 0; i < cookies.length; i++) {
          const cookie = cookies[i];
          const eqPos = cookie.indexOf("=");
          const name = eqPos > -1 ? cookie.substring(0, eqPos) : cookie;
          win.document.cookie = name + "=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/";
        }
      }
      vscode?.postMessage({ type: 'showInfo', message: '✅ 缓存清理成功！' });
      handleRefresh();
    } catch (e) {
      console.log('e', e);
      vscode?.postMessage({ type: 'showWarning', message: '⚠️ 跨域安全限制，请在开发者工具中手动清理。' });
    }
    setMenuOpen(false);
  };

  // 🌟 修改点 5：适配 Object 的 Document 获取
  const handleInjectVConsole = () => {
    try {
      const frameDoc = objectRef.current?.contentDocument || objectRef.current?.contentWindow?.document;
      if (!frameDoc) throw new Error("No Access");
      if (frameDoc.getElementById('vconsole-script-injected')) {
        vscode?.postMessage({ type: 'showInfo', message: 'vConsole 已经注入，请查看页面右下角！' });
      } else {
        const script = frameDoc.createElement('script');
        script.id = 'vconsole-script-injected';
        script.src = 'https://unpkg.com/vconsole@latest/dist/vconsole.min.js';
        script.onload = () => {
          const initScript = frameDoc.createElement('script');
          initScript.innerHTML = 'window.__vconsole = new window.VConsole();';
          frameDoc.body.appendChild(initScript);
          vscode?.postMessage({ type: 'showInfo', message: '🚀 vConsole 注入成功！' });
        };
        frameDoc.head.appendChild(script);
      }
    } catch (e) {
      console.log('e', e);
      vscode?.postMessage({ type: 'vConsoleFallback' });
    }
    setMenuOpen(false);
  };

  const handleCopy = (url: string) => {
    if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url);
    } else {
      const input = document.createElement('input');
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
    }
    setCopiedUrl(url);
    setTimeout(() => setCopiedUrl(''), 1500);
  };

  const saveFavorite = () => {
    const t = favForm.title.trim();
    let u = favForm.url.trim();
    if (!t || !u) return vscode?.postMessage({ type: 'showError', message: '标题和链接不能为空' });
    if (!isUrlLike(u)) return vscode?.postMessage({ type: 'showError', message: '请输入有效的网址格式' });
    if (!u.startsWith('http://') && !u.startsWith('https://') && !u.startsWith('file://')) u = 'http://' + u;

    let newFavs = [...favorites];
    if (favForm.editingOriginalUrl) {
      const index = newFavs.findIndex(f => f.url === favForm.editingOriginalUrl);
      if (index > -1) {
        if (u !== favForm.editingOriginalUrl && newFavs.some(f => f.url === u)) {
          return vscode?.postMessage({ type: 'showError', message: '该链接已存在！' });
        }
        newFavs[index].title = t;
        newFavs[index].url = u;
      }
    } else {
      if (newFavs.some(f => f.url === u)) return vscode?.postMessage({ type: 'showError', message: '该链接已存在！' });
      newFavs.push({ url: u, title: t, timestamp: Date.now() });
    }
    vscode?.postMessage({ type: 'saveAllFavorites', favorites: newFavs });
    setFavForm({ visible: false, title: '', url: '', editingOriginalUrl: '' });
  };

  const deleteFavorite = (url: string) => {
    const newFavs = favorites.filter(f => f.url !== url);
    vscode?.postMessage({ type: 'saveAllFavorites', favorites: newFavs });
  };

  const sortedFavorites = useMemo(() => {
    const list = [...favorites];
    if (favSort === 'time') return list.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    return list.sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'));
  }, [favorites, favSort]);

  return (
    <div className={styles['live-preview-container']}>
      {/* 顶部工具栏 */}
      <div className={styles['toolbar']}>
        <button className={styles['icon-btn']} disabled={historyIdx <= 0} onClick={() => navigateToHistory(historyIdx - 1)} title="后退">
          <FontAwesomeIcon icon={faArrowLeft} />
        </button>
        <button className={styles['icon-btn']} onClick={handleRefresh} title="刷新页面">
          <FontAwesomeIcon icon={faRotateRight} />
        </button>

        <div className={styles['address-bar-wrapper']}>
          {faviconUrl && !faviconError && urlInput.trim() ? (
            <img src={faviconUrl} onError={() => setFaviconError(true)} className={styles['favicon-img']} />
          ) : (
            <FontAwesomeIcon icon={faGlobe} className={styles['globe-icon']} />
          )}

          <input
            type="text"
            className={styles['address-bar']}
            value={urlInput}
            onChange={e => {
              setUrlInput(e.target.value);
              setShowSuggest(true);
              setSuggestIndex(-1);
            }}
            onKeyDown={handleKeyDown}
            onFocus={() => { if (urlInput.trim()) setShowSuggest(true); }}
            placeholder="输入网址 或 搜索内容"
            spellCheck="false"
            autoComplete="off"
          />

          {urlInput && (
            <FontAwesomeIcon
              icon={faXmark}
              className={styles['action-icon']}
              onClick={() => { setUrlInput(''); setShowSuggest(false); }}
              title="清除"
            />
          )}
          <FontAwesomeIcon
            icon={isFav ? faStarSolid : faStarRegular}
            className={`${styles['action-icon']} ${isFav ? styles['fav-active'] : ''}`}
            onClick={toggleFavorite}
            title="添加/取消收藏 (跨工作区同步)"
          />

          {/* 智能提示框 */}
          {showSuggest && suggestions.length > 0 && (
            <div className={styles['suggest-box']} ref={suggestBoxRef}>
              {suggestions.map((item, index) => (
                <div
                  key={index}
                  className={`${styles['suggest-item']} ${index === suggestIndex ? styles['selected'] : ''}`}
                  onMouseEnter={() => setSuggestIndex(index)}
                  onClick={() => {
                    handleGo(item.url);
                  }}
                >
                  <div className={styles['suggest-title']}>{renderHighlighted(item.title)}</div>
                  <div className={styles['suggest-url']}>{renderHighlighted(item.url)}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <button className={styles['icon-btn']} onClick={() => handleGo()} title="访问 / 搜索">
          <FontAwesomeIcon icon={faArrowRight} />
        </button>

        <div className={styles['divider']}></div>

        <select className={styles['vscode-select']} value={device} onChange={handleDeviceChange} title="选择预览设备">
          <optgroup label="响应式">
            <option value="device-responsive">响应式铺满</option>
          </optgroup>
          <optgroup label="Apple">
            <option value="device-iphone-se">iPhone SE</option>
            <option value="device-iphone-xr">iPhone XR</option>
            <option value="device-iphone-12-pro">iPhone 12 Pro</option>
            <option value="device-iphone-14-pro-max">iPhone 14 Pro</option>
          </optgroup>
          <optgroup label="Android">
            <option value="device-pixel-7">Pixel 7</option>
            <option value="device-galaxy-s8-plus">Galaxy S8+</option>
            <option value="device-galaxy-s20-ultra">Galaxy S20</option>
          </optgroup>
          <optgroup label="平板电脑">
            <option value="device-ipad-mini">iPad Mini</option>
            <option value="device-ipad-air">iPad Air</option>
            <option value="device-ipad-pro">iPad Pro</option>
            <option value="device-surface-pro-7">Surface Pro</option>
          </optgroup>
        </select>

        <button
          className={`${styles['icon-btn']} ${isRotated ? styles['active-blue'] : ''}`}
          disabled={device === 'device-responsive'}
          onClick={() => setIsRotated(!isRotated)}
          title="横屏/竖屏切换"
        >
          <FontAwesomeIcon icon={faRotate} />
        </button>

        <div className={styles['divider']}></div>
        <button className={styles['icon-btn']} disabled={!urlInput.trim()} onClick={() => vscode?.postMessage({ type: 'openExternalBrowser', url: frameUrl || urlInput })} title="在外部默认浏览器中打开">
          <FontAwesomeIcon icon={faArrowUpRightFromSquare} />
        </button>
        <button className={styles['icon-btn']} ref={moreBtnRef} onClick={openContextMenu} title="更多操作">
          <FontAwesomeIcon icon={faEllipsis} />
        </button>
      </div>

      {/* 更多菜单 (Context Menu) */}
      {menuOpen && (
        <div className={styles['context-menu']} style={{ left: menuPos.x, top: menuPos.y }}>
          <div className={styles['menu-item']} onClick={() => { handleRefresh(); setMenuOpen(false); }}>
            <FontAwesomeIcon icon={faRotateRight} className={styles['menu-icon']} /> 刷新页面
          </div>
          <div className={styles['menu-item']} onClick={() => { setActiveModal('fav'); setMenuOpen(false); }}>
            <FontAwesomeIcon icon={faStarSolid} className={`${styles['menu-icon']} ${styles['fav-star']}`} /> 打开收藏夹
          </div>
          <div className={styles['menu-item']} onClick={() => { setActiveModal('history'); setMenuOpen(false); }}>
            <FontAwesomeIcon icon={faClockRotateLeft} className={styles['menu-icon']} /> 历史记录
          </div>

          <div className={styles['menu-divider']}></div>
          <div
            className={`${styles['menu-item']} ${styles['has-submenu']}`}
            onMouseEnter={() => { clearTimeout(cacheMenuTimer.current); setCacheSubmenuOpen(true); }}
            onMouseLeave={() => { cacheMenuTimer.current = setTimeout(() => setCacheSubmenuOpen(false), 300); }}
          >
            <FontAwesomeIcon icon={faBroom} className={styles['menu-icon']} /> 清理页面缓存
            <FontAwesomeIcon icon={faChevronRight} className={styles['menu-chevron']} />
            {cacheSubmenuOpen && (
              <div className={styles['submenu']}>
                <div className={styles['menu-item']} onClick={() => handleCacheClear('local')}><FontAwesomeIcon icon={faDatabase} className={styles['menu-icon']} /> 清理 LocalStorage</div>
                <div className={styles['menu-item']} onClick={() => handleCacheClear('session')}><FontAwesomeIcon icon={faBoxArchive} className={styles['menu-icon']} /> 清理 SessionStorage</div>
                <div className={styles['menu-item']} onClick={() => handleCacheClear('cookie')}><FontAwesomeIcon icon={faCookieBite} className={styles['menu-icon']} /> 清理 Cookie 数据</div>
              </div>
            )}
          </div>

          <div className={styles['menu-divider']}></div>
          <div className={styles['menu-item']} onClick={() => { vscode?.postMessage({ type: 'openDevTools' }); setMenuOpen(false); }}>
            <FontAwesomeIcon icon={faTerminal} className={styles['menu-icon']} /> 开发者工具
          </div>
          <div className={`${styles['menu-item']} ${styles['menu-item-vconsole']}`} onClick={handleInjectVConsole}>
            <FontAwesomeIcon icon={faBug} className={styles['menu-icon']} /> 注入 vConsole
          </div>
        </div>
      )}

      {/* 预览区域 */}
      <div className={`${styles['preview-container']} ${device === 'device-responsive' ? styles['no-padding'] : ''}`}>
        {!frameUrl ? (
          <div className={styles['welcome-page']}>
            <FontAwesomeIcon icon={faLayerGroup} className={styles['welcome-icon']} />
            <h1 className={styles['welcome-title']}>Live Preview</h1>
            <p className={styles['welcome-subtitle']}>在上方地址栏输入您的本地开发服务器地址，或直接输入关键词进行搜索。<br />您也可以点击下方快捷选项快速填入：</p>

            <div className={styles['quick-links']}>
              <button className={styles['quick-link-btn']} onClick={() => handleGo('localhost:5173')}>
                <FontAwesomeIcon icon={faVuejs} className={styles['brand-icon-vue']} /> <span>Vite 默认端口 (5173)</span>
              </button>
              <button className={styles['quick-link-btn']} onClick={() => handleGo('localhost:8080')}>
                <FontAwesomeIcon icon={faNodeJs} className={styles['brand-icon-node']} /> <span>Vue CLI / Webpack (8080)</span>
              </button>
              <button className={styles['quick-link-btn']} onClick={() => handleGo('localhost:3000')}>
                <FontAwesomeIcon icon={faReact} className={styles['brand-icon-react']} /> <span>React / Next.js (3000)</span>
              </button>
            </div>
          </div>
        ) : (
          <div id="deviceWrapper" className={`${styles[device] || device} ${isRotated ? styles['rotated'] : ''}`}>
            {/* 🌟 修改点 6：替换 iframe 为 object */}
            <object
              ref={objectRef}
              data={frameUrl}
              type="text/html"
              onLoad={handleObjectLoad}
              className={styles['fromPage']}
              title="preview"
            >
              {/* 如果内容无法加载，会回退显示这段文字 */}
              <div style={{ padding: 20, textAlign: 'center' }}>无法加载预览，可能由于跨域或网页安全策略限制。</div>
            </object>
          </div>
        )}
      </div>

      {/* 收藏夹弹窗 */}
      {activeModal === 'fav' && (
        <div className={styles['fav-overlay']} onClick={() => setActiveModal('none')}>
          <div className={styles['fav-modal']} onClick={e => e.stopPropagation()}>
            <div className={styles['fav-header']}>
              <h3><FontAwesomeIcon icon={faStarSolid} className={styles['fav-header-icon']} /> 我的收藏夹</h3>
              <div className={styles['fav-header-actions']}>
                <select className={styles['fav-sort-select']} value={favSort} onChange={(e) => setFavSort(e.target.value as any)}>
                  <option value="time">按时间 (最新优先)</option>
                  <option value="title">按标题 (A-Z)</option>
                </select>
                <FontAwesomeIcon
                  icon={faPlus}
                  className={`${styles['action-icon']} ${styles['fav-header-plus']}`}
                  title="新增收藏"
                  onClick={() => setFavForm({ visible: true, title: '', url: '', editingOriginalUrl: '' })}
                />
                <div className={styles['fav-header-divider']}></div>
                <FontAwesomeIcon icon={faXmark} className={styles['fav-close']} onClick={() => setActiveModal('none')} title="关闭" />
              </div>
            </div>

            {favForm.visible && (
              <div className={styles['fav-form']}>
                <input
                  type="text"
                  className={styles['fav-input']}
                  placeholder="输入网站标题"
                  value={favForm.title}
                  onChange={e => setFavForm({ ...favForm, title: e.target.value })}
                  autoFocus
                />
                <input
                  type="text"
                  className={styles['fav-input']}
                  placeholder="输入规范的网址 (如 https://...)"
                  value={favForm.url}
                  onChange={e => setFavForm({ ...favForm, url: e.target.value })}
                />
                <div className={styles['fav-form-btns']}>
                  <button className={styles['fav-btn']} onClick={() => setFavForm({ ...favForm, visible: false })}>取消</button>
                  <button className={`${styles['fav-btn']} ${styles['primary']}`} onClick={saveFavorite}>保存</button>
                </div>
              </div>
            )}

            <div className={styles['fav-list']}>
              {sortedFavorites.length === 0 ? (
                <div className={styles['fav-empty']}>暂无收藏。点击右上角 + 号，或地址栏星号添加。</div>
              ) : (
                sortedFavorites.map((f, i) => (
                  <div key={i} className={styles['fav-item']} onClick={() => { handleGo(f.url); setActiveModal('none'); }}>
                    <div className={styles['fav-item-info']}>
                      <div className={styles['fav-title']} title={f.title}>{f.title}</div>
                      <div className={styles['fav-url']} title={f.url}>{f.url}</div>
                    </div>
                    <div className={styles['fav-actions']}>
                      <FontAwesomeIcon
                        icon={copiedUrl === f.url ? faCheck : faCopyRegular}
                        className={`${styles['fav-action-btn']} ${styles['copy']} ${copiedUrl === f.url ? styles['copy-success'] : ''}`}
                        title="复制链接"
                        onClick={(e) => { e.stopPropagation(); handleCopy(f.url); }}
                      />
                      <FontAwesomeIcon
                        icon={faPen}
                        className={`${styles['fav-action-btn']} ${styles['edit']}`}
                        title="编辑"
                        onClick={(e) => {
                          e.stopPropagation();
                          setFavForm({ visible: true, title: f.title, url: f.url, editingOriginalUrl: f.url });
                        }}
                      />
                      <FontAwesomeIcon
                        icon={faTrash}
                        className={`${styles['fav-action-btn']} ${styles['delete']}`}
                        title="删除"
                        onClick={(e) => { e.stopPropagation(); deleteFavorite(f.url); }}
                      />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* 历史记录弹窗 */}
      {activeModal === 'history' && (
        <div className={styles['fav-overlay']} onClick={() => setActiveModal('none')}>
          <div className={styles['fav-modal']} onClick={e => e.stopPropagation()}>
            <div className={styles['fav-header']}>
              <h3><FontAwesomeIcon icon={faClockRotateLeft} className={styles['history-header-icon']} /> 历史记录</h3>
              <FontAwesomeIcon icon={faXmark} className={styles['fav-close']} onClick={() => setActiveModal('none')} title="关闭" />
            </div>
            <div className={styles['fav-list']}>
              {historyStack.length === 0 ? (
                <div className={styles['fav-empty']}>暂无历史记录</div>
              ) : (
                [...historyStack].reverse().map((entry, index) => {
                  const originalIndex = historyStack.length - 1 - index;
                  const isCurrent = originalIndex === historyIdx;
                  return (
                    <div
                      key={originalIndex}
                      className={`${styles['fav-item']} ${isCurrent ? styles['current-history'] : ''}`}
                      onClick={() => !isCurrent && navigateToHistory(originalIndex)}
                    >
                      <div className={styles['fav-item-info']}>
                        <div className={styles['fav-title']} title={entry.title}>{entry.title} {isCurrent ? '(当前)' : ''}</div>
                        <div className={styles['fav-url']} title={entry.url}>{entry.url}</div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}