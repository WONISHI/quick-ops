import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { vscode } from '../../utils/vscode';
import UrlParser from '../../utils/UrlParser';
import styles from './index.module.css';

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowLeft, faRotateRight, faGlobe, faXmark, faStar as faStarSolid, faArrowRight, faRotate, faArrowUpRightFromSquare, faEllipsis, faSpinner } from '@fortawesome/free-solid-svg-icons';
import { faStar as faStarRegular } from '@fortawesome/free-regular-svg-icons';

import VditorApp from '../VditorApp';
import PdfPreviewApp from '../PdfPreviewApp';
import ExcelPreviewApp from '../ExcelPreviewApp';
import HtmlPreviewApp from '../HtmlPreviewApp';
import PreviewError from '../../components/PreviewError';

import WelcomePage from '../../components/WelcomePage';
import FavoriteModal from '../../components/FavoriteModal';
import HistoryModal from '../../components/HistoryModal';
import SuggestBox from '../../components/SuggestBox';
import LivePreviewContextMenu from '../../components/LivePreviewContextMenu';

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

interface BrowserFrameState {
  data: string;
  width: number;
  height: number;
}

interface BrowserSurfaceProps {
  frame: BrowserFrameState | null;
  loading: boolean;
  onViewportChange: (width: number, height: number) => void;
}

