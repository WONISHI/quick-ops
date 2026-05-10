import React, { useState, useEffect, useRef, useMemo } from 'react';
import { vscode } from '../../utils/vscode';
import { escapeRegExp } from "../../utils"
import UrlParser from "../../utils/UrlParser"
import styles from './index.module.css';

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faArrowLeft, faRotateRight, faGlobe, faXmark, faStar as faStarSolid,
  faArrowRight, faRotate, faArrowUpRightFromSquare, faEllipsis,
  faLayerGroup, faPlus, faClockRotateLeft, faBroom, faChevronRight,
  faDatabase, faBoxArchive, faCookieBite, faTerminal, faPen,
  faTrash, faCheck,
  faSpinner
} from '@fortawesome/free-solid-svg-icons';
import { faStar as faStarRegular, faCopy as faCopyRegular } from '@fortawesome/free-regular-svg-icons';
import { faVuejs, faNodeJs, faReact } from '@fortawesome/free-brands-svg-icons';

import VditorApp from '../VditorApp';
import PdfPreviewApp from '../PdfPreviewApp';
import ExcelPreviewApp from '../ExcelPreviewApp';

interface FavoriteItem {
  url: string;
  title: string;
  timestamp: number;
  description?: string;
  logo?: string;
  isDefault?: boolean;
  source?: 'builtin' | 'user';
}

