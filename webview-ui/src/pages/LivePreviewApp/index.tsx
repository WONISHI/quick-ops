import React, { useState, useEffect, useRef, useMemo } from 'react';
import { vscode } from '../../utils/vscode';
import { escapeRegExp } from '../../utils';
import UrlParser from '../../utils/UrlParser';
import styles from './index.module.css';

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
  faClockRotateLeft,
  faBroom,
  faChevronRight,
  faDatabase,
  faBoxArchive,
  faCookieBite,
  faTerminal,
  faSpinner,
} from '@fortawesome/free-solid-svg-icons';
import { faStar as faStarRegular } from '@fortawesome/free-regular-svg-icons';

import VditorApp from '../VditorApp';
import PdfPreviewApp from '../PdfPreviewApp';
import ExcelPreviewApp from '../ExcelPreviewApp';
import HtmlPreviewApp from '../HtmlPreviewApp';
import PreviewError from '../../components/PreviewError';

import WelcomePage from '../../components/WelcomePage';
import FavoriteModal from '../../components/FavoriteModal';
import HistoryModal from '../../components/HistoryModal';

interface FavoriteItem {
  url: string;
  title: string;
  timestamp: number;
  description?: string;
  logo?: string;
  isDefault?: boolean;
  source?: 'builtin' | 'user';
}

interface HistoryItem {
  url: string;
  title: string;
  timestamp: number;
  logo?: string;
}

interface PreviewErrorState {
  title: string;
  message: string;
  url: string;
}

type PreviewType = 'web' | 'md' | 'pdf' | 'excel' | 'html';

