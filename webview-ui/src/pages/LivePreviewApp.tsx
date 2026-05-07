import React, { useState, useEffect, useRef, useMemo } from 'react';
import { vscode } from '../utils/vscode';

// 🌟 引入所有需要的 FontAwesome 图标
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

// 工具函数
const isUrlLike = (str: string) => /^(https?:\/\/|file:\/\/)?(localhost|\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}|([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,})(:\d+)?(\/.*)?$/i.test(str);
const escapeRegExp = (string: string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export default function LivePreviewApp() {
  // 核心状态
  const [urlInput, setUrlInput] = useState('');
  const [frameUrl, setFrameUrl] = useState('');
  const [device, setDevice] = useState('device-responsive');
  const [isRotated, setIsRotated] = useState(false);
  const [faviconUrl, setFaviconUrl] = useState('');
  const [faviconError, setFaviconError] = useState(false);

  // 收藏夹与历史状态
  const [favorites, setFavorites] = useState<any[]>([]);
  const [historyStack, setHistoryStack] = useState<{url: string, title: string, timestamp: number}[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const isInternalNav = useRef(false);

  // 弹窗与菜单状态
  const [activeModal, setActiveModal] = useState<'none' | 'fav' | 'history'>('none');
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });
  const [cacheSubmenuOpen, setCacheSubmenuOpen] = useState(false);

  // 收藏夹表单状态
  const [favSort, setFavSort] = useState<'time' | 'title'>('time');
  const [favForm, setFavForm] = useState({ visible: false, title: '', url: '', editingOriginalUrl: '' });
  
  // 智能提示状态
  const [showSuggest, setShowSuggest] = useState(false);
  const [suggestIndex, setSuggestIndex] = useState(-1);
  const [copiedUrl, setCopiedUrl] = useState('');

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const moreBtnRef = useRef<HTMLButtonElement>(null);
  const suggestBoxRef = useRef<HTMLDivElement>(null);
  const cacheMenuTimer = useRef<any>(null);

  // 初始化与通信
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
      if (!suggestBoxRef.current?.contains(e.target as Node) && !(e.target as Element).closest('.address-bar-wrapper')) {
        setShowSuggest(false);
      }
    };
    window.addEventListener('click', handleClickOutside);

    return () => {
      window.removeEventListener('message', handleMessage);
      window.removeEventListener('click', handleClickOutside);
    };
  }, []);

  // 监听 Iframe Title 更新历史记录
  const handleIframeLoad = () => {
    if (!iframeRef.current || historyIdx < 0) return;
    try {
      const doc = iframeRef.current.contentDocument || iframeRef.current.contentWindow?.document;
      if (doc && doc.title) {
        setHistoryStack(prev => {
          const next = [...prev];
          if (next[historyIdx]) next[historyIdx].title = doc.title;
          return next;
        });
      }
    } catch (e) { /* 跨域忽略 */ }
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

  // 🌟 补齐缺失的处理设备切换的方法
  const handleDeviceChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newDevice = e.target.value;
    setDevice(newDevice);
    if (newDevice === 'device-responsive') {
      setIsRotated(false); // 响应式铺满时，取消横屏状态
    }
    vscode?.postMessage({ type: 'saveDevice', device: newDevice });
  };

  const toggleFavorite = () => {
    if (!frameUrl) return;
    let title = frameUrl;
    try { title = iframeRef.current?.contentDocument?.title || urlInput; } catch(e) {}
    vscode?.postMessage({ type: 'toggleFavorite', url: frameUrl, title });
  };

  // 获取智能提示列表
  const suggestions = useMemo(() => {
    const query = urlInput.trim().toLowerCase();
    if (!query || favorites.length === 0) return [];
    return favorites.filter(f => f.title.toLowerCase().includes(query) || f.url.toLowerCase().includes(query));
  }, [urlInput, favorites]);

  // 高亮搜索文字
  const renderHighlighted = (text: string) => {
    const query = urlInput.trim();
    if (!query) return text;
    const parts = text.split(new RegExp(`(${escapeRegExp(query)})`, 'gi'));
    return parts.map((part, i) => 
      part.toLowerCase() === query.toLowerCase() ? <span key={i} className="highlight-match">{part}</span> : part
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
    } catch(e) {
      vscode?.postMessage({ type: 'showWarning', message: '⚠️ 跨域安全限制，请在开发者工具中手动清理。' });
    }
    setMenuOpen(false);
  };

  const handleInjectVConsole = () => {
    try {
      const frameDoc = iframeRef.current?.contentDocument || iframeRef.current?.contentWindow?.document;
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
    <div className="live-preview-container">
      {/* 🌟 核心 CSS 注入，保持 100% 视觉一致 */}
      <style>{`
        :root {
          --bg: var(--vscode-editor-background);
          --fg: var(--vscode-editor-foreground);
          --border: var(--vscode-panel-border);
          --input-bg: var(--vscode-input-background);
          --input-fg: var(--vscode-input-foreground);
          --input-border: var(--vscode-input-border);
          --btn-hover: var(--vscode-toolbar-hoverBackground);
          --menu-bg: var(--vscode-menu-background);
          --menu-fg: var(--vscode-menu-foreground);
          --menu-border: var(--vscode-menu-border);
          --menu-hover-bg: var(--vscode-menu-selectionBackground);
          --menu-hover-fg: var(--vscode-menu-selectionForeground);
          --focus-border: var(--vscode-focusBorder);
        }
        .live-preview-container { height: 100vh; display: flex; flex-direction: column; background-color: var(--vscode-editorPane-background, #1e1e1e); color: var(--fg); user-select: none; overflow: hidden; }
        
        .toolbar { display: flex; padding: 6px 10px; background: var(--bg); border-bottom: 1px solid var(--border); gap: 6px; align-items: center; flex-shrink: 0; }
        
        .address-bar-wrapper { flex: 1; min-width: 150px; padding: 4px 8px; border: 1px solid var(--input-border); background: var(--input-bg); border-radius: 2px; display: flex; align-items: center; gap: 8px; transition: border-color 0.2s; position: relative; }
        .address-bar-wrapper:focus-within { border-color: var(--focus-border); }
        .address-bar { flex: 1; border: none; background: transparent; color: var(--input-fg); outline: none; font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; padding: 0; min-width: 0; }

        .suggest-box { position: absolute; top: 100%; left: 0; width: 100%; margin-top: 4px; background: var(--menu-bg); border: 1px solid var(--menu-border); border-radius: 4px; box-shadow: 0 6px 16px rgba(0,0,0,0.4); z-index: 100000; flex-direction: column; max-height: 280px; overflow-y: auto; }
        .suggest-item { padding: 8px 12px; border-bottom: 1px solid var(--menu-border); cursor: pointer; display: flex; flex-direction: column; gap: 4px; transition: background 0.1s; }
        .suggest-item:last-child { border-bottom: none; }
        .suggest-item:hover, .suggest-item.selected { background: var(--menu-hover-bg); }
        .suggest-title { font-size: 13px; color: var(--fg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
        .suggest-url { font-size: 11px; color: var(--vscode-descriptionForeground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .highlight-match { color: #5dade2; font-weight: bold; }

        .action-icon { color: var(--vscode-icon-foreground); cursor: pointer; font-size: 14px; padding: 0 4px; opacity: 0.7; transition: opacity 0.2s, color 0.2s; }
        .action-icon:hover { opacity: 1; color: var(--fg); }
        
        .icon-btn { background: transparent; color: var(--vscode-icon-foreground); border: none; padding: 4px 6px; border-radius: 4px; cursor: pointer; font-size: 14px; display: inline-flex; align-items: center; justify-content: center; outline: none; transition: 0.1s; min-width: 28px; min-height: 28px;}
        .icon-btn:hover { background: var(--btn-hover); color: var(--fg); }
        .icon-btn:disabled { opacity: 0.3; cursor: not-allowed; background: transparent !important; color: var(--vscode-icon-foreground) !important; }
        
        .vscode-select { background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--input-border); padding: 4px; border-radius: 2px; outline: none; cursor: pointer; font-size: 12px; width: 125px; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; }
        .vscode-select:focus { border-color: var(--focus-border); }

        .divider { width: 1px; height: 18px; background: var(--border); margin: 0 2px; }

        .preview-container { flex: 1; overflow: auto; display: flex; justify-content: center; align-items: flex-start; padding: 20px; position: relative; transition: padding 0.3s ease; }
        .preview-container.no-padding { padding: 0 !important; }
        
        #deviceWrapper { background: #fff; transition: width 0.3s ease, height 0.3s ease; box-shadow: 0 4px 16px rgba(0,0,0,0.4); border-radius: 2px; overflow: hidden; position: relative; z-index: 2; }
        
        .device-responsive { width: 100%; height: 100%; box-shadow: none !important; border-radius: 0 !important; }
        .device-iphone-se { width: 375px; height: 667px; } .device-iphone-se.rotated { width: 667px; height: 375px; }
        .device-iphone-xr { width: 414px; height: 896px; } .device-iphone-xr.rotated { width: 896px; height: 414px; }
        .device-iphone-12-pro { width: 390px; height: 844px; } .device-iphone-12-pro.rotated { width: 844px; height: 390px; }
        .device-iphone-14-pro-max { width: 430px; height: 932px; } .device-iphone-14-pro-max.rotated { width: 932px; height: 430px; }
        .device-pixel-7 { width: 412px; height: 915px; } .device-pixel-7.rotated { width: 915px; height: 412px; }
        .device-galaxy-s8-plus { width: 360px; height: 740px; } .device-galaxy-s8-plus.rotated { width: 740px; height: 360px; }
        .device-galaxy-s20-ultra { width: 412px; height: 915px; } .device-galaxy-s20-ultra.rotated { width: 915px; height: 412px; }
        .device-ipad-mini { width: 768px; height: 1024px; } .device-ipad-mini.rotated { width: 1024px; height: 768px; }
        .device-ipad-air { width: 820px; height: 1180px; } .device-ipad-air.rotated { width: 1180px; height: 820px; }
        .device-ipad-pro { width: 1024px; height: 1366px; } .device-ipad-pro.rotated { width: 1366px; height: 1024px; }
        .device-surface-pro-7 { width: 912px; height: 1368px; } .device-surface-pro-7.rotated { width: 1368px; height: 912px; }
        
        iframe { width: 100%; height: 100%; border: none; background: #fff; display: block; }

        .welcome-page { position: absolute; top: 0; left: 0; width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; background-color: var(--bg); z-index: 1; padding: 20px; box-sizing: border-box; }
        .welcome-icon { font-size: 56px; color: var(--vscode-descriptionForeground); margin-bottom: 24px; opacity: 0.5; }
        .welcome-title { font-size: 24px; font-weight: 300; margin-bottom: 12px; color: var(--fg); }
        .welcome-subtitle { font-size: 13px; color: var(--vscode-descriptionForeground); margin-bottom: 32px; text-align: center; max-width: 400px; line-height: 1.6; }
        
        .quick-links { display: flex; flex-direction: column; gap: 12px; width: 100%; max-width: 300px; }
        .quick-link-btn { display: flex; align-items: center; gap: 12px; padding: 10px 16px; background: var(--vscode-button-secondaryBackground, rgba(255,255,255,0.05)); color: var(--vscode-button-secondaryForeground, var(--fg)); border: 1px solid var(--border); border-radius: 4px; cursor: pointer; font-size: 13px; transition: all 0.15s; outline: none; text-align: left; }
        .quick-link-btn svg { font-size: 16px; opacity: 0.8; width: 20px; text-align: center; }
        .quick-link-btn:hover { background: var(--vscode-button-secondaryHoverBackground, rgba(255,255,255,0.1)); border-color: var(--focus-border); }

        .context-menu { position: absolute; z-index: 9999; background: var(--menu-bg); border: 1px solid var(--menu-border); box-shadow: 0 2px 8px rgba(0,0,0,0.3); border-radius: 4px; padding: 4px 0; min-width: 180px; }
        .menu-item { padding: 6px 12px; font-size: 12px; color: var(--menu-fg); cursor: pointer; display: flex; align-items: center; gap: 8px; }
        .menu-item:hover { background: var(--menu-hover-bg); color: var(--menu-hover-fg); }
        .menu-divider { height: 1px; background: var(--menu-border); margin: 4px 0; }
        
        .has-submenu { position: relative; }
        .submenu { position: absolute; right: 100%; top: -5px; background: var(--menu-bg); border: 1px solid var(--menu-border); box-shadow: 0 2px 8px rgba(0,0,0,0.3); border-radius: 4px; padding: 4px 0; min-width: 170px; margin-right: 4px; }

        .fav-overlay { position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); z-index: 100000; display: flex; justify-content: center; align-items: center; }
        .fav-modal { background: var(--bg); width: 440px; max-height: 80vh; display: flex; flex-direction: column; border: 1px solid var(--border); border-radius: 6px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
        .fav-header { padding: 12px 16px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; }
        .fav-header h3 { margin: 0; font-size: 14px; font-weight: bold; color: var(--fg); display: flex; align-items: center; gap: 8px; }
        .fav-header-actions { display: flex; align-items: center; gap: 12px; }
        .fav-sort-select { background: var(--input-bg); color: var(--fg); border: 1px solid var(--input-border); padding: 2px 4px; border-radius: 2px; outline: none; font-size: 12px; cursor: pointer; }
        .fav-close { cursor: pointer; color: var(--vscode-icon-foreground); transition: 0.2s; font-size: 16px; }
        .fav-close:hover { color: #e74c3c; }
        .fav-form { padding: 12px 16px; background: var(--menu-bg); border-bottom: 1px solid var(--border); }
        .fav-input { width: 100%; box-sizing: border-box; border: 1px solid var(--input-border); background: var(--input-bg); color: var(--input-fg); padding: 6px 8px; margin-bottom: 8px; border-radius: 2px; outline: none; font-size: 12px; }
        .fav-input:focus { border-color: var(--focus-border); }
        .fav-form-btns { display: flex; justify-content: flex-end; gap: 8px; }
        .fav-btn { background: transparent; color: var(--fg); border: 1px solid var(--border); padding: 4px 12px; border-radius: 2px; cursor: pointer; font-size: 12px; }
        .fav-btn.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; }
        .fav-btn:hover { opacity: 0.9; }
        .fav-list { flex: 1; overflow-y: auto; padding: 6px 0; }
        
        .fav-item { padding: 10px 16px; border-bottom: 1px solid var(--vscode-panel-border); display: flex; justify-content: space-between; align-items: center; cursor: pointer; gap: 12px; }
        .fav-item:last-child { border-bottom: none; }
        .fav-item:hover { background: var(--menu-hover-bg); }
        .fav-item.current-history { border-left: 3px solid #3498db; background: rgba(255, 255, 255, 0.03); padding-left: 13px; }
        
        .fav-item-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
        .fav-title { font-size: 13px; font-weight: 600; color: var(--fg); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .fav-url { font-size: 11px; color: var(--vscode-descriptionForeground); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; opacity: 0.8; }
        
        .fav-actions { display: flex; gap: 8px; opacity: 0; transition: opacity 0.2s; align-items: center; }
        .fav-item:hover .fav-actions { opacity: 1; }
        .fav-action-btn { color: var(--vscode-icon-foreground); padding: 4px; border-radius: 4px; font-size: 13px; transition: 0.2s; }
        .fav-action-btn:hover { background: var(--btn-hover); color: var(--fg); }
        .fav-action-btn.delete:hover { color: #e74c3c; }
        .fav-action-btn.copy-success { color: #2ecc71 !important; }
        .fav-empty { padding: 30px; text-align: center; color: var(--vscode-descriptionForeground); font-size: 13px; }
      `}</style>

      {/* 顶部工具栏 */}
      <div className="toolbar">
        <button className="icon-btn" disabled={historyIdx <= 0} onClick={() => navigateToHistory(historyIdx - 1)} title="后退">
          <FontAwesomeIcon icon={faArrowLeft} />
        </button>
        <button className="icon-btn" onClick={handleRefresh} title="刷新页面">
          <FontAwesomeIcon icon={faRotateRight} />
        </button>
        
        <div className="address-bar-wrapper">
          {faviconUrl && !faviconError && urlInput.trim() ? (
             <img src={faviconUrl} onError={() => setFaviconError(true)} style={{ width: 14, height: 14, borderRadius: 2, objectFit: 'contain' }} />
          ) : (
             <FontAwesomeIcon icon={faGlobe} style={{ fontSize: 13, color: 'var(--vscode-descriptionForeground)' }} />
          )}
          
          <input 
            type="text" 
            className="address-bar" 
            value={urlInput} 
            onChange={e => {
              setUrlInput(e.target.value);
              setShowSuggest(true);
              setSuggestIndex(-1);
            }}
            onKeyDown={handleKeyDown}
            onFocus={() => { if(urlInput.trim()) setShowSuggest(true); }}
            placeholder="输入网址 或 搜索内容" 
            spellCheck="false"
            autoComplete="off"
          />
          
          {urlInput && (
            <FontAwesomeIcon 
              icon={faXmark} 
              className="action-icon" 
              onClick={() => { setUrlInput(''); setShowSuggest(false); }} 
              title="清除"
            />
          )}
          <FontAwesomeIcon 
            icon={isFav ? faStarSolid : faStarRegular} 
            className="action-icon"
            style={{ color: isFav ? '#f1c40f' : '' }}
            onClick={toggleFavorite} 
            title="添加/取消收藏 (跨工作区同步)"
          />

          {/* 智能提示框 */}
          {showSuggest && suggestions.length > 0 && (
            <div className="suggest-box" ref={suggestBoxRef} style={{ display: 'flex' }}>
              {suggestions.map((item, index) => (
                <div 
                  key={index} 
                  className={`suggest-item ${index === suggestIndex ? 'selected' : ''}`}
                  onMouseEnter={() => setSuggestIndex(index)}
                  onClick={() => {
                    handleGo(item.url);
                  }}
                >
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
          className="icon-btn" 
          disabled={device === 'device-responsive'} 
          onClick={() => setIsRotated(!isRotated)}
          style={{ color: isRotated ? '#3498db' : '' }}
          title="横屏/竖屏切换"
        >
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

      {/* 更多菜单 (Context Menu) */}
      {menuOpen && (
        <div className="context-menu" style={{ left: menuPos.x, top: menuPos.y, display: 'block' }}>
          <div className="menu-item" onClick={() => { handleRefresh(); setMenuOpen(false); }}>
            <FontAwesomeIcon icon={faRotateRight} style={{ width: 16 }} /> 刷新页面
          </div>
          <div className="menu-item" onClick={() => { setActiveModal('fav'); setMenuOpen(false); }}>
            <FontAwesomeIcon icon={faStarSolid} style={{ width: 16, color: '#f1c40f' }} /> 打开收藏夹
          </div>
          <div className="menu-item" onClick={() => { setActiveModal('history'); setMenuOpen(false); }}>
            <FontAwesomeIcon icon={faClockRotateLeft} style={{ width: 16 }} /> 历史记录
          </div>
          
          <div className="menu-divider"></div>
          <div 
            className="menu-item has-submenu" 
            onMouseEnter={() => { clearTimeout(cacheMenuTimer.current); setCacheSubmenuOpen(true); }}
            onMouseLeave={() => { cacheMenuTimer.current = setTimeout(() => setCacheSubmenuOpen(false), 300); }}
          >
            <FontAwesomeIcon icon={faBroom} style={{ width: 16 }} /> 清理页面缓存
            <FontAwesomeIcon icon={faChevronRight} style={{ marginLeft: 'auto', fontSize: 10, opacity: 0.7 }} />
            {cacheSubmenuOpen && (
              <div className="submenu" style={{ display: 'block' }}>
                <div className="menu-item" onClick={() => handleCacheClear('local')}><FontAwesomeIcon icon={faDatabase} style={{ width: 16 }} /> 清理 LocalStorage</div>
                <div className="menu-item" onClick={() => handleCacheClear('session')}><FontAwesomeIcon icon={faBoxArchive} style={{ width: 16 }} /> 清理 SessionStorage</div>
                <div className="menu-item" onClick={() => handleCacheClear('cookie')}><FontAwesomeIcon icon={faCookieBite} style={{ width: 16 }} /> 清理 Cookie 数据</div>
              </div>
            )}
          </div>

          <div className="menu-divider"></div>
          <div className="menu-item" onClick={() => { vscode?.postMessage({ type: 'openDevTools' }); setMenuOpen(false); }}>
            <FontAwesomeIcon icon={faTerminal} style={{ width: 16 }} /> 开发者工具
          </div>
          <div className="menu-item" style={{ color: '#2ecc71' }} onClick={handleInjectVConsole}>
            <FontAwesomeIcon icon={faBug} style={{ width: 16 }} /> 注入 vConsole
          </div>
        </div>
      )}

      {/* 预览区域 */}
      <div className={`preview-container ${device === 'device-responsive' ? 'no-padding' : ''}`}>
        {!frameUrl ? (
          <div className="welcome-page">
            <FontAwesomeIcon icon={faLayerGroup} className="welcome-icon" />
            <h1 className="welcome-title">Live Preview</h1>
            <p className="welcome-subtitle">在上方地址栏输入您的本地开发服务器地址，或直接输入关键词进行搜索。<br/>您也可以点击下方快捷选项快速填入：</p>
            
            <div className="quick-links">
              <button className="quick-link-btn" onClick={() => handleGo('localhost:5173')}>
                <FontAwesomeIcon icon={faVuejs} style={{ color: '#42b883' }} /> <span>Vite 默认端口 (5173)</span>
              </button>
              <button className="quick-link-btn" onClick={() => handleGo('localhost:8080')}>
                <FontAwesomeIcon icon={faNodeJs} style={{ color: '#8cc84b' }} /> <span>Vue CLI / Webpack (8080)</span>
              </button>
              <button className="quick-link-btn" onClick={() => handleGo('localhost:3000')}>
                <FontAwesomeIcon icon={faReact} style={{ color: '#61dafb' }} /> <span>React / Next.js (3000)</span>
              </button>
            </div>
          </div>
        ) : (
          <div id="deviceWrapper" className={`${device} ${isRotated ? 'rotated' : ''}`}>
            <iframe 
              ref={iframeRef} 
              src={frameUrl} 
              onLoad={handleIframeLoad}
              title="preview" 
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads"
              allow="clipboard-read; clipboard-write;"
            ></iframe>
          </div>
        )}
      </div>

      {/* 收藏夹弹窗 */}
      {activeModal === 'fav' && (
        <div className="fav-overlay" onClick={() => setActiveModal('none')}>
          <div className="fav-modal" onClick={e => e.stopPropagation()}>
            <div className="fav-header">
              <h3><FontAwesomeIcon icon={faStarSolid} style={{ color: '#f1c40f' }} /> 我的收藏夹</h3>
              <div className="fav-header-actions">
                <select className="fav-sort-select" value={favSort} onChange={(e) => setFavSort(e.target.value as any)}>
                  <option value="time">按时间 (最新优先)</option>
                  <option value="title">按标题 (A-Z)</option>
                </select>
                <FontAwesomeIcon 
                  icon={faPlus} 
                  className="action-icon" 
                  style={{ fontSize: 15 }} 
                  title="新增收藏" 
                  onClick={() => setFavForm({ visible: true, title: '', url: '', editingOriginalUrl: '' })}
                />
                <div style={{ width: 1, height: 14, background: 'var(--border)', margin: '0 4px' }}></div>
                <FontAwesomeIcon icon={faXmark} className="fav-close" onClick={() => setActiveModal('none')} title="关闭" />
              </div>
            </div>
            
            {favForm.visible && (
              <div className="fav-form" style={{ display: 'block' }}>
                <input 
                  type="text" 
                  className="fav-input" 
                  placeholder="输入网站标题" 
                  value={favForm.title}
                  onChange={e => setFavForm({...favForm, title: e.target.value})}
                  autoFocus
                />
                <input 
                  type="text" 
                  className="fav-input" 
                  placeholder="输入规范的网址 (如 https://...)" 
                  value={favForm.url}
                  onChange={e => setFavForm({...favForm, url: e.target.value})}
                />
                <div className="fav-form-btns">
                  <button className="fav-btn" onClick={() => setFavForm({...favForm, visible: false})}>取消</button>
                  <button className="fav-btn primary" onClick={saveFavorite}>保存</button>
                </div>
              </div>
            )}

            <div className="fav-list">
              {sortedFavorites.length === 0 ? (
                <div className="fav-empty">暂无收藏。点击右上角 + 号，或地址栏星号添加。</div>
              ) : (
                sortedFavorites.map((f, i) => (
                  <div key={i} className="fav-item" onClick={() => { handleGo(f.url); setActiveModal('none'); }}>
                    <div className="fav-item-info">
                      <div className="fav-title" title={f.title}>{f.title}</div>
                      <div className="fav-url" title={f.url}>{f.url}</div>
                    </div>
                    <div className="fav-actions">
                      <FontAwesomeIcon 
                        icon={copiedUrl === f.url ? faCheck : faCopyRegular} 
                        className={`fav-action-btn copy ${copiedUrl === f.url ? 'copy-success' : ''}`} 
                        title="复制链接" 
                        onClick={(e) => { e.stopPropagation(); handleCopy(f.url); }}
                      />
                      <FontAwesomeIcon 
                        icon={faPen} 
                        className="fav-action-btn edit" 
                        title="编辑" 
                        onClick={(e) => {
                          e.stopPropagation();
                          setFavForm({ visible: true, title: f.title, url: f.url, editingOriginalUrl: f.url });
                        }}
                      />
                      <FontAwesomeIcon 
                        icon={faTrash} 
                        className="fav-action-btn delete" 
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
        <div className="fav-overlay" onClick={() => setActiveModal('none')}>
          <div className="fav-modal" onClick={e => e.stopPropagation()}>
            <div className="fav-header">
              <h3><FontAwesomeIcon icon={faClockRotateLeft} style={{ color: '#3498db' }} /> 历史记录</h3>
              <FontAwesomeIcon icon={faXmark} className="fav-close" onClick={() => setActiveModal('none')} title="关闭" />
            </div>
            <div className="fav-list">
              {historyStack.length === 0 ? (
                <div className="fav-empty">暂无历史记录</div>
              ) : (
                [...historyStack].reverse().map((entry, index) => {
                  const originalIndex = historyStack.length - 1 - index;
                  const isCurrent = originalIndex === historyIdx;
                  return (
                    <div 
                      key={originalIndex} 
                      className={`fav-item ${isCurrent ? 'current-history' : ''}`}
                      onClick={() => !isCurrent && navigateToHistory(originalIndex)}
                    >
                      <div className="fav-item-info">
                        <div className="fav-title" title={entry.title}>{entry.title} {isCurrent ? '(当前)' : ''}</div>
                        <div className="fav-url" title={entry.url}>{entry.url}</div>
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