function BrowserSurface({ frame, loading, onViewportChange }: BrowserSurfaceProps) {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const lastViewportRef = useRef({ width: 0, height: 0 });
  const resizeRafRef = useRef<number | null>(null);
  const resizeTimerRef = useRef<number | null>(null);
  const middleDragRef = useRef({
    active: false,
    lastX: 0,
    lastY: 0,
  });
  const [isMiddleDragging, setIsMiddleDragging] = useState(false);

  const notifyViewportSize = useCallback(() => {
    const target = surfaceRef.current;

    if (!target) return;

    const rect = target.getBoundingClientRect();
    const width = Math.max(320, Math.floor(rect.width));
    const height = Math.max(240, Math.floor(rect.height));

    if (lastViewportRef.current.width === width && lastViewportRef.current.height === height) {
      return;
    }

    lastViewportRef.current = { width, height };
    onViewportChange(width, height);
  }, [onViewportChange]);

  useEffect(() => {
    const target = surfaceRef.current;

    if (!target) return;

    const scheduleNotify = () => {
      if (resizeRafRef.current) {
        window.cancelAnimationFrame(resizeRafRef.current);
      }

      resizeRafRef.current = window.requestAnimationFrame(() => {
        resizeRafRef.current = null;
        notifyViewportSize();
      });
    };

    const observer = new ResizeObserver(() => {
      scheduleNotify();

      if (resizeTimerRef.current) {
        window.clearTimeout(resizeTimerRef.current);
      }

      resizeTimerRef.current = window.setTimeout(() => {
        resizeTimerRef.current = null;
        notifyViewportSize();
      }, 360);
    });

    observer.observe(target);

    if (target.parentElement) {
      observer.observe(target.parentElement);
    }

    const handleWindowResize = () => scheduleNotify();

    window.addEventListener('resize', handleWindowResize);
    window.visualViewport?.addEventListener('resize', handleWindowResize);

    scheduleNotify();

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', handleWindowResize);
      window.visualViewport?.removeEventListener('resize', handleWindowResize);

      if (resizeRafRef.current) {
        window.cancelAnimationFrame(resizeRafRef.current);
        resizeRafRef.current = null;
      }

      if (resizeTimerRef.current) {
        window.clearTimeout(resizeTimerRef.current);
        resizeTimerRef.current = null;
      }
    };
  }, [notifyViewportSize]);

  const getMouseButton = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button === 2) return 'right';
    if (event.button === 1) return 'middle';
    return 'left';
  };

  const getPressedButtons = (event: React.MouseEvent<HTMLDivElement>, eventType: 'mouseMoved' | 'mousePressed' | 'mouseReleased') => {
    if (eventType === 'mouseReleased') return 0;
    if (eventType === 'mousePressed') {
      if (event.button === 2) return 2;
      if (event.button === 1) return 4;
      return 1;
    }

    return event.buttons || 0;
  };

  const getBrowserPoint = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const rawX = event.clientX - rect.left;
    const rawY = event.clientY - rect.top;
    const viewportWidth = frame?.width || lastViewportRef.current.width || rect.width;
    const viewportHeight = frame?.height || lastViewportRef.current.height || rect.height;
    const scaleX = rect.width > 0 ? viewportWidth / rect.width : 1;
    const scaleY = rect.height > 0 ? viewportHeight / rect.height : 1;

    return {
      x: Math.max(0, Math.round(rawX * scaleX)),
      y: Math.max(0, Math.round(rawY * scaleY)),
    };
  };

  const getBrowserPointByClient = useCallback((clientX: number, clientY: number) => {
    const target = surfaceRef.current;

    if (!target) {
      return {
        x: 0,
        y: 0,
      };
    }

    const rect = target.getBoundingClientRect();
    const rawX = clientX - rect.left;
    const rawY = clientY - rect.top;
    const viewportWidth = frame?.width || lastViewportRef.current.width || rect.width;
    const viewportHeight = frame?.height || lastViewportRef.current.height || rect.height;
    const scaleX = rect.width > 0 ? viewportWidth / rect.width : 1;
    const scaleY = rect.height > 0 ? viewportHeight / rect.height : 1;

    return {
      x: Math.max(0, Math.min(viewportWidth, Math.round(rawX * scaleX))),
      y: Math.max(0, Math.min(viewportHeight, Math.round(rawY * scaleY))),
    };
  }, [frame?.height, frame?.width]);

  const sendPanWheel = useCallback((clientX: number, clientY: number, deltaX: number, deltaY: number) => {
    const point = getBrowserPointByClient(clientX, clientY);

    vscode?.postMessage({
      type: 'browserInput',
      inputType: 'wheel',
      x: point.x,
      y: point.y,
      deltaX,
      deltaY,
    });
  }, [getBrowserPointByClient]);

  const stopMiddleDrag = useCallback(() => {
    if (!middleDragRef.current.active) return;

    middleDragRef.current.active = false;
    setIsMiddleDragging(false);
  }, []);

  useEffect(() => {
    const handleWindowMouseMove = (event: MouseEvent) => {
      if (!middleDragRef.current.active) return;

      event.preventDefault();

      const dx = event.clientX - middleDragRef.current.lastX;
      const dy = event.clientY - middleDragRef.current.lastY;

      middleDragRef.current.lastX = event.clientX;
      middleDragRef.current.lastY = event.clientY;

      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;

      sendPanWheel(event.clientX, event.clientY, -dx, -dy);
    };

    const handleWindowMouseUp = () => {
      stopMiddleDrag();
    };

    const handleWindowBlur = () => {
      stopMiddleDrag();
    };

    window.addEventListener('mousemove', handleWindowMouseMove, { passive: false });
    window.addEventListener('mouseup', handleWindowMouseUp);
    window.addEventListener('blur', handleWindowBlur);

    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [sendPanWheel, stopMiddleDrag]);

  const sendMouse = (event: React.MouseEvent<HTMLDivElement>, type: 'mouseMoved' | 'mousePressed' | 'mouseReleased') => {
    event.preventDefault();

    const point = getBrowserPoint(event);

    vscode?.postMessage({
      type: 'browserInput',
      inputType: 'mouse',
      eventType: type,
      x: point.x,
      y: point.y,
      button: type === 'mouseMoved' ? 'none' : getMouseButton(event),
      buttons: getPressedButtons(event, type),
      clickCount: type === 'mouseMoved' ? 0 : Math.max(1, event.detail || 1),
    });
  };

  const sendWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();

    const rect = event.currentTarget.getBoundingClientRect();
    const viewportWidth = frame?.width || lastViewportRef.current.width || rect.width;
    const viewportHeight = frame?.height || lastViewportRef.current.height || rect.height;
    const scaleX = rect.width > 0 ? viewportWidth / rect.width : 1;
    const scaleY = rect.height > 0 ? viewportHeight / rect.height : 1;

    vscode?.postMessage({
      type: 'browserInput',
      inputType: 'wheel',
      x: Math.max(0, Math.round((event.clientX - rect.left) * scaleX)),
      y: Math.max(0, Math.round((event.clientY - rect.top) * scaleY)),
      deltaX: event.deltaX,
      deltaY: event.deltaY,
    });
  };

  const sendKey = (event: React.KeyboardEvent<HTMLDivElement>, eventType: 'keyDown' | 'keyUp') => {
    if (eventType === 'keyDown') {
      event.preventDefault();
    }

    vscode?.postMessage({
      type: 'browserInput',
      inputType: 'keyboard',
      eventType,
      key: event.key,
      code: event.code,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
    });
  };

  return (
    <div
      ref={surfaceRef}
      className={[
        styles['browser-lite-surface'],
        isMiddleDragging ? styles['browser-lite-surface-dragging'] : '',
      ].filter(Boolean).join(' ')}
      style={{ width: '100%', height: '100%', minWidth: 0, minHeight: 0 }}
      tabIndex={0}
      onContextMenu={(event) => event.preventDefault()}
      onAuxClick={(event) => {
        if (event.button === 1) {
          event.preventDefault();
        }
      }}
      onMouseMove={(event) => {
        if (middleDragRef.current.active) {
          event.preventDefault();
          return;
        }

        sendMouse(event, 'mouseMoved');
      }}
      onMouseDown={(event) => {
        event.currentTarget.focus();

        if (event.button === 1) {
          event.preventDefault();

          middleDragRef.current = {
            active: true,
            lastX: event.clientX,
            lastY: event.clientY,
          };

          setIsMiddleDragging(true);
          return;
        }

        sendMouse(event, 'mousePressed');
      }}
      onMouseUp={(event) => {
        if (event.button === 1 || middleDragRef.current.active) {
          event.preventDefault();
          stopMiddleDrag();
          return;
        }

        sendMouse(event, 'mouseReleased');
      }}
      onMouseLeave={() => {
        if (middleDragRef.current.active) {
          stopMiddleDrag();
        }
      }}
      onWheel={sendWheel}
      onKeyDown={(event) => sendKey(event, 'keyDown')}
      onKeyUp={(event) => sendKey(event, 'keyUp')}
    >
      {frame ? (
        <img
          className={styles['browser-lite-frame']}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'fill',
            display: 'block',
            imageRendering: 'auto',
          }}
          src={`data:image/jpeg;base64,${frame.data}`}
          draggable={false}
          alt="网页预览"
        />
      ) : (
        <div className={styles['browser-lite-empty']}>
          {loading ? '正在加载网页...' : '暂无网页内容'}
        </div>
      )}
    </div>
  );
}