export default function LivePreviewApp() {
  const [urlInput, setUrlInput] = useState('');
  const [frameUrl, setFrameUrl] = useState('');

  const [proxyPort, setProxyPort] = useState<number>(0);

  const [previewType, setPreviewType] = useState<PreviewType>('web');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<PreviewErrorState | null>(null);

  const [loadingProgress, setLoadingProgress] = useState(0);
  const [showProgress, setShowProgress] = useState(false);
  const progressTimerRef = useRef<number | null>(null);

  const [device, setDevice] = useState('device-responsive');
  const [isRotated, setIsRotated] = useState(false);
  const [faviconUrl, setFaviconUrl] = useState('');
  const [faviconError, setFaviconError] = useState(false);
  const [isFaviconLoading, setIsFaviconLoading] = useState(false);

  const [favorites, setFavorites] = useState<FavoriteItem[]>([]);
  const [historyStack, setHistoryStack] = useState<HistoryItem[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const isInternalNav = useRef(false);

  const [activeModal, setActiveModal] = useState<'none' | 'fav' | 'history'>('none');
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });
  const [cacheSubmenuOpen, setCacheSubmenuOpen] = useState(false);
  const [favSort, setFavSort] = useState<'time' | 'title'>('time');
  const [favForm, setFavForm] = useState({
    visible: false,
    title: '',
    url: '',
    editingOriginalUrl: '',
  });
  const [showSuggest, setShowSuggest] = useState(false);
  const [suggestIndex, setSuggestIndex] = useState(-1);
  const [copiedUrl, setCopiedUrl] = useState('');
  const [isPageLoaded, setIsPageLoaded] = useState(false);

  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const moreBtnRef = useRef<HTMLButtonElement>(null);
  const suggestBoxRef = useRef<HTMLDivElement>(null);
  const cacheMenuTimer = useRef<any>(null);
  const previewLoadTimerRef = useRef<number | null>(null);

  const previewRequestIdRef = useRef(0);
  const pageLoadedRef = useRef(false);
  const faviconResolvedRef = useRef(false);

  // 🌟 新增：控制虚拟进度条的动画逻辑
  useEffect(() => {
    if (previewLoading) {
      setShowProgress(true);
      setLoadingProgress(15); // 起步 15%

      if (progressTimerRef.current) window.clearInterval(progressTimerRef.current);

      progressTimerRef.current = window.setInterval(() => {
        setLoadingProgress((prev) => {
          if (prev >= 92) return 92;
          const increment = prev < 50 ? 10 : prev < 80 ? 4 : 1;
          return prev + increment;
        });
      }, 300);
    } else {
      // 加载结束（成功或失败）
      if (progressTimerRef.current) {
        window.clearInterval(progressTimerRef.current);
        progressTimerRef.current = null;
      }

      setLoadingProgress(100);

      const hideTimer = window.setTimeout(() => {
        setShowProgress(false);
        window.setTimeout(() => setLoadingProgress(0), 300);
      }, 400);

      return () => window.clearTimeout(hideTimer);
    }
  }, [previewLoading]);

  const normalizeFavoriteUrl = (url: string) => {
    return (url || '').trim().replace(/\/+$/, '');
  };

  const clearPreviewLoadTimer = () => {
    if (previewLoadTimerRef.current) {
      window.clearTimeout(previewLoadTimerRef.current);
      previewLoadTimerRef.current = null;
    }
  };

  const getFavoriteByUrl = (url: string) => {
    const targetUrl = normalizeFavoriteUrl(url);
    if (!targetUrl) return undefined;

    return favorites.find((item) => normalizeFavoriteUrl(item.url) === targetUrl);
  };

  const getKnownLogoByUrl = (url: string) => {
    const favorite = getFavoriteByUrl(url);
    if (favorite?.logo) return favorite.logo;

    if (normalizeFavoriteUrl(url) === normalizeFavoriteUrl(frameUrl) && faviconUrl && !faviconError) {
      return faviconUrl;
    }

    return '';
  };

  const activeDefaultFavorite = useMemo(() => {
    const targetUrl = normalizeFavoriteUrl(frameUrl || urlInput);
    if (!targetUrl) return undefined;

    return favorites.find((item) => {
      return item.isDefault && item.logo && normalizeFavoriteUrl(item.url) === targetUrl;
    });
  }, [favorites, frameUrl, urlInput]);

  const isDefaultFavoriteUrl = (url: string) => {
    const targetUrl = normalizeFavoriteUrl(url);
    if (!targetUrl) return false;

    return favorites.some((item) => item.isDefault && normalizeFavoriteUrl(item.url) === targetUrl);
  };

  const updateHistoryLogo = (url: string, logo: string) => {
    if (!url || !logo) return;

    const targetUrl = normalizeFavoriteUrl(url);

    setHistoryStack((prev) => {
      return prev.map((item) => {
        if (normalizeFavoriteUrl(item.url) !== targetUrl) return item;
        if (item.logo) return item;

        return {
          ...item,
          logo,
        };
      });
    });
  };

  const updateCurrentHistoryTitle = (title: string) => {
    setHistoryStack((prev) => {
      const next = [...prev];

      if (next[historyIdx]) {
        next[historyIdx].title = title || next[historyIdx].url;
      }

      return next;
    });
  };

  const updateFavicon = (urlStr: string, options?: { onResolved?: (logo: string) => void }) => {
    if (!urlStr) {
      setFaviconUrl('');
      setFaviconError(false);
      setIsFaviconLoading(false);
      return;
    }

    const favorite = getFavoriteByUrl(urlStr);

    if (favorite?.logo) {
      setFaviconUrl(favorite.logo);
      setFaviconError(false);
      setIsFaviconLoading(false);
      updateHistoryLogo(urlStr, favorite.logo);
      options?.onResolved?.(favorite.logo);
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
        setFaviconError(false);
        setIsFaviconLoading(false);
        updateHistoryLogo(urlStr, targetIconUrl);
        options?.onResolved?.(targetIconUrl);
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

  const showPreviewErrorByRequest = (requestId: number, url: string, title: string, message: string) => {
    if (previewRequestIdRef.current !== requestId) return;
    if (pageLoadedRef.current) return;

    clearPreviewLoadTimer();

    setPreviewLoading(false);
    setIsPageLoaded(false);

    setPreviewError({
      title,
      message,
      url,
    });
  };

  const startWebPreviewGuard = (url: string) => {
    const requestId = previewRequestIdRef.current + 1;

    previewRequestIdRef.current = requestId;
    pageLoadedRef.current = false;
    faviconResolvedRef.current = false;

    setIsPageLoaded(false);
    setPreviewLoading(true);
    setPreviewError(null);

    clearPreviewLoadTimer();

    const isDefaultBookmark = isDefaultFavoriteUrl(url);

    if (isDefaultBookmark) {
      updateFavicon(url);

      previewLoadTimerRef.current = window.setTimeout(() => {
        showPreviewErrorByRequest(
          requestId,
          url,
          '页面加载超时',
          '该地址是默认书签，已等待 60 秒仍未完成加载。目标网站可能禁止 iframe 嵌入，建议使用外部浏览器打开。'
        );
      }, 60000);

      return;
    }

    previewLoadTimerRef.current = window.setTimeout(() => {
      if (previewRequestIdRef.current !== requestId) return;
      if (pageLoadedRef.current) return;
      if (faviconResolvedRef.current) return;

      showPreviewErrorByRequest(
        requestId,
        url,
        '页面加载失败',
        '60 秒内没有成功解析到网站图标。可能是地址错误、网络异常，或者目标网站无法访问。'
      );
    }, 60000);

    updateFavicon(url, {
      onResolved: () => {
        if (previewRequestIdRef.current !== requestId) return;
        if (pageLoadedRef.current) return;

        faviconResolvedRef.current = true;

        clearPreviewLoadTimer();

        previewLoadTimerRef.current = window.setTimeout(() => {
          showPreviewErrorByRequest(
            requestId,
            url,
            '页面加载超时',
            '已成功解析到网站图标，但页面仍未完成加载。目标网站可能禁止 iframe 嵌入，建议使用外部浏览器打开。'
          );
        }, 10000);
      },
    });
  };

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;

      if (message.type === 'init') {
        if (message.proxyPort) setProxyPort(message.proxyPort);

        if (message.device) setDevice(message.device);

        if (typeof message.url === 'string' && message.url.trim()) {
          const initUrl = message.url.trim();

          setUrlInput(initUrl);
          loadPreviewTarget(initUrl);
          pushHistory(initUrl, initUrl);
        }

        vscode?.postMessage({ type: 'reqSyncFavorites' });
      } else if (message.type === 'syncFavorites') {
        setFavorites(message.favorites || []);
      }
      else if (message.type === 'inner-nav') {
        const { url, isSpa } = message;
        if (isSpa) {
          setUrlInput(url);
          vscode?.postMessage({ type: 'saveUrl', url });
          pushHistory(url, url);
        } else {
          handleGo(url);
        }
      } else if (message.type === 'openExternalBrowser') {
        vscode?.postMessage({ type: 'openExternalBrowser', url: message.url });
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

    vscode?.postMessage({ type: 'ready' });

    return () => {
      window.removeEventListener('message', handleMessage);
      window.removeEventListener('click', handleClickOutside);
      clearPreviewLoadTimer();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleIframeLoad = () => {
    if (frameUrl === 'about:blank') return;

    pageLoadedRef.current = true;
    setIsPageLoaded(true);

    clearPreviewLoadTimer();
    setPreviewLoading(false); // 这里触发 false，上方的 useEffect 就会自动把进度条拉满然后隐藏
    setPreviewError(null);

    if (!iframeRef.current || historyIdx < 0 || previewType !== 'web') return;

    const fallbackTitle = urlInput || frameUrl;

    try {
      const doc = iframeRef.current.contentDocument || iframeRef.current.contentWindow?.document;
      updateCurrentHistoryTitle(doc?.title || fallbackTitle);
    } catch {
      updateCurrentHistoryTitle(fallbackTitle);
    }
  };

  const handleIframeError = () => {
    pageLoadedRef.current = false;
    setIsPageLoaded(false);

    clearPreviewLoadTimer();
    setPreviewLoading(false);

    setPreviewError({
      title: '页面加载失败',
      message: '当前页面无法在 iframe 中加载。可能是地址错误、网络异常。',
      url: frameUrl,
    });
  };

  const pushHistory = (url: string, defaultTitle: string) => {
    if (isInternalNav.current) {
      isInternalNav.current = false;
      return;
    }

    setHistoryStack((prev) => {
      if (historyIdx > -1 && prev[historyIdx]?.url === url) return prev;

      const nextStack = prev.slice(0, historyIdx + 1);
      const logo = getKnownLogoByUrl(url);

      nextStack.push({
        url,
        title: defaultTitle || url,
        timestamp: Date.now(),
        logo,
      });

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

  const getPreviewTypeByUrl = (url: string): PreviewType => {
    if (!UrlParser.isAbsolutePath(url)) return 'web';

    const lower = url.toLowerCase();

    if (lower.endsWith('.md')) return 'md';
    if (lower.endsWith('.pdf')) return 'pdf';
    if (lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.csv')) return 'excel';
    if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html';

    return 'web';
  };

  const loadPreviewTarget = (url: string) => {
    const pType = getPreviewTypeByUrl(url);

    setPreviewType(pType);
    setPreviewError(null);
    clearPreviewLoadTimer();

    pageLoadedRef.current = false;
    faviconResolvedRef.current = false;

    setIsPageLoaded(false);
    setFrameUrl(url);

    vscode?.postMessage({ type: 'saveUrl', url });

    if (pType === 'web') {
      startWebPreviewGuard(url);
      return;
    }

    previewRequestIdRef.current += 1;

    setPreviewLoading(false);
    setIsPageLoaded(true);

    if (pType !== 'html') {
      vscode?.postMessage({
        type: 'setPendingLocalFile',
        fsPath: url,
        fileType: pType,
      });
    }

    setFaviconUrl('');
    setFaviconError(false);
    setIsFaviconLoading(false);
  };

  const handleGo = (forceUrl?: string) => {
    const rawUrl = forceUrl !== undefined ? forceUrl : urlInput;
    const finalUrl = UrlParser.parse(rawUrl);

    setShowSuggest(false);

    if (!finalUrl) {
      clearPreviewLoadTimer();

      previewRequestIdRef.current += 1;
      pageLoadedRef.current = false;
      faviconResolvedRef.current = false;

      setFrameUrl('');
      setPreviewType('web');
      setPreviewLoading(false);
      setPreviewError(null);
      setIsPageLoaded(false);

      updateFavicon('');
      vscode?.postMessage({ type: 'saveUrl', url: '' });
      return;
    }

    setUrlInput(finalUrl);
    loadPreviewTarget(finalUrl);
    pushHistory(finalUrl, finalUrl);
  };

  const suggestions = useMemo(() => {
    const query = urlInput.trim().toLowerCase();

    if (!query || favorites.length === 0) return [];

    return favorites.filter((f) => {
      return (
        f.title.toLowerCase().includes(query) ||
        f.url.toLowerCase().includes(query) ||
        (f.description || '').toLowerCase().includes(query)
      );
    });
  }, [urlInput, favorites]);

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

    setPreviewError(null);
    clearPreviewLoadTimer();

    pageLoadedRef.current = false;
    faviconResolvedRef.current = false;
    setIsPageLoaded(false);

    if (previewType !== 'web') {
      if (previewType !== 'html') {
        vscode?.postMessage({
          type: 'setPendingLocalFile',
          fsPath: temp,
          fileType: previewType,
        });
      }

      setFrameUrl('');

      window.setTimeout(() => {
        setFrameUrl(temp);
        setIsPageLoaded(true);
      }, 50);

      setMenuOpen(false);
      return;
    }

    setFrameUrl('about:blank');

    window.setTimeout(() => {
      setFrameUrl(temp);
      startWebPreviewGuard(temp);
    }, 50);

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

  const isFav = favorites.some((f) => normalizeFavoriteUrl(f.url) === normalizeFavoriteUrl(frameUrl));

  const canToggleFavorite = !!frameUrl && previewType === 'web' && isPageLoaded && !previewLoading && !previewError;

  const toggleFavorite = () => {
    if (!canToggleFavorite) return;

    const currentHistory = historyIdx >= 0 ? historyStack[historyIdx] : undefined;
    const title = currentHistory?.title || urlInput || frameUrl;
    const logo = activeDefaultFavorite?.logo || faviconUrl || '';

    vscode?.postMessage({ type: 'toggleFavorite', url: frameUrl, title, logo });
  };

  const renderHighlighted = (text: string) => {
    const query = urlInput.trim();

    if (!query) return text;

    const parts = text.split(new RegExp(`(${escapeRegExp(query)})`, 'gi'));

    return parts.map((part, i) =>
      part.toLowerCase() === query.toLowerCase() ? (
        <span key={i} className={styles['highlight-match']}>
          {part}
        </span>
      ) : (
        part
      )
    );
  };

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
      if (previewType !== 'web' && previewType !== 'html') throw new Error('Not a web preview');

      const win = iframeRef.current?.contentWindow;

      if (!win) throw new Error('No Access');

      if (type === 'local') {
        win.localStorage.clear();
      } else if (type === 'session') {
        win.sessionStorage.clear();
      } else if (type === 'cookie') {
        const cookies = win.document.cookie.split(';');

        for (let i = 0; i < cookies.length; i++) {
          const cookie = cookies[i];
          const eqPos = cookie.indexOf('=');
          const name = eqPos > -1 ? cookie.substring(0, eqPos) : cookie;
          win.document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/';
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
    window.setTimeout(() => setCopiedUrl(''), 1500);
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

    const newFavs = [...favorites];

    if (favForm.editingOriginalUrl) {
      const index = newFavs.findIndex((f) => f.url === favForm.editingOriginalUrl && !f.isDefault);

      if (index > -1) {
        if (u !== favForm.editingOriginalUrl && newFavs.some((f) => normalizeFavoriteUrl(f.url) === normalizeFavoriteUrl(u))) {
          return vscode?.postMessage({ type: 'showError', message: '该链接已存在！' });
        }

        newFavs[index] = {
          ...newFavs[index],
          title: t,
          url: u,
          logo: newFavs[index].logo || '',
          isDefault: false,
          source: 'user',
        };
      }
    } else {
      if (newFavs.some((f) => normalizeFavoriteUrl(f.url) === normalizeFavoriteUrl(u))) {
        return vscode?.postMessage({ type: 'showError', message: '该链接已存在！' });
      }

      newFavs.push({
        url: u,
        title: t,
        timestamp: Date.now(),
        logo: getKnownLogoByUrl(u),
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

  const renderPreviewLoadingMask = () => {
    if (!previewLoading) return null;

    return (
      <div className={styles['preview-loading-mask']}>
        <div className={styles['preview-loading-bg']} />
        <FontAwesomeIcon icon={faSpinner} spin className={styles['preview-loading-icon']} />
      </div>
    );
  };

  const getProxyPreviewUrl = (rawUrl: string, port: number) => {
    try {
      const targetUrl = new URL(rawUrl);
      const proxyOrigin = `http://127.0.0.1:${port}`;

      /**
       * 关键：
       * iframe 入口必须保留目标页面 pathname。
       *
       * 例如：
       *
       * https://www.antdv.com/components/overview-cn/
       *
       * 应该变成：
       *
       * http://127.0.0.1:port/components/overview-cn/?url=https%3A%2F%2Fwww.antdv.com%2Fcomponents%2Foverview-cn%2F
       *
       * 而不是：
       *
       * http://127.0.0.1:port/?url=https%3A%2F%2Fwww.antdv.com%2Fcomponents%2Foverview-cn%2F
       *
       * 否则 Vue / VitePress 客户端路由看到的是 /，
       * SSR DOM 与客户端路由不一致，容易出现 nextSibling 为 null。
       */
      const proxyUrl = new URL(targetUrl.pathname || '/', proxyOrigin);

      proxyUrl.searchParams.set('url', targetUrl.href);

      /**
       * 保留 hash。
       */
      if (targetUrl.hash) {
        proxyUrl.hash = targetUrl.hash;
      }

      return proxyUrl.toString();
    } catch {
      return `http://127.0.0.1:${port}/?url=${encodeURIComponent(rawUrl)}`;
    }
  };

  const getRenderIframeSrc = () => {
    if (!frameUrl || frameUrl === 'about:blank') return frameUrl;
    
    if (previewType === 'web' && proxyPort > 0) {
      return getProxyPreviewUrl(frameUrl, proxyPort);
    }

    return frameUrl;
  };

  return (
    <div className={styles['live-preview-container']}>
      <div className={styles['toolbar']}>
        <button className={styles['icon-btn']} disabled={historyIdx <= 0} onClick={() => navigateToHistory(historyIdx - 1)} title="后退">
          <FontAwesomeIcon icon={faArrowLeft} />
        </button>

        <button className={styles['icon-btn']} onClick={handleRefresh} title="刷新页面">
          <FontAwesomeIcon icon={faRotateRight} />
        </button>

        <div className={styles['address-bar-wrapper']}>
          {urlInput.trim() ? (
            activeDefaultFavorite?.logo ? (
              <img
                src={activeDefaultFavorite.logo}
                className={styles['favicon-img']}
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                }}
              />
            ) : isFaviconLoading ? (
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
            onChange={(e) => {
              setUrlInput(e.target.value);
              setShowSuggest(true);
              setSuggestIndex(-1);
            }}
            onKeyDown={handleKeyDown}
            onFocus={() => {
              if (urlInput.trim()) setShowSuggest(true);
            }}
            onDoubleClick={(e) => {
              e.currentTarget.select();
            }}
            placeholder="输入网址、本地绝对路径 或 搜索内容"
            spellCheck="false"
            autoComplete="off"
          />

          {urlInput && (
            <FontAwesomeIcon
              icon={faXmark}
              className={styles['action-icon']}
              onClick={() => {
                setUrlInput('');
                setShowSuggest(false);
              }}
              title="清除"
            />
          )}

          <button
            type="button"
            className={`${styles['star-action-btn']} ${isFav ? styles['fav-active'] : ''}`}
            disabled={!canToggleFavorite}
            onClick={toggleFavorite}
            title={canToggleFavorite ? '添加/取消收藏 (跨工作区同步)' : previewLoading ? '页面加载中，暂不能添加收藏' : '页面加载成功后才能添加收藏'}
            aria-disabled={!canToggleFavorite}
          >
            <FontAwesomeIcon icon={isFav ? faStarSolid : faStarRegular} />
          </button>

          {showSuggest && suggestions.length > 0 && (
            <div className={styles['suggest-box']} ref={suggestBoxRef}>
              {suggestions.map((item, index) => (
                <div
                  key={`${item.url}-${index}`}
                  className={`${styles['suggest-item']} ${index === suggestIndex ? styles['selected'] : ''}`}
                  onMouseEnter={() => setSuggestIndex(index)}
                  onClick={() => {
                    handleGo(item.url);
                  }}
                >
                  <div className={styles['suggest-logo-wrap']}>
                    {item.logo ? (
                      <img
                        className={styles['suggest-logo']}
                        src={item.logo}
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                        }}
                      />
                    ) : (
                      <FontAwesomeIcon icon={faGlobe} className={styles['suggest-logo-placeholder']} />
                    )}
                  </div>

                  <div className={styles['suggest-content']}>
                    <div className={styles['suggest-title-row']}>
                      <div className={styles['suggest-title']}>{renderHighlighted(item.title)}</div>
                      {item.isDefault && <span className={styles['suggest-default-tag']}>默认</span>}
                    </div>

                    {item.description && <div className={styles['suggest-description']}>{renderHighlighted(item.description)}</div>}

                    <div className={styles['suggest-url']}>{renderHighlighted(item.url)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <button className={styles['icon-btn']} onClick={() => handleGo()} title="访问 / 搜索">
          <FontAwesomeIcon icon={faArrowRight} />
        </button>

        <div className={styles['divider']} />

        <select className={styles['vscode-select']} value={device} onChange={handleDeviceChange} title="选择预览设备" disabled={previewType !== 'web' && previewType !== 'html'}>
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

        <div className={styles['divider']} />

        <button
          className={styles['icon-btn']}
          disabled={!urlInput.trim() || (previewType !== 'web' && previewType !== 'html')}
          onClick={() => vscode?.postMessage({ type: 'openExternalBrowser', url: frameUrl || urlInput })}
          title="在外部默认浏览器中打开"
        >
          <FontAwesomeIcon icon={faArrowUpRightFromSquare} />
        </button>

        <button className={styles['icon-btn']} ref={moreBtnRef} onClick={openContextMenu} title="更多操作">
          <FontAwesomeIcon icon={faEllipsis} />
        </button>
      </div>

      {menuOpen && (
        <div className={styles['context-menu']} style={{ left: menuPos.x, top: menuPos.y }}>
          <div
            className={styles['menu-item']}
            onClick={() => {
              handleRefresh();
              setMenuOpen(false);
            }}
          >
            <FontAwesomeIcon icon={faRotateRight} className={styles['menu-icon']} /> 刷新页面
          </div>

          <div
            className={styles['menu-item']}
            onClick={() => {
              setActiveModal('fav');
              setMenuOpen(false);
            }}
          >
            <FontAwesomeIcon icon={faStarSolid} className={`${styles['menu-icon']} ${styles['fav-star']}`} /> 打开收藏夹
          </div>

          <div
            className={styles['menu-item']}
            onClick={() => {
              setActiveModal('history');
              setMenuOpen(false);
            }}
          >
            <FontAwesomeIcon icon={faClockRotateLeft} className={styles['menu-icon']} /> 历史记录
          </div>

          <div className={styles['menu-divider']} />

          <div
            className={`${styles['menu-item']} ${styles['has-submenu']}`}
            onMouseEnter={() => {
              clearTimeout(cacheMenuTimer.current);
              setCacheSubmenuOpen(true);
            }}
            onMouseLeave={() => {
              cacheMenuTimer.current = window.setTimeout(() => setCacheSubmenuOpen(false), 300);
            }}
          >
            <FontAwesomeIcon icon={faBroom} className={styles['menu-icon']} /> 清理页面缓存
            <FontAwesomeIcon icon={faChevronRight} className={styles['menu-chevron']} />

            {cacheSubmenuOpen && (
              <div className={styles['submenu']}>
                <div className={styles['menu-item']} onClick={() => handleCacheClear('local')}>
                  <FontAwesomeIcon icon={faDatabase} className={styles['menu-icon']} /> 清理 LocalStorage
                </div>

                <div className={styles['menu-item']} onClick={() => handleCacheClear('session')}>
                  <FontAwesomeIcon icon={faBoxArchive} className={styles['menu-icon']} /> 清理 SessionStorage
                </div>

                <div className={styles['menu-item']} onClick={() => handleCacheClear('cookie')}>
                  <FontAwesomeIcon icon={faCookieBite} className={styles['menu-icon']} /> 清理 Cookie 数据
                </div>
              </div>
            )}
          </div>

          <div className={styles['menu-divider']} />

          <div
            className={styles['menu-item']}
            onClick={() => {
              vscode?.postMessage({ type: 'openDevTools' });
              setMenuOpen(false);
            }}
          >
            <FontAwesomeIcon icon={faTerminal} className={styles['menu-icon']} /> 开发者工具
          </div>
        </div>
      )}

      <div
        className={`${styles['preview-container']} ${device === 'device-responsive' && previewType !== 'md' && previewType !== 'pdf' && previewType !== 'excel' ? styles['no-padding'] : ''
          }`}
        style={{ position: 'relative' }}
      >
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: '2px',
            backgroundColor: 'transparent',
            zIndex: 9999, // 确保浮在 iframe 和其他元素上方
            pointerEvents: 'none',
            opacity: showProgress ? 1 : 0,
            transition: showProgress ? 'opacity 0.2s ease-in' : 'opacity 0.4s ease-out',
          }}
        >
          <div
            style={{
              height: '100%',
              backgroundColor: 'var(--vscode-progressBar-background, #007acc)', // 使用 VS Code 原生进度条蓝色
              width: `${loadingProgress}%`,
              transition: loadingProgress === 0 ? 'none' : 'width 0.3s ease',
              boxShadow: '0 0 10px var(--vscode-progressBar-background, #007acc), 0 0 5px var(--vscode-progressBar-background, #007acc)',
            }}
          />
        </div>

        {/* 原有转圈 Mask：可以与上方进度条共存，如果不喜欢可以将这行删掉 */}
        {renderPreviewLoadingMask()}

        {!frameUrl ? (
          <WelcomePage onQuickOpen={handleGo} />
        ) : previewType === 'md' ? (
          <VditorApp key={frameUrl} />
        ) : previewType === 'pdf' ? (
          <PdfPreviewApp key={frameUrl} initialScale={0.8} />
        ) : previewType === 'excel' ? (
          <ExcelPreviewApp key={frameUrl} />
        ) : previewType === 'html' ? (
          <div id="deviceWrapper" className={`${styles[device] || device} ${isRotated ? styles['rotated'] : ''}`}>
            <HtmlPreviewApp
              key={frameUrl}
              fsPath={frameUrl}
              iframeRef={iframeRef}
              onTitleChange={(title) => {
                updateCurrentHistoryTitle(title);
              }}
            />
          </div>
        ) : previewError ? (
          <PreviewError
            url={previewError.url}
            title={previewError.title}
            message={previewError.message}
            onRetry={() => {
              const currentUrl = previewError.url;
              setPreviewError(null);
              loadPreviewTarget(currentUrl);
            }}
            onOpenExternal={() => {
              vscode?.postMessage({
                type: 'openExternalBrowser',
                url: previewError.url,
              });
            }}
          />
        ) : (
          <div id="deviceWrapper" className={`${styles[device] || device} ${isRotated ? styles['rotated'] : ''}`}>
            <iframe
              ref={iframeRef}
              src={getRenderIframeSrc()}
              className={styles['fromPage']}
              title="preview"
              onLoad={handleIframeLoad}
              onError={handleIframeError}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-presentation"
            />
          </div>
        )}
      </div>

      <FavoriteModal
        visible={activeModal === 'fav'}
        sortedFavorites={sortedFavorites}
        favSort={favSort}
        favForm={favForm}
        copiedUrl={copiedUrl}
        setFavSort={setFavSort}
        setFavForm={setFavForm}
        onClose={() => setActiveModal('none')}
        onOpenUrl={(url) => {
          handleGo(url);
          setActiveModal('none');
        }}
        onCopy={handleCopy}
        onSaveFavorite={saveFavorite}
        onDeleteFavorite={deleteFavorite}
      />

      <HistoryModal
        visible={activeModal === 'history'}
        historyStack={historyStack}
        historyIdx={historyIdx}
        getKnownLogoByUrl={getKnownLogoByUrl}
        onClose={() => setActiveModal('none')}
        onNavigateToHistory={navigateToHistory}
      />
    </div>
  );
}