export default function LivePreviewApp() {
  const [urlInput, setUrlInput] = useState('');
  const [frameUrl, setFrameUrl] = useState('');

  const [previewType, setPreviewType] = useState<'web' | 'md' | 'pdf' | 'excel' | 'html'>('web');

  const [device, setDevice] = useState('device-responsive');
  const [isRotated, setIsRotated] = useState(false);
  const [faviconUrl, setFaviconUrl] = useState('');
  const [faviconError, setFaviconError] = useState(false);

  // 🌟 2. 引入 Favicon 专属的加载状态
  const [isFaviconLoading, setIsFaviconLoading] = useState(false);

  const [favorites, setFavorites] = useState<FavoriteItem[]>([]);
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

  const iframeRef = useRef<HTMLIFrameElement>(null);
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
            loadPreviewTarget(initUrl);
            pushHistory(initUrl, initUrl);
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

  const updateCurrentHistoryTitle = (title: string) => {
    setHistoryStack((prev) => {
      const next = [...prev];

      if (next[historyIdx]) {
        next[historyIdx].title = title || next[historyIdx].url;
      }

      return next;
    });
  };

  const canReadIframeDocument = (targetUrl: string) => {
    try {
      if (!targetUrl) return false;

      const target = new URL(targetUrl);
      const current = new URL(window.location.href);

      return target.origin === current.origin;
    } catch {
      return false;
    }
  };

  const handleIframeLoad = () => {
    if (!iframeRef.current || historyIdx < 0 || (previewType !== 'web' && previewType !== 'html')) return;

    const fallbackTitle = urlInput || frameUrl;

    if (!canReadIframeDocument(frameUrl)) {
      updateCurrentHistoryTitle(fallbackTitle);
      return;
    }

    try {
      const doc = iframeRef.current.contentDocument || iframeRef.current.contentWindow?.document;
      updateCurrentHistoryTitle(doc?.title || fallbackTitle);
    } catch {
      updateCurrentHistoryTitle(fallbackTitle);
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
    loadPreviewTarget(targetUrl);
    setActiveModal('none');
  };

  // 🌟 3. 异步后台加载：防阻塞解析逻辑
  const updateFavicon = (urlStr: string) => {
    if (!urlStr) {
      setFaviconUrl('');
      setIsFaviconLoading(false);
      return;
    }
    try {
      const urlObj = new URL(urlStr);
      const targetIconUrl = `${urlObj.origin}/favicon.ico`;

      setIsFaviconLoading(true);
      setFaviconError(false);

      const imgLoader = new Image();
      imgLoader.src = targetIconUrl;

      imgLoader.onload = () => {
        setFaviconUrl(targetIconUrl);
        setIsFaviconLoading(false);
      };

      imgLoader.onerror = () => {
        setFaviconError(true);
        setIsFaviconLoading(false);
      };
    } catch {
      setFaviconError(true);
      setIsFaviconLoading(false);
    }
  };

  const loadPreviewTarget = (url: string) => {
    setFrameUrl(url);
    vscode?.postMessage({ type: 'saveUrl', url });

    let pType: 'web' | 'md' | 'pdf' | 'excel' | 'html' = 'web';
    if (UrlParser.isAbsolutePath(url)) {
      const lower = url.toLowerCase();
      if (lower.endsWith('.md')) pType = 'md';
      else if (lower.endsWith('.pdf')) pType = 'pdf';
      else if (lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.csv')) pType = 'excel';
      else if (lower.endsWith('.html') || lower.endsWith('.htm')) pType = 'html';
    }

    setPreviewType(pType);

    if (pType !== 'web' && pType !== 'html') {
      vscode?.postMessage({ type: 'setPendingLocalFile', fsPath: url, fileType: pType });
      setFaviconUrl('');
      setIsFaviconLoading(false);
    } else {
      updateFavicon(url);
    }
  };

  const handleGo = (forceUrl?: string) => {
    const rawUrl = forceUrl !== undefined ? forceUrl : urlInput;
    const finalUrl = UrlParser.parse(rawUrl);

    setShowSuggest(false);

    if (!finalUrl) {
      setFrameUrl('');
      setPreviewType('web');
      updateFavicon('');
      vscode?.postMessage({ type: 'saveUrl', url: '' });
      return;
    }

    setUrlInput(finalUrl);
    loadPreviewTarget(finalUrl);
    pushHistory(finalUrl, finalUrl);
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

  const toggleFavorite = () => {
    if (!frameUrl) return;

    const currentHistory = historyIdx >= 0 ? historyStack[historyIdx] : undefined;
    const title = currentHistory?.title || urlInput || frameUrl;

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

  const handleCacheClear = (type: 'local' | 'session' | 'cookie') => {
    try {
      if (previewType !== 'web' && previewType !== 'html') throw new Error("Not a web preview");
      const win = iframeRef.current?.contentWindow;
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
      vscode?.postMessage({ type: 'showWarning', message: '⚠️ 此页面不支持清理缓存或存在跨域限制' });
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
    const u = UrlParser.parse(favForm.url);

    if (!t || !u) {
      return vscode?.postMessage({ type: 'showError', message: '标题和链接不能为空' });
    }

    const editingTarget = favorites.find((f) => f.url === favForm.editingOriginalUrl);

    if (editingTarget?.isDefault) {
      return vscode?.postMessage({ type: 'showInfo', message: '默认收藏不能编辑。' });
    }

    let newFavs = [...favorites];

    if (favForm.editingOriginalUrl) {
      const index = newFavs.findIndex((f) => f.url === favForm.editingOriginalUrl && !f.isDefault);

      if (index > -1) {
        if (u !== favForm.editingOriginalUrl && newFavs.some((f) => f.url === u)) {
          return vscode?.postMessage({ type: 'showError', message: '该链接已存在！' });
        }

        newFavs[index] = {
          ...newFavs[index],
          title: t,
          url: u,
          isDefault: false,
          source: 'user',
        };
      }
    } else {
      if (newFavs.some((f) => f.url === u)) {
        return vscode?.postMessage({ type: 'showError', message: '该链接已存在！' });
      }

      newFavs.push({
        url: u,
        title: t,
        timestamp: Date.now(),
        isDefault: false,
        source: 'user',
      });
    }

    vscode?.postMessage({
      type: 'saveAllFavorites',
      favorites: newFavs.filter((item) => !item.isDefault),
    });

    setFavForm({ visible: false, title: '', url: '', editingOriginalUrl: '' });
  };

  const deleteFavorite = (favorite: FavoriteItem) => {
    if (favorite.isDefault) {
      vscode?.postMessage({ type: 'showInfo', message: '该收藏是插件内置默认书签，不能删除。' });
      return;
    }

    const newFavs = favorites.filter((f) => f.url !== favorite.url || f.isDefault);
    vscode?.postMessage({ type: 'saveAllFavorites', favorites: newFavs });
  };

  const sortedFavorites = useMemo(() => {
    const defaultList = favorites.filter((item) => item.isDefault);
    const userList = favorites.filter((item) => !item.isDefault);

    const sortedUserList = [...userList];

    if (favSort === 'time') {
      sortedUserList.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    } else {
      sortedUserList.sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'));
    }

    return [...defaultList, ...sortedUserList];
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
          {/* 🌟 4. 地址栏图标三态逻辑：加载中转为旋转的 faSpinner */}
          {urlInput.trim() ? (
            isFaviconLoading ? (
              <FontAwesomeIcon icon={faSpinner} spin className={styles['spiner-icon']} />
            ) : faviconUrl && !faviconError ? (
              <img src={faviconUrl} className={styles['favicon-img']} />
            ) : (
              <FontAwesomeIcon icon={faGlobe} className={styles['globe-icon']} />
            )
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
            placeholder="输入网址、本地绝对路径 或 搜索内容"
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

        <select
          className={styles['vscode-select']}
          value={device}
          onChange={handleDeviceChange}
          title="选择预览设备"
          disabled={previewType !== 'web' && previewType !== 'html'}
        >
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
          disabled={(previewType !== 'web' && previewType !== 'html') || device === 'device-responsive'}
          onClick={() => setIsRotated(!isRotated)}
          title="横屏/竖屏切换"
        >
          <FontAwesomeIcon icon={faRotate} />
        </button>

        <div className={styles['divider']}></div>
        <button className={styles['icon-btn']} disabled={!urlInput.trim() || (previewType !== 'web' && previewType !== 'html')} onClick={() => vscode?.postMessage({ type: 'openExternalBrowser', url: frameUrl || urlInput })} title="在外部默认浏览器中打开">
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
        </div>
      )}

      {/* 渲染预览内容区域 */}
      <div className={`${styles['preview-container']} ${(device === 'device-responsive' && previewType !== 'md' && previewType !== 'pdf' && previewType !== 'excel') ? styles['no-padding'] : ''}`}>
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
        ) : previewType === 'md' ? (
          <VditorApp key={frameUrl} />
        ) : previewType === 'pdf' ? (
          <PdfPreviewApp key={frameUrl} initialScale={0.8} />
        ) : previewType === 'excel' ? (
          <ExcelPreviewApp key={frameUrl} />
        ) : (
          <div id="deviceWrapper" className={`${styles[device] || device} ${isRotated ? styles['rotated'] : ''}`}>
            <iframe
              ref={iframeRef}
              src={previewType === 'html' ? UrlParser.parse(frameUrl) : frameUrl}
              className={styles['fromPage']}
              title="preview"
              onLoad={handleIframeLoad}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
            />
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
                  <div key={`${f.isDefault ? 'default' : 'user'}-${f.url}-${i}`} className={styles['fav-item']} onClick={() => { handleGo(f.url); setActiveModal('none'); }}>
                    <div className={styles['fav-logo-wrap']}>
                      {f.logo ? (
                        <img
                          className={styles['fav-logo']}
                          src={f.logo}
                          onError={(e) => {
                            e.currentTarget.style.display = 'none';
                          }}
                        />
                      ) : (
                        <FontAwesomeIcon icon={faGlobe} className={styles['fav-logo-placeholder']} />
                      )}
                    </div>

                    <div className={styles['fav-item-info']}>
                      <div className={styles['fav-title-row']}>
                        <div className={styles['fav-title']} title={f.title}>{f.title}</div>
                        {f.isDefault && <span className={styles['fav-default-tag']}>默认</span>}
                      </div>

                      {f.description && (
                        <div className={styles['fav-description']} title={f.description}>
                          {f.description}
                        </div>
                      )}

                      <div className={styles['fav-url']} title={f.url}>{f.url}</div>
                    </div>

                    <div className={styles['fav-actions']}>
                      <FontAwesomeIcon
                        icon={copiedUrl === f.url ? faCheck : faCopyRegular}
                        className={`${styles['fav-action-btn']} ${styles['copy']} ${copiedUrl === f.url ? styles['copy-success'] : ''}`}
                        title="复制链接"
                        onClick={(e) => { e.stopPropagation(); handleCopy(f.url); }}
                      />

                      {!f.isDefault && (
                        <>
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
                            onClick={(e) => { e.stopPropagation(); deleteFavorite(f); }}
                          />
                        </>
                      )}
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