type PreviewType = 'web' | 'md' | 'pdf' | 'excel' | 'html';

export default function LivePreviewApp() {
  const [urlInput, setUrlInput] = useState('');
  const [frameUrl, setFrameUrl] = useState('');
  const [browserFrame, setBrowserFrame] = useState<BrowserFrameState | null>(null);

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

  const [favSort, setFavSort] = useState<'time' | 'title'>('time');
  const [favForm, setFavForm] = useState({
    visible: false,
    title: '',
    url: '',
    description: '',
    logo: '',
    editingOriginalUrl: '',
  });
  const [showSuggest, setShowSuggest] = useState(false);
  const [suggestIndex, setSuggestIndex] = useState(-1);
  const [copiedUrl, setCopiedUrl] = useState('');
  const [isPageLoaded, setIsPageLoaded] = useState(false);

  const htmlIframeRef = useRef<HTMLIFrameElement | null>(null);
  const moreBtnRef = useRef<HTMLButtonElement>(null);
  const suggestBoxRef = useRef<HTMLDivElement>(null);
  const previewLoadTimerRef = useRef<number | null>(null);

  const previewRequestIdRef = useRef(0);
  const pageLoadedRef = useRef(false);
  const faviconResolvedRef = useRef(false);
  const faviconRequestIdRef = useRef(0);

  // 控制顶部虚拟进度条：页面加载完成后直接卸载 DOM，避免残留一条线
  useEffect(() => {
    let hideTimer: number | undefined;
    let resetTimer: number | undefined;

    if (previewLoading) {
      setShowProgress(true);
      setLoadingProgress(15);

      if (progressTimerRef.current) {
        window.clearInterval(progressTimerRef.current);
      }

      progressTimerRef.current = window.setInterval(() => {
        setLoadingProgress((prev) => {
          if (prev >= 92) return 92;

          const increment = prev < 50 ? 10 : prev < 80 ? 4 : 1;

          return prev + increment;
        });
      }, 300);

      return () => {
        if (progressTimerRef.current) {
          window.clearInterval(progressTimerRef.current);
          progressTimerRef.current = null;
        }
      };
    }

    if (progressTimerRef.current) {
      window.clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }

    setLoadingProgress(100);

    hideTimer = window.setTimeout(() => {
      setShowProgress(false);

      resetTimer = window.setTimeout(() => {
        setLoadingProgress(0);
      }, 120);
    }, 180);

    return () => {
      if (hideTimer) {
        window.clearTimeout(hideTimer);
      }

      if (resetTimer) {
        window.clearTimeout(resetTimer);
      }
    };
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

  const interruptPendingWebNavigation = () => {
    if (previewType !== 'web') return;

    clearPreviewLoadTimer();
    vscode?.postMessage({ type: 'browserStopLoading' });
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

  // const activeDefaultFavorite = useMemo(() => {
  //   const targetUrl = normalizeFavoriteUrl(frameUrl || urlInput);
  //   if (!targetUrl) return undefined;

  //   return favorites.find((item) => {
  //     return item.isDefault && item.logo && normalizeFavoriteUrl(item.url) === targetUrl;
  //   });
  // }, [favorites, frameUrl, urlInput]);

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
    const faviconRequestId = faviconRequestIdRef.current + 1;

    faviconRequestIdRef.current = faviconRequestId;

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

      setFaviconUrl('');
      setIsFaviconLoading(true);
      setFaviconError(false);

      const imgLoader = new Image();
      imgLoader.src = targetIconUrl;

      imgLoader.onload = () => {
        if (faviconRequestIdRef.current !== faviconRequestId) return;

        setFaviconUrl(targetIconUrl);
        setFaviconError(false);
        setIsFaviconLoading(false);
        updateHistoryLogo(urlStr, targetIconUrl);
        options?.onResolved?.(targetIconUrl);
      };

      imgLoader.onerror = () => {
        if (faviconRequestIdRef.current !== faviconRequestId) return;

        setFaviconError(true);
        setIsFaviconLoading(false);
      };
    } catch {
      setFaviconUrl('');
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

    updateFavicon(url, {
      onResolved: () => {
        if (previewRequestIdRef.current !== requestId) return;
        if (pageLoadedRef.current) return;

        faviconResolvedRef.current = true;
      },
    });
  };

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;

      if (message.type === 'init') {
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
      } else if (message.type === 'browserFrame') {
        setBrowserFrame({
          data: message.data || '',
          width: message.width || 0,
          height: message.height || 0,
        });
      } else if (message.type === 'browserPageLoaded') {
        pageLoadedRef.current = true;
        faviconResolvedRef.current = true;
        clearPreviewLoadTimer();
        setPreviewLoading(false);
        setPreviewError(null);
        setIsPageLoaded(true);
        if (message.url) {
          setFrameUrl(message.url);
          setUrlInput(message.url);
          vscode?.postMessage({ type: 'saveUrl', url: message.url });
        }
        if (message.title) {
          updateCurrentHistoryTitle(message.title);
        }
      } else if (message.type === 'browserTitleChanged') {
        updateCurrentHistoryTitle(message.title || frameUrl || urlInput);
      } else if (message.type === 'browserUrlChanged') {
        if (message.url) {
          setFrameUrl(message.url);
          setUrlInput(message.url);
          vscode?.postMessage({ type: 'saveUrl', url: message.url });
        }
      } else if (message.type === 'browserPageError') {
        pageLoadedRef.current = false;
        clearPreviewLoadTimer();
        setPreviewLoading(false);
        setIsPageLoaded(false);
        setPreviewError({
          title: '页面加载失败',
          message: message.message || '当前页面加载失败。',
          url: message.url || frameUrl || urlInput,
        });
      } else if (message.type === 'inner-nav') {
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
      const targetNode = e.target as Node;
      const targetElement = targetNode instanceof Element ? targetNode : targetNode.parentElement;

      if (!moreBtnRef.current?.contains(targetNode)) {
        setMenuOpen(false);
      }

      const isInSuggestBox = !!suggestBoxRef.current?.contains(targetNode);
      const isInAddressBar = !!targetElement?.closest(`.${styles['address-bar-wrapper']}`);

      if (isInSuggestBox) {
        const isClickSuggestItem = !!targetElement?.closest('button, a, [role="option"], [data-suggest-item="true"]');

        if (!isClickSuggestItem) {
          setShowSuggest(false);
          setSuggestIndex(-1);
        }

        return;
      }

      if (!isInAddressBar) {
        setShowSuggest(false);
        setSuggestIndex(-1);
      }
    };

    window.addEventListener('click', handleClickOutside);

    const handleWindowBlur = () => {
      setShowSuggest(false);
      setSuggestIndex(-1);
      setMenuOpen(false);
    };

    window.addEventListener('blur', handleWindowBlur);

    vscode?.postMessage({ type: 'ready' });

    return () => {
      window.removeEventListener('message', handleMessage);
      window.removeEventListener('click', handleClickOutside);
      window.removeEventListener('blur', handleWindowBlur);
      clearPreviewLoadTimer();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps


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
      interruptPendingWebNavigation();
      setBrowserFrame(null);
      startWebPreviewGuard(url);
      vscode?.postMessage({ type: 'browserNavigate', url });
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
      vscode?.postMessage({ type: 'browserStopLoading' });
      vscode?.postMessage({ type: 'browserStop' });
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
      return f.title.toLowerCase().includes(query) || f.url.toLowerCase().includes(query) || (f.description || '').toLowerCase().includes(query);
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

  const resetPreviewState = () => {
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
    vscode?.postMessage({ type: 'browserStopLoading' });
    vscode?.postMessage({ type: 'browserStop' });
    vscode?.postMessage({ type: 'saveUrl', url: '' });
  };

  const handleRefresh = () => {
    const inputValue = urlInput.trim();
    const fallbackUrl = frameUrl && frameUrl !== 'about:blank' ? frameUrl : historyIdx > -1 ? historyStack[historyIdx]?.url || '' : '';

    if (!inputValue && fallbackUrl) {
      setUrlInput(fallbackUrl);
    }

    const refreshValue = inputValue || fallbackUrl;

    if (!refreshValue) {
      resetPreviewState();
      setMenuOpen(false);
      return;
    }

    const inputTarget = UrlParser.parse(refreshValue);

    if (!inputTarget) {
      if (!inputValue && fallbackUrl) {
        setUrlInput(fallbackUrl);
      } else {
        resetPreviewState();
      }

      setMenuOpen(false);
      return;
    }

    const currentFrameUrl = normalizeFavoriteUrl(frameUrl);
    const currentInputUrl = normalizeFavoriteUrl(inputTarget);
    const temp = currentInputUrl === currentFrameUrl ? frameUrl : inputTarget;
    const nextPreviewType = getPreviewTypeByUrl(temp);

    if (urlInput !== temp) {
      setUrlInput(temp);
    }

    setPreviewError(null);
    clearPreviewLoadTimer();

    pageLoadedRef.current = false;
    faviconResolvedRef.current = false;
    setIsPageLoaded(false);

    if (nextPreviewType !== 'web') {
      setPreviewType(nextPreviewType);

      if (nextPreviewType !== 'html') {
        vscode?.postMessage({
          type: 'setPendingLocalFile',
          fsPath: temp,
          fileType: nextPreviewType,
        });
      }

      setFrameUrl('');

      window.setTimeout(() => {
        setFrameUrl(temp);
        setIsPageLoaded(true);
        vscode?.postMessage({ type: 'saveUrl', url: temp });
      }, 50);

      setMenuOpen(false);
      return;
    }

    setPreviewType('web');
    setFrameUrl(temp);
    interruptPendingWebNavigation();
    setBrowserFrame(null);
    vscode?.postMessage({ type: 'saveUrl', url: temp });
    startWebPreviewGuard(temp);
    vscode?.postMessage({ type: 'browserRefresh', url: temp });

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

  const parsedUrlInput = useMemo(() => {
    const value = urlInput.trim();

    if (!value) return '';

    return UrlParser.parse(value) || '';
  }, [urlInput]);

  const activeAddressFavorite = useMemo(() => {
    const targetUrl = normalizeFavoriteUrl(parsedUrlInput || urlInput);

    if (!targetUrl) return undefined;

    return favorites.find((item) => {
      return item.isDefault && item.logo && normalizeFavoriteUrl(item.url) === targetUrl;
    });
  }, [favorites, parsedUrlInput, urlInput]);

  const shouldShowCurrentFavicon = useMemo(() => {
    const inputUrl = normalizeFavoriteUrl(parsedUrlInput || urlInput);
    const currentFrameUrl = normalizeFavoriteUrl(frameUrl);

    return !!inputUrl && !!currentFrameUrl && inputUrl === currentFrameUrl && !!faviconUrl && !faviconError;
  }, [parsedUrlInput, urlInput, frameUrl, faviconUrl, faviconError]);

  const isAddressSameAsFrame = useMemo(() => {
    const inputUrl = normalizeFavoriteUrl(parsedUrlInput || urlInput);
    const currentFrameUrl = normalizeFavoriteUrl(frameUrl);

    return !!inputUrl && !!currentFrameUrl && inputUrl === currentFrameUrl;
  }, [parsedUrlInput, urlInput, frameUrl]);

  const favoriteTargetUrl = isAddressSameAsFrame ? frameUrl : '';

  const isFav =
    !!favoriteTargetUrl &&
    favorites.some((f) => {
      return normalizeFavoriteUrl(f.url) === normalizeFavoriteUrl(favoriteTargetUrl);
    });

  const canToggleFavorite = !!favoriteTargetUrl && previewType === 'web' && isPageLoaded && !previewLoading && !previewError;

  const toggleFavorite = () => {
    if (!canToggleFavorite || !favoriteTargetUrl) return;

    const currentHistory = historyIdx >= 0 ? historyStack[historyIdx] : undefined;
    const title = currentHistory?.title || urlInput || favoriteTargetUrl;
    const logo = activeAddressFavorite?.logo || faviconUrl || '';

    vscode?.postMessage({ type: 'toggleFavorite', url: favoriteTargetUrl, title, logo });
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
      if (previewType === 'web') {
        vscode?.postMessage({ type: 'browserClearCache' });
        vscode?.postMessage({ type: 'showInfo', message: '✅ 缓存清理成功！' });
        handleRefresh();
        setMenuOpen(false);
        return;
      }

      if (previewType !== 'html') throw new Error('Not a web preview');

      const win = htmlIframeRef.current?.contentWindow;

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
    const description = favForm.description.trim();
    const logo = favForm.logo.trim();

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
          description,
          logo,
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
        description,
        logo,
        timestamp: Date.now(),
        isDefault: false,
        source: 'user',
      });
    }

    vscode?.postMessage({
      type: 'saveAllFavorites',
      favorites: newFavs.filter((item) => !item.isDefault),
    });

    setFavForm({
      visible: false,
      title: '',
      url: '',
      description: '',
      logo: '',
      editingOriginalUrl: '',
    });
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

  const handleBrowserViewportChange = useCallback((width: number, height: number) => {
    const deviceScaleFactor = Math.min(2, Math.max(1.5, window.devicePixelRatio || 1));

    vscode?.postMessage({
      type: 'browserSetViewport',
      width,
      height,
      deviceScaleFactor,
    });
  }, []);

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
            activeAddressFavorite?.logo ? (
              <img
                src={activeAddressFavorite.logo}
                className={styles['favicon-img']}
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                }}
              />
            ) : isFaviconLoading ? (
              <FontAwesomeIcon icon={faSpinner} spin className={styles['spiner-icon']} />
            ) : shouldShowCurrentFavicon ? (
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
              const nextValue = e.target.value;

              setUrlInput(nextValue);
              setShowSuggest(true);
              setSuggestIndex(-1);

              if (!nextValue.trim()) {
                updateFavicon('');
              }
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
                setSuggestIndex(-1);
                updateFavicon('');
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

          <SuggestBox
            ref={suggestBoxRef}
            visible={showSuggest}
            suggestions={suggestions}
            selectedIndex={suggestIndex}
            query={urlInput}
            onHover={(index: any) => setSuggestIndex(index)}
            onSelect={(url: any) => handleGo(url)}
          />
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

      <LivePreviewContextMenu
        visible={menuOpen}
        position={menuPos}
        onRefresh={handleRefresh}
        onOpenFav={() => setActiveModal('fav')}
        onOpenHistory={() => setActiveModal('history')}
        onClearCache={handleCacheClear}
        onOpenDevTools={() => vscode?.postMessage({ type: 'openDevTools' })}
        onClose={() => setMenuOpen(false)}
      />

      <div
        className={`${styles['preview-container']} ${device === 'device-responsive' && previewType !== 'md' && previewType !== 'pdf' && previewType !== 'excel' ? styles['no-padding'] : ''}`}
        style={{ position: 'relative' }}
      >
        {showProgress && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: '2px',
              backgroundColor: 'transparent',
              zIndex: 9999,
              pointerEvents: 'none',
              opacity: 1,
              transition: 'opacity 0.2s ease-in',
            }}
          >
            <div
              style={{
                height: '100%',
                backgroundColor: 'var(--vscode-progressBar-background, #007acc)',
                width: `${loadingProgress}%`,
                transition: loadingProgress === 0 ? 'none' : 'width 0.3s ease',
                boxShadow:
                  '0 0 10px var(--vscode-progressBar-background, #007acc), 0 0 5px var(--vscode-progressBar-background, #007acc)',
              }}
            />
          </div>
        )}

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
              iframeRef={htmlIframeRef}
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
          <div
            id="deviceWrapper"
            className={`${styles[device] || device} ${isRotated ? styles['rotated'] : ''}`}
            style={
              device === 'device-responsive'
                ? { width: '100%', height: '100%', minWidth: 0, minHeight: 0, maxWidth: '100%', maxHeight: '100%' }
                : undefined
            }
          >
            <BrowserSurface
              frame={browserFrame}
              loading={previewLoading}
              onViewportChange={handleBrowserViewportChange}
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