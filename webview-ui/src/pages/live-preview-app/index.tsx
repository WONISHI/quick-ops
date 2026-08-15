import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { vscode } from '@utils/vscode';
import UrlParser from '@utils/UrlParser';
import BaseContextMenu from '@components/BaseContextMenu';
import BaseSearch from '@components/BaseSearch';
import styles from '@pages/live-preview-app/index.module.css';

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faArrowLeft,
  faRotateRight,
  faXmark,
  faStar as faStarSolid,
  faArrowRight,
  faRotate,
  faArrowUpRightFromSquare,
  faEllipsis,
  faSpinner,
  faWindowRestore,
  faPlus,
} from '@fortawesome/free-solid-svg-icons';
import { faStar as faStarRegular } from '@fortawesome/free-regular-svg-icons';

import VditorApp from '@pages/vditor-app';
import PdfPreviewApp from '@pages/pdf-preview-app';
import ExcelPreviewApp from '@pages/excel-preview-app';
import HtmlPreviewApp from '@pages/html-preview-app';
import PreviewError from '@pages/live-preview-app/components/preview-error';

import WelcomePage from '@pages/live-preview-app/components/welcome-page';
import FavoriteModal from '@pages/live-preview-app/components/favorite-modal';
import HistoryModal from '@pages/live-preview-app/components/history-modal';
import SuggestBox from '@pages/live-preview-app/components/suggest-box';
import AirPlayIcon from '@pages/live-preview-app/components/airplay-icon';
import LivePreviewContextMenu from '@pages/live-preview-app/components/live-preview-context-menu';
import LivePreviewSkeleton from '@pages/live-preview-app/components/live-preview-skeleton';
import {
  ROOT_FAVORITE_FOLDER_ID,
  BROWSER_ENGINE_OPTIONS,
  DEFAULT_BROWSER_ENGINE_KEY,
  BROWSER_ENGINE_STORAGE_KEY,
  PREVIEW_DEVICE_GROUPS,
  PREVIEW_ZOOM_MIN,
  PREVIEW_ZOOM_MAX,
  PREVIEW_ZOOM_STEP,
} from '@pages/live-preview-app/src/constants';
import type { BaseContextMenuItem } from '@components/BaseContextMenu/src/type';
import type {
  FavoriteItem,
  FavoriteFolder,
  HistoryItem,
  PreviewErrorState,
  BrowserFrameState,
  BrowserEngineKey,
  BrowserSurfaceProps,
  PreviewType,
  PreviewTabItem,
} from '@pages/live-preview-app/src/type';

type PreviewTabListItem = PreviewTabItem & {
  faviconUrl?: string;
};

const isBrowserEngineKey = (value: unknown): value is BrowserEngineKey => {
  return value === 'baidu' || value === 'bing' || value === 'quark';
};

const getBrowserEngineOption = (key: BrowserEngineKey) => {
  return BROWSER_ENGINE_OPTIONS.find((item) => item.key === key) || BROWSER_ENGINE_OPTIONS[0];
};

/**
 * @description 将预览缩放值限制在 50% - 200%
 */
function normalizePreviewZoom(value: number): number {
  const normalized = Math.min(PREVIEW_ZOOM_MAX, Math.max(PREVIEW_ZOOM_MIN, value));

  return Number(normalized.toFixed(1));
}

function BrowserSurface({
  loading,
  onViewportChange,
  onFindShortcut,
  previewZoom = 1,
}: BrowserSurfaceProps & {
  /**
   * @description 外层设备预览的视觉缩放比例
   */
  previewZoom?: number;
}) {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const lastViewportRef = useRef({ width: 0, height: 0 });
  const resizeRafRef = useRef<number | null>(null);
  const resizeTimerRef = useRef<number | null>(null);
  const middleDragRef = useRef({
    active: false,
    lastX: 0,
    lastY: 0,
  });
  const selectionDragRef = useRef({
    active: false,
    startX: 0,
    startY: 0,
    endX: 0,
    endY: 0,
    moved: false,
  });
  const selectionSelectRafRef = useRef<number | null>(null);
  const imeInputRef = useRef<HTMLTextAreaElement | null>(null);
  const isComposingRef = useRef(false);
  const ignoreNextInputRef = useRef(false);
  const ignoreInputTimerRef = useRef<number | null>(null);
  const lastCommittedCompositionTextRef = useRef('');
  const lastCommittedCompositionAtRef = useRef(0);
  const [isMiddleDragging, setIsMiddleDragging] = useState(false);
  const [hasBrowserFrame, setHasBrowserFrame] = useState(false);
  const hasBrowserFrameRef = useRef(false);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const frameInfoRef = useRef({ width: 0, height: 0 });
  const pendingFrameRef = useRef<BrowserFrameState | null>(null);
  const frameRafRef = useRef<number | null>(null);

  const commitBrowserFrame = useCallback((frame: BrowserFrameState) => {
    const img = imgRef.current;

    if (!img || !frame.data) return;

    const format = frame.format === 'png' ? 'png' : 'jpeg';

    frameInfoRef.current = {
      width: Math.max(0, Number(frame.width) || 0),
      height: Math.max(0, Number(frame.height) || 0),
    };

    img.src = `data:image/${format};base64,${frame.data}`;

    if (!hasBrowserFrameRef.current) {
      hasBrowserFrameRef.current = true;
      setHasBrowserFrame(true);
    }
  }, []);

  useEffect(() => {
    const handleBrowserFrame = (event: Event) => {
      const frame = (event as CustomEvent<BrowserFrameState>).detail;

      if (!frame?.data) return;

      pendingFrameRef.current = frame;

      if (frameRafRef.current) return;

      frameRafRef.current = window.requestAnimationFrame(() => {
        frameRafRef.current = null;

        const nextFrame = pendingFrameRef.current;
        pendingFrameRef.current = null;

        if (nextFrame) {
          commitBrowserFrame(nextFrame);
        }
      });
    };

    const handleBrowserFrameClear = () => {
      pendingFrameRef.current = null;
      frameInfoRef.current = { width: 0, height: 0 };
      hasBrowserFrameRef.current = false;
      setHasBrowserFrame(false);

      if (imgRef.current) {
        imgRef.current.removeAttribute('src');
      }
    };

    window.addEventListener('quickops-browser-frame', handleBrowserFrame as EventListener);
    window.addEventListener('quickops-browser-frame-clear', handleBrowserFrameClear);

    return () => {
      window.removeEventListener('quickops-browser-frame', handleBrowserFrame as EventListener);
      window.removeEventListener('quickops-browser-frame-clear', handleBrowserFrameClear);

      if (frameRafRef.current) {
        window.cancelAnimationFrame(frameRafRef.current);
        frameRafRef.current = null;
      }

      pendingFrameRef.current = null;
    };
  }, [commitBrowserFrame]);

  const notifyViewportSize = useCallback(() => {
    const target = surfaceRef.current;

    if (!target) return;

    const rect = target.getBoundingClientRect();

    /**
     * deviceWrapper 使用 CSS zoom 做视觉缩放。
     * 上报给 EmbeddedBrowser 的仍然是设备原始尺寸，
     * 否则 Ctrl + 滚轮会变成修改浏览器 viewport，而不是放大画面。
     */
    const width = Math.max(320, Math.floor(rect.width / previewZoom));
    const height = Math.max(240, Math.floor(rect.height / previewZoom));

    if (lastViewportRef.current.width === width && lastViewportRef.current.height === height) {
      return;
    }

    lastViewportRef.current = { width, height };
    onViewportChange(width, height);
  }, [onViewportChange, previewZoom]);

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
      }, 260);
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

  const getMoveButton = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.buttons & 2) return 'right';
    if (event.buttons & 4) return 'middle';
    if (event.buttons & 1) return 'left';
    return 'none';
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
    const viewportWidth = frameInfoRef.current.width || lastViewportRef.current.width || rect.width;
    const viewportHeight = frameInfoRef.current.height || lastViewportRef.current.height || rect.height;
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
    const viewportWidth = frameInfoRef.current.width || lastViewportRef.current.width || rect.width;
    const viewportHeight = frameInfoRef.current.height || lastViewportRef.current.height || rect.height;
    const scaleX = rect.width > 0 ? viewportWidth / rect.width : 1;
    const scaleY = rect.height > 0 ? viewportHeight / rect.height : 1;

    return {
      x: Math.max(0, Math.min(viewportWidth, Math.round(rawX * scaleX))),
      y: Math.max(0, Math.min(viewportHeight, Math.round(rawY * scaleY))),
    };
  }, []);

  const sendPanWheel = useCallback(
    (clientX: number, clientY: number, deltaX: number, deltaY: number) => {
      const point = getBrowserPointByClient(clientX, clientY);

      vscode?.postMessage({
        type: 'browserInput',
        inputType: 'wheel',
        x: point.x,
        y: point.y,
        deltaX,
        deltaY,
      });
    },
    [getBrowserPointByClient],
  );

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

  useEffect(() => {
    return () => {
      if (selectionSelectRafRef.current) {
        window.cancelAnimationFrame(selectionSelectRafRef.current);
        selectionSelectRafRef.current = null;
      }
    };
  }, []);

  const sendMouse = (event: React.MouseEvent<HTMLDivElement>, type: 'mouseMoved' | 'mousePressed' | 'mouseReleased') => {
    event.preventDefault();

    const point = getBrowserPoint(event);

    vscode?.postMessage({
      type: 'browserInput',
      inputType: 'mouse',
      eventType: type,
      x: point.x,
      y: point.y,
      button: type === 'mouseMoved' ? getMoveButton(event) : getMouseButton(event),
      buttons: getPressedButtons(event, type),
      clickCount: type === 'mouseMoved' ? 0 : Math.max(1, event.detail || 1),
    });
  };

  const postTextSelectionRange = (drag = selectionDragRef.current) => {
    if (!drag.active || !drag.moved) return;

    vscode?.postMessage({
      type: 'browserSelectTextRange',
      startX: drag.startX,
      startY: drag.startY,
      endX: drag.endX,
      endY: drag.endY,
    });
  };

  const scheduleTextSelectionRange = () => {
    if (selectionSelectRafRef.current) return;

    selectionSelectRafRef.current = window.requestAnimationFrame(() => {
      selectionSelectRafRef.current = null;
      postTextSelectionRange();
    });
  };

  const startTextSelectionDrag = (event: React.MouseEvent<HTMLDivElement>) => {
    const point = getBrowserPoint(event);

    if (selectionSelectRafRef.current) {
      window.cancelAnimationFrame(selectionSelectRafRef.current);
      selectionSelectRafRef.current = null;
    }

    selectionDragRef.current = {
      active: true,
      startX: point.x,
      startY: point.y,
      endX: point.x,
      endY: point.y,
      moved: false,
    };
  };

  const updateTextSelectionDrag = (event: React.MouseEvent<HTMLDivElement>, sync = false) => {
    if (!selectionDragRef.current.active) return;

    const point = getBrowserPoint(event);
    const dx = Math.abs(point.x - selectionDragRef.current.startX);
    const dy = Math.abs(point.y - selectionDragRef.current.startY);

    selectionDragRef.current.endX = point.x;
    selectionDragRef.current.endY = point.y;
    selectionDragRef.current.moved = dx > 3 || dy > 3;

    if (!selectionDragRef.current.moved) return;

    if (sync) {
      scheduleTextSelectionRange();
    }
  };

  const finishTextSelectionDrag = () => {
    const drag = selectionDragRef.current;

    if (selectionSelectRafRef.current) {
      window.cancelAnimationFrame(selectionSelectRafRef.current);
      selectionSelectRafRef.current = null;
    }

    selectionDragRef.current = {
      active: false,
      startX: 0,
      startY: 0,
      endX: 0,
      endY: 0,
      moved: false,
    };

    if (!drag.active || !drag.moved) return;

    postTextSelectionRange(drag);
  };

  const sendWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();

    const rect = event.currentTarget.getBoundingClientRect();
    const viewportWidth = frameInfoRef.current.width || lastViewportRef.current.width || rect.width;
    const viewportHeight = frameInfoRef.current.height || lastViewportRef.current.height || rect.height;
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

  const focusImeInput = () => {
    window.setTimeout(() => {
      imeInputRef.current?.focus({ preventScroll: true });
    }, 0);
  };

  const clearImeInputValue = () => {
    const input = imeInputRef.current;

    if (!input) return;

    input.value = '';
  };

  const clearIgnoreInputTimer = () => {
    if (!ignoreInputTimerRef.current) return;

    window.clearTimeout(ignoreInputTimerRef.current);
    ignoreInputTimerRef.current = null;
  };

  const scheduleIgnoreNextInputReset = () => {
    clearIgnoreInputTimer();

    ignoreInputTimerRef.current = window.setTimeout(() => {
      ignoreInputTimerRef.current = null;
      ignoreNextInputRef.current = false;
      lastCommittedCompositionTextRef.current = '';
      lastCommittedCompositionAtRef.current = 0;
    }, 500);
  };

  useEffect(() => {
    return () => {
      clearIgnoreInputTimer();
    };
  }, []);

  const insertText = (text: string) => {
    if (!text) return;

    vscode?.postMessage({
      type: 'browserInput',
      inputType: 'insertText',
      text,
    });
  };

  const updateCompositionText = (text: string) => {
    vscode?.postMessage({
      type: 'browserInput',
      inputType: 'composition',
      text,
    });
  };

  const commitCompositionText = (text: string) => {
    vscode?.postMessage({
      type: 'browserInput',
      inputType: 'commitComposition',
      text,
    });
  };

  const cancelCompositionText = () => {
    vscode?.postMessage({
      type: 'browserInput',
      inputType: 'cancelComposition',
    });
  };

  const updateImeInputPosition = (clientX: number, clientY: number) => {
    const input = imeInputRef.current;

    if (!input) return;

    const left = Math.max(0, Math.min(window.innerWidth - 180, clientX));
    const top = Math.max(0, Math.min(window.innerHeight - 28, clientY + 18));

    input.style.left = `${left}px`;
    input.style.top = `${top}px`;
  };

  const isEditableTextInputKey = (event: React.KeyboardEvent) => {
    if (event.ctrlKey || event.metaKey || event.altKey) {
      return false;
    }

    return event.key.length === 1;
  };

  const isBrowserControlKey = (event: React.KeyboardEvent) => {
    const keys = new Set(['Backspace', 'Delete', 'Enter', 'Tab', 'Escape', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);

    return keys.has(event.key);
  };

  const sendKey = (event: React.KeyboardEvent<HTMLDivElement>, eventType: 'keyDown' | 'keyUp') => {
    const shortcutKey = event.key.toLowerCase();
    const isCopyShortcut = (event.ctrlKey || event.metaKey) && shortcutKey === 'c';
    const isFindShortcut = (event.ctrlKey || event.metaKey) && shortcutKey === 'f';
    const isComposing = isComposingRef.current || event.nativeEvent.isComposing || event.key === 'Process';

    if (eventType === 'keyDown') {
      if (isFindShortcut) {
        event.preventDefault();
        onFindShortcut();
        return;
      }

      if (isCopyShortcut) {
        event.preventDefault();
        vscode?.postMessage({
          type: 'browserCopySelection',
        });
        return;
      }
    }

    if (eventType === 'keyUp' && (isCopyShortcut || isFindShortcut)) {
      event.preventDefault();
      return;
    }

    if (isComposing) {
      return;
    }

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

  const sendImeControlKey = (event: React.KeyboardEvent<HTMLTextAreaElement>, eventType: 'keyDown' | 'keyUp') => {
    event.stopPropagation();

    const shortcutKey = event.key.toLowerCase();
    const isFindShortcut = (event.ctrlKey || event.metaKey) && shortcutKey === 'f';
    const isCopyShortcut = (event.ctrlKey || event.metaKey) && shortcutKey === 'c';
    const isComposing = isComposingRef.current || event.nativeEvent.isComposing || event.key === 'Process';

    if (eventType === 'keyDown' && isFindShortcut) {
      event.preventDefault();
      onFindShortcut();
      return;
    }

    if (eventType === 'keyDown' && isCopyShortcut) {
      event.preventDefault();
      vscode?.postMessage({
        type: 'browserCopySelection',
      });
      return;
    }

    if (eventType === 'keyUp' && (isFindShortcut || isCopyShortcut)) {
      event.preventDefault();
      return;
    }

    if (isComposing) {
      return;
    }

    /**
     * 普通字符不能在 keyDown 里立即转发。
     *
     * 原因：中文输入法在部分系统里事件顺序是 keyDown(g) -> compositionStart -> compositionUpdate(g)。
     * 如果 keyDown(g) 这里先发给真实浏览器，compositionUpdate(g) 又会再发一次，百度输入框就会变成 gg。
     *
     * 所以普通字符统一交给 textarea 的 onInput / compositionUpdate 处理：
     * - 英文输入：onInput 插入一次 d。
     * - 中文输入：compositionUpdate 显示拼音 g，compositionEnd 提交 谷歌。
     */
    if (isEditableTextInputKey(event)) {
      return;
    }

    if (!isBrowserControlKey(event)) {
      return;
    }

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
      className={[styles['browser-lite-surface'], isMiddleDragging ? styles['browser-lite-surface-dragging'] : ''].filter(Boolean).join(' ')}
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

        if (selectionDragRef.current.active && event.buttons & 1) {
          updateTextSelectionDrag(event, true);
        }

        sendMouse(event, 'mouseMoved');
      }}
      onMouseDown={(event) => {
        event.currentTarget.focus();
        updateImeInputPosition(event.clientX, event.clientY);
        focusImeInput();

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

        if (event.button === 0) {
          startTextSelectionDrag(event);
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

        if (event.button === 0) {
          updateTextSelectionDrag(event);
          finishTextSelectionDrag();
        }
      }}
      onMouseLeave={() => {
        if (middleDragRef.current.active) {
          stopMiddleDrag();
        }

        if (selectionDragRef.current.active) {
          finishTextSelectionDrag();
        }
      }}
      onWheel={sendWheel}
      onKeyDown={(event) => sendKey(event, 'keyDown')}
      onKeyUp={(event) => sendKey(event, 'keyUp')}
    >
      <textarea
        ref={imeInputRef}
        className={styles['browser-ime-capture']}
        aria-hidden="true"
        tabIndex={-1}
        defaultValue=""
        onCopy={(event) => {
          event.preventDefault();
          event.stopPropagation();
          vscode?.postMessage({
            type: 'browserCopySelection',
          });
        }}
        onCut={(event) => {
          event.preventDefault();
          event.stopPropagation();
          vscode?.postMessage({
            type: 'browserCopySelection',
          });
        }}
        onInput={(event) => {
          event.stopPropagation();

          const value = event.currentTarget.value;

          /**
           * 中文输入法组合期间，拼音显示只走 compositionUpdate -> composition。
           * 这里不能再 updateCompositionText，否则某些输入法会出现 g + g。
           */
          if (isComposingRef.current || event.nativeEvent.isComposing) {
            return;
          }

          /**
           * compositionEnd 后，有些输入法 / Webview 会继续补发一次 input，
           * 这个 input 的 value 就是刚刚已经 commitCompositionText 的最终文本。
           * 如果不吞掉，就会出现：选中“谷”后变成“谷谷”。
           */
          const committedText = lastCommittedCompositionTextRef.current;
          const recentlyCommitted = Date.now() - lastCommittedCompositionAtRef.current < 500;

          if (ignoreNextInputRef.current || (recentlyCommitted && value === committedText)) {
            ignoreNextInputRef.current = false;
            clearIgnoreInputTimer();
            lastCommittedCompositionTextRef.current = '';
            lastCommittedCompositionAtRef.current = 0;
            clearImeInputValue();
            return;
          }

          /**
           * 普通英文输入不走 keyDown，统一从 textarea 的 input 插入一次。
           */
          if (value) {
            insertText(value);
          }

          clearImeInputValue();
        }}
        onChange={(event) => {
          event.stopPropagation();
        }}
        onCompositionStart={(event) => {
          event.stopPropagation();
          isComposingRef.current = true;
          ignoreNextInputRef.current = false;
          clearIgnoreInputTimer();
          lastCommittedCompositionTextRef.current = '';
          lastCommittedCompositionAtRef.current = 0;
          clearImeInputValue();
          cancelCompositionText();
        }}
        onCompositionUpdate={(event) => {
          event.stopPropagation();
          isComposingRef.current = true;

          const value = event.data || event.currentTarget.value || '';

          updateCompositionText(value);
        }}
        onCompositionEnd={(event) => {
          event.stopPropagation();
          isComposingRef.current = false;

          const value = event.data || event.currentTarget.value || '';

          ignoreNextInputRef.current = true;
          lastCommittedCompositionTextRef.current = value;
          lastCommittedCompositionAtRef.current = Date.now();
          scheduleIgnoreNextInputReset();

          commitCompositionText(value);
          clearImeInputValue();

          window.setTimeout(() => {
            if (!imeInputRef.current) return;

            clearImeInputValue();
            imeInputRef.current.focus({ preventScroll: true });
          }, 0);
        }}
        onKeyDown={(event) => {
          sendImeControlKey(event, 'keyDown');
        }}
        onKeyUp={(event) => {
          sendImeControlKey(event, 'keyUp');
        }}
      />

      <img
        ref={imgRef}
        className={styles['browser-lite-frame']}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'fill',
          display: hasBrowserFrame ? 'block' : 'none',
          imageRendering: 'crisp-edges',
          transform: 'translateZ(0)',
          backfaceVisibility: 'hidden',
          maxWidth: 'unset',
          maxHeight: 'unset',
        }}
        draggable={false}
        alt="网页预览"
      />

      {!hasBrowserFrame && <div className={styles['browser-lite-empty']}>{loading ? '正在加载网页...' : '暂无网页内容'}</div>}
    </div>
  );
}

export default function LivePreviewApp() {
  /**
   * @description 是否正在等待 Extension Host 发送初始化数据
   */
  const [initializing, setInitializing] = useState(true);

  const [urlInput, setUrlInput] = useState('');
  const [frameUrl, setFrameUrl] = useState('');
  const [previewType, setPreviewType] = useState<PreviewType>('web');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<PreviewErrorState | null>(null);

  const [loadingProgress, setLoadingProgress] = useState(0);
  const [showProgress, setShowProgress] = useState(false);
  const progressTimerRef = useRef<number | null>(null);
  const progressStartedRef = useRef(false);

  const [device, setDevice] = useState('device-responsive');
  const [isRotated, setIsRotated] = useState(false);

  /**
   * @description 网页和 HTML 预览的视觉缩放比例
   */
  const [previewZoom, setPreviewZoom] = useState(1);
  const [showPreviewZoom, setShowPreviewZoom] = useState(false);

  const [faviconUrl, setFaviconUrl] = useState('');
  const [faviconError, setFaviconError] = useState(false);
  const [, setIsFaviconLoading] = useState(false);

  const [browserEngine, setBrowserEngine] = useState<BrowserEngineKey>(() => {
    const cached = window.localStorage.getItem(BROWSER_ENGINE_STORAGE_KEY);

    return isBrowserEngineKey(cached) ? cached : DEFAULT_BROWSER_ENGINE_KEY;
  });
  const [browserSwitcherOpen, setBrowserSwitcherOpen] = useState(false);
  const [deviceMenuOpen, setDeviceMenuOpen] = useState(false);
  const [previewTabsMenuOpen, setPreviewTabsMenuOpen] = useState(false);
  const [previewTabs, setPreviewTabs] = useState<PreviewTabListItem[]>([]);
  const [currentPreviewTabId, setCurrentPreviewTabId] = useState('');

  const [favorites, setFavorites] = useState<FavoriteItem[]>([]);
  const [favoriteFolders, setFavoriteFolders] = useState<FavoriteFolder[]>([]);
  const [navigationFavoriteUrls, setNavigationFavoriteUrls] = useState<string[]>([]);
  const [selectedFavoriteFolderId, setSelectedFavoriteFolderId] = useState('all');
  const [historyStack, setHistoryStack] = useState<HistoryItem[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const historyStackRef = useRef<HistoryItem[]>([]);
  const historyIdxRef = useRef(-1);
  const lastRecordedHistoryUrlRef = useRef('');
  const pendingExplicitNavigationRef = useRef(false);
  const pendingHistoryNavigationRef = useRef(false);
  const pendingRedirectUntilRef = useRef(0);
  const isInternalNav = useRef(false);

  const [activeModal, setActiveModal] = useState<'none' | 'fav' | 'history'>('none');

  const [searchOpen, setSearchOpen] = useState(false);
  const searchOpenRef = useRef(false);
  const [searchResult, setSearchResult] = useState({ keyword: '', total: 0, current: 0 });

  const [favSort, setFavSort] = useState<'time' | 'title'>('time');
  const [favForm, setFavForm] = useState({
    visible: false,
    title: '',
    url: '',
    description: '',
    logo: '',
    editingOriginalUrl: '',
    folderId: ROOT_FAVORITE_FOLDER_ID,
  });
  const [showSuggest, setShowSuggest] = useState(false);
  const [suggestIndex, setSuggestIndex] = useState(-1);
  const [copiedUrl, setCopiedUrl] = useState('');
  const [isPageLoaded, setIsPageLoaded] = useState(false);

  const htmlIframeRef = useRef<HTMLIFrameElement | null>(null);
  const suggestBoxRef = useRef<HTMLDivElement>(null);
  const browserSwitcherRef = useRef<HTMLDivElement>(null);
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const previewZoomTimerRef = useRef<number | null>(null);
  const previewLoadTimerRef = useRef<number | null>(null);

  const previewRequestIdRef = useRef(0);
  const pageLoadedRef = useRef(false);
  const faviconResolvedRef = useRef(false);
  const faviconRequestIdRef = useRef(0);
  const favoriteMetaRequestIdRef = useRef(0);
  const favoriteMetaResolversRef = useRef(new Map<number, (value: any) => void>());

  useEffect(() => {
    const handleWindowPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;

      if (!target) return;
      if (browserSwitcherRef.current?.contains(target)) return;

      setBrowserSwitcherOpen(false);
    };

    window.addEventListener('mousedown', handleWindowPointerDown);

    return () => {
      window.removeEventListener('mousedown', handleWindowPointerDown);
    };
  }, []);

  /**
   * @description Ctrl/Cmd + 鼠标滚轮缩放网页预览
   *
   * 使用原生 passive:false 监听，阻止 Chromium 默认缩放整个 Webview。
   * 仅对网页和本地 HTML 预览生效。
   */
  useEffect(() => {
    const target = previewContainerRef.current;

    if (!target) return;

    const handlePreviewWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) {
        return;
      }

      if (previewType !== 'web' && previewType !== 'html') {
        return;
      }

      if (!frameUrl) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const direction = event.deltaY < 0 ? 1 : -1;

      setPreviewZoom((current) => {
        return normalizePreviewZoom(current + direction * PREVIEW_ZOOM_STEP);
      });

      setShowPreviewZoom(true);

      if (previewZoomTimerRef.current) {
        window.clearTimeout(previewZoomTimerRef.current);
      }

      previewZoomTimerRef.current = window.setTimeout(() => {
        previewZoomTimerRef.current = null;
        setShowPreviewZoom(false);
      }, 800);
    };

    target.addEventListener('wheel', handlePreviewWheel, {
      passive: false,
      capture: true,
    });

    return () => {
      target.removeEventListener('wheel', handlePreviewWheel, true);

      if (previewZoomTimerRef.current) {
        window.clearTimeout(previewZoomTimerRef.current);
        previewZoomTimerRef.current = null;
      }
    };
  }, [frameUrl, previewType]);

  // 控制顶部虚拟进度条：页面加载完成后直接卸载 DOM，避免残留一条线
  useEffect(() => {
    let startTimer: number | undefined;
    let completeTimer: number | undefined;
    let hideTimer: number | undefined;
    let resetTimer: number | undefined;

    const clearProgressInterval = () => {
      if (progressTimerRef.current) {
        window.clearInterval(progressTimerRef.current);
        progressTimerRef.current = null;
      }
    };

    if (previewLoading) {
      progressStartedRef.current = true;

      startTimer = window.setTimeout(() => {
        setShowProgress(true);
        setLoadingProgress(15);
        clearProgressInterval();

        progressTimerRef.current = window.setInterval(() => {
          setLoadingProgress((prev) => {
            if (prev >= 92) return 92;

            const increment = prev < 50 ? 10 : prev < 80 ? 4 : 1;

            return prev + increment;
          });
        }, 300);
      }, 0);

      return () => {
        if (startTimer) {
          window.clearTimeout(startTimer);
        }

        clearProgressInterval();
      };
    }

    clearProgressInterval();

    if (!progressStartedRef.current) {
      return;
    }

    completeTimer = window.setTimeout(() => {
      setLoadingProgress(100);

      hideTimer = window.setTimeout(() => {
        setShowProgress(false);

        resetTimer = window.setTimeout(() => {
          setLoadingProgress(0);
          progressStartedRef.current = false;
        }, 120);
      }, 180);
    }, 0);

    return () => {
      if (completeTimer) {
        window.clearTimeout(completeTimer);
      }

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

  const saveNavigationFavoriteUrls = (urls: string[]) => {
    const uniqueUrls = urls.reduce<string[]>((result, url) => {
      const normalizedUrl = normalizeFavoriteUrl(url);

      if (!normalizedUrl || result.some((item) => normalizeFavoriteUrl(item) === normalizedUrl)) {
        return result;
      }

      result.push(url);
      return result;
    }, []);

    setNavigationFavoriteUrls(uniqueUrls);
    vscode?.postMessage({
      type: 'saveNavigationFavorites',
      navigationFavoriteUrls: uniqueUrls,
    });
  };

  const toggleFavoriteNavigation = (favorite: FavoriteItem) => {
    const targetUrl = normalizeFavoriteUrl(favorite.url);
    const isIncluded = navigationFavoriteUrls.some((url) => normalizeFavoriteUrl(url) === targetUrl);
    const nextUrls = isIncluded
      ? navigationFavoriteUrls.filter((url) => normalizeFavoriteUrl(url) !== targetUrl)
      : [...navigationFavoriteUrls, favorite.url];

    saveNavigationFavoriteUrls(nextUrls);
  };

  const createFavoriteFolderId = (name: string) => {
    const safeName = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5_-]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);

    return `folder-${safeName || 'custom'}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  };

  const activeBrowserEngine = useMemo(() => {
    return getBrowserEngineOption(browserEngine);
  }, [browserEngine]);

  const switchBrowserEngine = (nextEngine: BrowserEngineKey) => {
    setBrowserEngine(nextEngine);
    setBrowserSwitcherOpen(false);
    window.localStorage.setItem(BROWSER_ENGINE_STORAGE_KEY, nextEngine);
  };

  const isSearchKeywordInput = (value: string) => {
    const raw = value.trim();

    if (!raw) return false;
    if (/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(raw)) return false;
    if (UrlParser.isAbsolutePath(raw)) return false;
    if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?([/?#].*)?$/i.test(raw)) return false;
    if (/^([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(:\d+)?([/?#].*)?$/.test(raw)) return false;

    return true;
  };

  const parsePreviewInput = useCallback(
    (value: string) => {
      const raw = String(value || '').trim();

      if (!raw) return '';

      if (isSearchKeywordInput(raw)) {
        return getBrowserEngineOption(browserEngine).searchUrl(raw);
      }

      return UrlParser.parse(raw) || '';
    },
    [browserEngine],
  );

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

  const openSearchBar = () => {
    searchOpenRef.current = true;
    setSearchOpen(true);
  };

  const closeSearchBar = () => {
    searchOpenRef.current = false;
    setSearchOpen(false);
    setSearchResult({ keyword: '', total: 0, current: 0 });
    vscode?.postMessage({ type: 'browserSearch', keyword: '', direction: 'next' });
  };

  const runPageSearch = (keyword: string, direction: 'next' | 'previous' = 'next') => {
    const value = keyword.trim();

    if (!value) {
      setSearchResult({ keyword: '', total: 0, current: 0 });
      vscode?.postMessage({ type: 'browserSearch', keyword: '', direction });
      return;
    }

    if (previewType !== 'web') {
      setSearchResult({ keyword: value, total: 0, current: 0 });
      return;
    }

    vscode?.postMessage({
      type: 'browserSearch',
      keyword: value,
      direction,
    });
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
    const activeIndex = historyIdxRef.current;

    setHistoryStack((prev) => {
      const next = [...prev];

      if (next[activeIndex]) {
        next[activeIndex] = {
          ...next[activeIndex],
          title: title || next[activeIndex].url,
        };
      }

      historyStackRef.current = next;
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

  const normalizeHistoryUrl = (url: string) => {
    return String(url || '').trim();
  };

  const syncHistoryState = (stack: HistoryItem[], index: number) => {
    historyStackRef.current = stack;
    historyIdxRef.current = index;
    lastRecordedHistoryUrlRef.current = index > -1 ? normalizeHistoryUrl(stack[index]?.url || '') : '';
  };

  const setHistoryIdxSafe = (index: number) => {
    historyIdxRef.current = index;
    lastRecordedHistoryUrlRef.current = index > -1 ? normalizeHistoryUrl(historyStackRef.current[index]?.url || '') : '';
    setHistoryIdx(index);
  };

  const replaceCurrentHistory = (url: string, title?: string) => {
    const normalizedUrl = normalizeHistoryUrl(url);

    if (!normalizedUrl || normalizedUrl === 'about:blank') return;

    setHistoryStack((prev) => {
      const activeIndex = historyIdxRef.current;

      if (activeIndex < 0 || !prev[activeIndex]) {
        const item: HistoryItem = {
          url: normalizedUrl,
          title: title || normalizedUrl,
          timestamp: Date.now(),
          logo: getKnownLogoByUrl(normalizedUrl),
        };
        const next = [item];

        syncHistoryState(next, 0);
        setHistoryIdx(0);
        return next;
      }

      const next = [...prev];
      const previous = next[activeIndex];

      next[activeIndex] = {
        ...previous,
        url: normalizedUrl,
        title: title || previous.title || normalizedUrl,
        logo: previous.logo || getKnownLogoByUrl(normalizedUrl),
        timestamp: previous.timestamp || Date.now(),
      };

      syncHistoryState(next, activeIndex);
      return next;
    });
  };

  const pushHistory = (url: string, defaultTitle: string, options?: { replace?: boolean; force?: boolean }) => {
    const normalizedUrl = normalizeHistoryUrl(url);

    if (!normalizedUrl || normalizedUrl === 'about:blank') return;

    if (options?.replace) {
      replaceCurrentHistory(normalizedUrl, defaultTitle);
      return;
    }

    setHistoryStack((prev) => {
      const activeIndex = historyIdxRef.current;

      if (!options?.force && activeIndex > -1 && normalizeHistoryUrl(prev[activeIndex]?.url || '') === normalizedUrl) {
        const next = [...prev];
        const current = next[activeIndex];

        if (current && defaultTitle && current.title !== defaultTitle) {
          next[activeIndex] = {
            ...current,
            title: defaultTitle,
          };
          syncHistoryState(next, activeIndex);
          return next;
        }

        syncHistoryState(prev, activeIndex);
        return prev;
      }

      const nextStack = prev.slice(0, activeIndex + 1);
      const logo = getKnownLogoByUrl(normalizedUrl);

      nextStack.push({
        url: normalizedUrl,
        title: defaultTitle || normalizedUrl,
        timestamp: Date.now(),
        logo,
      });

      const nextIndex = nextStack.length - 1;

      syncHistoryState(nextStack, nextIndex);
      setHistoryIdx(nextIndex);
      return nextStack;
    });
  };

  const recordBrowserNavigation = (url: string, title?: string, eventType: 'urlChanged' | 'pageLoaded' = 'urlChanged') => {
    const normalizedUrl = normalizeHistoryUrl(url);

    if (!normalizedUrl || normalizedUrl === 'about:blank') return;

    setFrameUrl(normalizedUrl);
    setUrlInput(normalizedUrl);
    vscode?.postMessage({ type: 'saveUrl', url: normalizedUrl });

    if (pendingHistoryNavigationRef.current) {
      replaceCurrentHistory(normalizedUrl, title || normalizedUrl);

      if (eventType === 'pageLoaded') {
        pendingHistoryNavigationRef.current = false;
        pendingRedirectUntilRef.current = 0;
        isInternalNav.current = false;
      }

      return;
    }

    if (pendingExplicitNavigationRef.current) {
      pushHistory(normalizedUrl, title || normalizedUrl);
      pendingExplicitNavigationRef.current = false;
      pendingRedirectUntilRef.current = Date.now() + 1600;
      return;
    }

    if (pendingRedirectUntilRef.current > Date.now()) {
      replaceCurrentHistory(normalizedUrl, title || normalizedUrl);

      if (eventType === 'pageLoaded') {
        pendingRedirectUntilRef.current = 0;
      }

      return;
    }

    if (normalizeHistoryUrl(lastRecordedHistoryUrlRef.current) !== normalizedUrl) {
      pushHistory(normalizedUrl, title || normalizedUrl);
      return;
    }

    if (title) {
      updateCurrentHistoryTitle(title);
    }
  };

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;

      if (message.type === 'init') {
        if (message.device) setDevice(message.device);

        if (typeof message.url === 'string' && message.url.trim()) {
          const initUrl = message.url.trim();

          pendingExplicitNavigationRef.current = true;
          setUrlInput(initUrl);
          loadPreviewTarget(initUrl);
        }

        vscode?.postMessage({ type: 'reqSyncFavorites' });
        vscode?.postMessage({ type: 'reqPreviewTabs' });
        setInitializing(false);
      } else if (message.type === 'previewTabsChanged') {
        setPreviewTabs(Array.isArray(message.tabs) ? message.tabs : []);
        setCurrentPreviewTabId(String(message.currentTabId || message.activeTabId || ''));
      } else if (message.type === 'resetPreviewToWelcome') {
        resetPreviewState();
        setPreviewTabsMenuOpen(false);
      } else if (message.type === 'syncFavorites') {
        setFavorites(message.favorites || []);
        setFavoriteFolders(message.folders || []);

        if (Array.isArray(message.navigationFavoriteUrls)) {
          setNavigationFavoriteUrls(message.navigationFavoriteUrls);
        }
      } else if (message.type === 'favoriteMetaResolved') {
        const requestId = Number(message.requestId) || 0;
        const resolver = favoriteMetaResolversRef.current.get(requestId);

        if (resolver) {
          favoriteMetaResolversRef.current.delete(requestId);
          resolver(message.ok ? message : null);
        }
      } else if (message.type === 'browserFrame') {
        window.dispatchEvent(
          new CustomEvent<BrowserFrameState>('quickops-browser-frame', {
            detail: {
              data: message.data || '',
              width: message.width || 0,
              height: message.height || 0,
              format: message.format === 'png' ? 'png' : 'jpeg',
            },
          }),
        );
      } else if (message.type === 'browserPageLoaded') {
        pageLoadedRef.current = true;
        faviconResolvedRef.current = true;
        clearPreviewLoadTimer();
        setPreviewLoading(false);
        setPreviewError(null);
        setIsPageLoaded(true);
        if (message.url) {
          recordBrowserNavigation(message.url, message.title, 'pageLoaded');
        } else if (message.title) {
          updateCurrentHistoryTitle(message.title);
        }
      } else if (message.type === 'browserTitleChanged') {
        updateCurrentHistoryTitle(message.title || frameUrl || urlInput);
      } else if (message.type === 'browserUrlChanged') {
        if (message.url) {
          recordBrowserNavigation(message.url, undefined, 'urlChanged');
        }
      } else if (message.type === 'browserSearchResult') {
        setSearchResult({
          keyword: message.keyword || '',
          total: Number(message.total) || 0,
          current: Number(message.current) || 0,
        });
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
          recordBrowserNavigation(url, url, 'urlChanged');
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

    const handleGlobalKeyDown = (event: KeyboardEvent) => {
      const shortcutKey = event.key.toLowerCase();

      if ((event.metaKey || event.ctrlKey) && shortcutKey === 'f') {
        event.preventDefault();
        event.stopPropagation();
        openSearchBar();
      }

      if (shortcutKey === 'escape' && searchOpenRef.current) {
        event.preventDefault();
        closeSearchBar();
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown, true);

    const handleWindowBlur = () => {
      setShowSuggest(false);
      setSuggestIndex(-1);
    };

    window.addEventListener('blur', handleWindowBlur);

    vscode?.postMessage({ type: 'ready' });

    return () => {
      window.removeEventListener('message', handleMessage);
      window.removeEventListener('click', handleClickOutside);
      window.removeEventListener('keydown', handleGlobalKeyDown, true);
      window.removeEventListener('blur', handleWindowBlur);
      clearPreviewLoadTimer();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (activeModal !== 'fav') return;

    /**
     * VS Code globalState 是全局存储，但不是跨窗口实时事件总线。
     * 收藏夹打开时主动拉取最新收藏 / 分组，避免不同工作区窗口不同步。
     */
    const syncFavoriteData = () => {
      vscode?.postMessage({ type: 'reqSyncFavorites' });
    };

    syncFavoriteData();

    const timer = window.setInterval(syncFavoriteData, 1500);

    return () => {
      window.clearInterval(timer);
    };
  }, [activeModal]);

  const navigateToHistory = (index: number) => {
    const stack = historyStackRef.current;

    if (index < 0 || index >= stack.length) return;

    isInternalNav.current = true;
    pendingHistoryNavigationRef.current = true;
    pendingExplicitNavigationRef.current = false;
    pendingRedirectUntilRef.current = 0;

    const targetUrl = stack[index].url;

    setHistoryIdxSafe(index);
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

  function loadPreviewTarget(url: string) {
    const pType = getPreviewTypeByUrl(url);

    setPreviewType(pType);
    setPreviewError(null);
    setSearchResult({ keyword: '', total: 0, current: 0 });
    clearPreviewLoadTimer();

    pageLoadedRef.current = false;
    faviconResolvedRef.current = false;

    setIsPageLoaded(false);
    setFrameUrl(url);

    vscode?.postMessage({ type: 'saveUrl', url });

    if (pType === 'web') {
      interruptPendingWebNavigation();
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

    if (pendingHistoryNavigationRef.current) {
      replaceCurrentHistory(url, url);
      pendingHistoryNavigationRef.current = false;
      isInternalNav.current = false;
      return;
    }

    if (pendingExplicitNavigationRef.current) {
      pushHistory(url, url);
      pendingExplicitNavigationRef.current = false;
    }
  }

  function handleGo(forceUrl?: string) {
    const rawUrl = forceUrl !== undefined ? forceUrl : urlInput;
    const finalUrl = parsePreviewInput(rawUrl);

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
      window.dispatchEvent(new CustomEvent('quickops-browser-frame-clear'));
      vscode?.postMessage({ type: 'browserStopLoading' });
      vscode?.postMessage({ type: 'browserStop' });
      vscode?.postMessage({ type: 'saveUrl', url: '' });
      return;
    }

    pendingExplicitNavigationRef.current = true;
    pendingHistoryNavigationRef.current = false;
    pendingRedirectUntilRef.current = 0;

    setUrlInput(finalUrl);
    loadPreviewTarget(finalUrl);
  }

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

  function resetPreviewState() {
    clearPreviewLoadTimer();

    previewRequestIdRef.current += 1;
    pageLoadedRef.current = false;
    faviconResolvedRef.current = false;

    setUrlInput('');
    setFrameUrl('');
    setPreviewType('web');
    setPreviewLoading(false);
    setPreviewError(null);
    setIsPageLoaded(false);

    updateFavicon('');
    window.dispatchEvent(new CustomEvent('quickops-browser-frame-clear'));
    vscode?.postMessage({ type: 'browserStopLoading' });
    vscode?.postMessage({ type: 'browserStop' });
    vscode?.postMessage({ type: 'saveUrl', url: '' });
  }

  const handleRefresh = () => {
    const inputValue = urlInput.trim();
    const fallbackUrl = frameUrl && frameUrl !== 'about:blank' ? frameUrl : historyIdx > -1 ? historyStack[historyIdx]?.url || '' : '';

    if (!inputValue && fallbackUrl) {
      setUrlInput(fallbackUrl);
    }

    const refreshValue = inputValue || fallbackUrl;

    if (!refreshValue) {
      resetPreviewState();
      return;
    }

    const inputTarget = parsePreviewInput(refreshValue);

    if (!inputTarget) {
      if (!inputValue && fallbackUrl) {
        setUrlInput(fallbackUrl);
      } else {
        resetPreviewState();
      }

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

      return;
    }

    setPreviewType('web');
    setFrameUrl(temp);
    interruptPendingWebNavigation();
    vscode?.postMessage({ type: 'saveUrl', url: temp });
    startWebPreviewGuard(temp);
    vscode?.postMessage({ type: 'browserRefresh', url: temp });
  };

  const handleDeviceSelect = useCallback((newDevice: string) => {
    setDevice(newDevice);
    setDeviceMenuOpen(false);

    if (newDevice === 'device-responsive') {
      setIsRotated(false);
    }

    vscode?.postMessage({
      type: 'saveDevice',
      device: newDevice,
    });
  }, []);

  const activeDeviceLabel = useMemo(() => {
    for (const group of PREVIEW_DEVICE_GROUPS) {
      const matched = group.items.find((item) => item.value === device);

      if (matched) {
        return matched.label;
      }
    }

    return '响应式铺满';
  }, [device]);

  /**
   * @description 预览设备菜单
   *
   * 分组标题使用 disabled 菜单项，
   * 保持所有设备分组默认展开，不改变原来的交互。
   */
  const deviceMenuItems = useMemo<BaseContextMenuItem[]>(() => {
    const items: BaseContextMenuItem[] = [];

    PREVIEW_DEVICE_GROUPS.forEach((group, groupIndex) => {
      if (groupIndex > 0) {
        items.push({
          type: 'separator',
          key: `device-separator-${group.label}`,
        });
      }

      items.push({
        key: `device-group-${group.label}`,
        label: group.label,
        disabled: true,
        className: styles['device-menu-group-title'],
      });

      group.items.forEach((item) => {
        const active = item.value === device;

        items.push({
          key: item.value,
          label: item.label,
          shortcut: active ? '✓' : undefined,
          className: active ? styles['device-menu-selected-item'] : undefined,
          onSelect: () => {
            handleDeviceSelect(item.value);
          },
        });
      });
    });

    return items;
  }, [device, handleDeviceSelect]);

  /**
   * @description 当前打开的 Live Preview 标签页菜单
   */
  const previewTabMenuItems = useMemo<BaseContextMenuItem[]>(() => {
    const items: BaseContextMenuItem[] = [
      {
        key: 'preview-tabs-header',
        label: '预览标签页',
        shortcut: String(previewTabs.length || 1),
        disabled: true,
        className: styles['preview-tabs-menu-header-item'],
      },
      {
        type: 'separator',
        key: 'preview-tabs-header-separator',
      },
      {
        key: 'preview-tabs-new-tab',
        label: '新建标签页',
        icon: <FontAwesomeIcon icon={faPlus} />,
        className: styles['preview-tabs-menu-new-item'],
        onSelect: () => {
          vscode?.postMessage({
            type: 'openNewPreviewTab',
            device,
          });
        },
      },
      {
        key: 'preview-tabs-close-all',
        label: '关闭所有标签页',
        icon: <FontAwesomeIcon icon={faXmark} />,
        className: styles['preview-tabs-menu-new-item'],
        onSelect: () => {
          vscode?.postMessage({
            type: 'closeAllPreviewTabs',
          });
        },
      },
      {
        type: 'separator',
        key: 'preview-tabs-new-tab-separator',
      },
    ];

    if (previewTabs.length === 0) {
      items.push({
        key: 'preview-tabs-loading',
        label: '正在读取标签页...',
        disabled: true,
        className: styles['preview-tabs-menu-empty-item'],
      });

      return items;
    }

    previewTabs.forEach((tab) => {
      const active = tab.active || tab.id === currentPreviewTabId;
      const tabFaviconUrl = String(tab.faviconUrl || '').trim();

      items.push({
        key: tab.id,
        icon: (
          <span className={styles['preview-tab-menu-icon']}>
            <FontAwesomeIcon icon={faWindowRestore} />

            {tabFaviconUrl && (
              <img
                className={styles['preview-tab-menu-favicon']}
                src={tabFaviconUrl}
                alt=""
                onError={(event) => {
                  event.currentTarget.style.display = 'none';
                }}
              />
            )}
          </span>
        ),
        label: (
          <span className={styles['preview-tab-item-main']}>
            <span className={styles['preview-tab-title']}>{tab.title || '新建预览'}</span>

            <span className={styles['preview-tab-url']}>{tab.url || '暂无地址'}</span>
          </span>
        ),
        shortcut: active ? '✓' : undefined,
        title: tab.url || tab.title,
        className: [styles['preview-tab-context-menu-item'], active ? styles['preview-tab-context-menu-item-active'] : ''].filter(Boolean).join(' '),
        onSelect: () => {
          if (active) return;

          vscode?.postMessage({
            type: 'switchPreviewTab',
            tabId: tab.id,
          });
        },
      });
    });

    return items;
  }, [currentPreviewTabId, device, previewTabs]);

  const parsedUrlInput = useMemo(() => {
    const value = urlInput.trim();

    if (!value) return '';

    return parsePreviewInput(value) || '';
  }, [urlInput, parsePreviewInput]);

  const activeAddressFavorite = useMemo(() => {
    const targetUrl = normalizeFavoriteUrl(parsedUrlInput || urlInput);

    if (!targetUrl) return undefined;

    return favorites.find((item) => {
      return item.isDefault && item.logo && normalizeFavoriteUrl(item.url) === targetUrl;
    });
  }, [favorites, parsedUrlInput, urlInput]);

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

    vscode?.postMessage({
      type: 'toggleFavorite',
      url: favoriteTargetUrl,
      title,
      logo,
      folderId: ROOT_FAVORITE_FOLDER_ID,
    });
  };

  const handleCacheClear = (type: 'local' | 'session' | 'cookie') => {
    try {
      if (previewType === 'web') {
        vscode?.postMessage({ type: 'browserClearCache' });
        vscode?.postMessage({ type: 'showInfo', message: '✅ 缓存清理成功！' });
        handleRefresh();
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
      console.log('e', e);
      vscode?.postMessage({ type: 'showWarning', message: '⚠️ 此页面不支持清理缓存或存在跨域限制' });
    }
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

  const resolveFavoriteMeta = (url: string) => {
    const requestId = favoriteMetaRequestIdRef.current + 1;

    favoriteMetaRequestIdRef.current = requestId;

    return new Promise<any | null>((resolve) => {
      favoriteMetaResolversRef.current.set(requestId, resolve);

      vscode?.postMessage({
        type: 'resolveFavoriteMeta',
        requestId,
        url,
      });

      window.setTimeout(() => {
        const resolver = favoriteMetaResolversRef.current.get(requestId);

        if (!resolver) return;

        favoriteMetaResolversRef.current.delete(requestId);
        resolver(null);
      }, 12000);
    });
  };

  const getFallbackFavoriteTitle = (url: string) => {
    try {
      return new URL(url).hostname || url;
    } catch {
      return url;
    }
  };

  const saveFavorite = async () => {
    const u = UrlParser.parse(favForm.url);
    let t = favForm.title.trim();
    let description = favForm.description.trim();
    let logo = favForm.logo.trim();
    const folderId = favForm.folderId || ROOT_FAVORITE_FOLDER_ID;

    if (!u) {
      return vscode?.postMessage({ type: 'showError', message: '链接不能为空' });
    }

    const editingTarget = favorites.find((f) => f.url === favForm.editingOriginalUrl);

    if (editingTarget?.isDefault) {
      return vscode?.postMessage({ type: 'showInfo', message: '默认收藏不能编辑。' });
    }

    if (!t || !description || !logo) {
      const meta = await resolveFavoriteMeta(u);

      if (meta) {
        t = t || String(meta.title || '').trim();
        description = description || String(meta.description || '').trim();
        logo = logo || String(meta.logo || '').trim();
      }
    }

    if (!t) {
      t = getFallbackFavoriteTitle(u);
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
          folderId,
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
        folderId,
        timestamp: Date.now(),
        isDefault: false,
        source: 'user',
      });
    }

    vscode?.postMessage({
      type: 'saveAllFavorites',
      favorites: newFavs.filter((item) => !item.isDefault),
    });

    if (favForm.editingOriginalUrl) {
      const editingUrl = normalizeFavoriteUrl(favForm.editingOriginalUrl);

      if (navigationFavoriteUrls.some((url) => normalizeFavoriteUrl(url) === editingUrl)) {
        saveNavigationFavoriteUrls(
          navigationFavoriteUrls.map((url) => (normalizeFavoriteUrl(url) === editingUrl ? u : url)),
        );
      }
    }

    setFavForm({
      visible: false,
      title: '',
      url: '',
      description: '',
      logo: '',
      editingOriginalUrl: '',
      folderId: ROOT_FAVORITE_FOLDER_ID,
    });
  };

  const deleteFavorite = (favorite: FavoriteItem) => {
    if (favorite.isDefault) {
      vscode?.postMessage({ type: 'showInfo', message: '该收藏是插件内置默认书签，不能删除。' });
      return;
    }

    const newFavs = favorites.filter((f) => f.url !== favorite.url || f.isDefault);

    vscode?.postMessage({
      type: 'saveAllFavorites',
      favorites: newFavs.filter((item) => !item.isDefault),
    });

    const deletedUrl = normalizeFavoriteUrl(favorite.url);

    if (navigationFavoriteUrls.some((url) => normalizeFavoriteUrl(url) === deletedUrl)) {
      saveNavigationFavoriteUrls(navigationFavoriteUrls.filter((url) => normalizeFavoriteUrl(url) !== deletedUrl));
    }
  };

  const saveFavoriteData = (nextFavorites: FavoriteItem[], nextFolders?: FavoriteFolder[]) => {
    const payload: {
      type: 'saveAllFavorites';
      favorites: FavoriteItem[];
      folders?: FavoriteFolder[];
    } = {
      type: 'saveAllFavorites',
      favorites: nextFavorites.filter((item) => !item.isDefault),
    };

    if (nextFolders) {
      payload.folders = nextFolders.filter((item) => !item.isDefault);
    }

    vscode?.postMessage(payload);
  };

  const createFavoriteFolder = (name: string) => {
    const folderName = name.trim();

    if (!folderName) {
      vscode?.postMessage({ type: 'showError', message: '文件夹名称不能为空' });
      return;
    }

    if (favoriteFolders.some((folder) => folder.name === folderName)) {
      vscode?.postMessage({ type: 'showError', message: '文件夹名称已存在' });
      return;
    }

    const newFolder: FavoriteFolder = {
      id: createFavoriteFolderId(folderName),
      name: folderName,
      timestamp: Date.now(),
      isDefault: false,
      source: 'user' as const,
    };

    const nextFolders = [...favoriteFolders, newFolder];

    setFavoriteFolders(nextFolders);
    setSelectedFavoriteFolderId(newFolder.id);
    saveFavoriteData(favorites, nextFolders);

    return newFolder.id;
  };

  const renameFavoriteFolder = (folder: FavoriteFolder, nextName: string) => {
    if (folder.isDefault) {
      vscode?.postMessage({ type: 'showInfo', message: '默认文件夹不能重命名。' });
      return;
    }

    const folderName = nextName.trim();

    if (!folderName) {
      vscode?.postMessage({ type: 'showError', message: '文件夹名称不能为空' });
      return;
    }

    if (favoriteFolders.some((item) => item.id !== folder.id && item.name === folderName)) {
      vscode?.postMessage({ type: 'showError', message: '文件夹名称已存在' });
      return;
    }

    const nextFolders = favoriteFolders.map((item) => {
      return item.id === folder.id ? { ...item, name: folderName } : item;
    });

    setFavoriteFolders(nextFolders);
    saveFavoriteData(favorites, nextFolders);
  };

  const deleteFavoriteFolder = (folder: FavoriteFolder) => {
    if (folder.isDefault) {
      vscode?.postMessage({ type: 'showInfo', message: '默认文件夹不能删除。' });
      return;
    }

    const nextFolders = favoriteFolders.filter((item) => item.id !== folder.id);
    const nextFavorites = favorites.map((item) => {
      if (item.folderId !== folder.id) return item;

      return {
        ...item,
        folderId: ROOT_FAVORITE_FOLDER_ID,
      };
    });

    setFavoriteFolders(nextFolders);
    setFavorites(nextFavorites);

    if (selectedFavoriteFolderId === folder.id) {
      setSelectedFavoriteFolderId('all');
    }

    saveFavoriteData(nextFavorites, nextFolders);
  };

  const moveFavoriteToFolder = (favorite: FavoriteItem, folderId: string) => {
    if (favorite.isDefault) {
      vscode?.postMessage({ type: 'showInfo', message: '默认收藏不能移动。' });
      return;
    }

    const nextFavorites = favorites.map((item) => {
      if (item.url !== favorite.url || item.isDefault) return item;

      return {
        ...item,
        folderId: folderId || ROOT_FAVORITE_FOLDER_ID,
      };
    });

    setFavorites(nextFavorites);
    saveFavoriteData(nextFavorites);
  };

  const importFavorites = () => {
    vscode?.postMessage({ type: 'importFavorites' });
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

  const navigationFavorites = sortedFavorites.filter((favorite) => {
    const targetUrl = normalizeFavoriteUrl(favorite.url);

    return navigationFavoriteUrls.some((url) => normalizeFavoriteUrl(url) === targetUrl);
  });

  const exportFavorites = () => {
    vscode?.postMessage({
      type: 'exportFavorites',
      favorites: sortedFavorites,
      folders: favoriteFolders,
    });
  };

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
    /**
     * vscode-browse-lite 这里直接使用 window.devicePixelRatio。
     * Retina / 高缩放屏如果被压到 1.1 / 1.5，截图会被低清放大，所以这里不要前端限死。
     * 后端仍然保留 quickOps.browser.maxDeviceScaleFactor 兜底上限，默认 2。
     */
    const deviceScaleFactor = Math.max(1, window.devicePixelRatio || 1);

    vscode?.postMessage({
      type: 'browserSetViewport',
      width,
      height,
      deviceScaleFactor,
    });
  }, []);

  if (initializing) {
    return <LivePreviewSkeleton />;
  }

  return (
    <div className={styles['live-preview-container']}>
      <div className={styles['toolbar']}>
        <button className={styles['icon-btn']} disabled={historyIdx <= 0} onClick={() => navigateToHistory(historyIdx - 1)} title="后退">
          <FontAwesomeIcon icon={faArrowLeft} />
        </button>

        <button className={styles['icon-btn']} disabled={historyIdx < 0 || historyIdx >= historyStack.length - 1} onClick={() => navigateToHistory(historyIdx + 1)} title="前进">
          <FontAwesomeIcon icon={faArrowRight} />
        </button>

        <button className={styles['icon-btn']} onClick={handleRefresh} title="刷新页面">
          <FontAwesomeIcon icon={faRotateRight} />
        </button>

        <div className={styles['address-bar-wrapper']}>
          <div ref={browserSwitcherRef} className={styles['browser-switcher']}>
            <button
              type="button"
              className={styles['browser-switcher-btn']}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setDeviceMenuOpen(false);
                setPreviewTabsMenuOpen(false);
                setBrowserSwitcherOpen((visible) => !visible);
              }}
              title={`当前搜索引擎：${activeBrowserEngine.label}，点击切换`}
              aria-label={`当前搜索引擎：${activeBrowserEngine.label}，点击切换`}
            >
              <span className={[styles['favicon-img'], styles['browser-engine-icon'], styles[`browser-engine-icon-${activeBrowserEngine.key}`]].filter(Boolean).join(' ')}>
                {activeBrowserEngine.shortName}
              </span>
            </button>

            {browserSwitcherOpen && (
              <div className={styles['browser-switcher-menu']}>
                {BROWSER_ENGINE_OPTIONS.map((item) => {
                  const active = item.key === activeBrowserEngine.key;

                  return (
                    <button
                      key={item.key}
                      type="button"
                      className={`${styles['browser-switcher-item']} ${active ? styles['browser-switcher-item-active'] : ''}`}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        switchBrowserEngine(item.key);
                      }}
                    >
                      <span className={[styles['favicon-img'], styles['browser-engine-icon'], styles[`browser-engine-icon-${item.key}`]].filter(Boolean).join(' ')}>
                        {item.shortName}
                      </span>
                      <span className={styles['browser-switcher-label']}>{item.label}</span>
                      {active && <span className={styles['browser-switcher-check']}>✓</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

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
            placeholder={`使用 ${activeBrowserEngine.label} 搜索，或输入网址 / 本地绝对路径`}
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

        <div className={styles['toolbar-menu-trigger']}>
          <BaseContextMenu
            trigger="click"
            showArrow
            open={deviceMenuOpen}
            items={deviceMenuItems}
            minWidth={178}
            density="default"
            menuClassName={styles['device-context-menu']}
            onOpenChange={(open) => {
              setDeviceMenuOpen(open);

              if (open) {
                setBrowserSwitcherOpen(false);
                setPreviewTabsMenuOpen(false);
              }
            }}
          >
            <button
              type="button"
              className={[styles['icon-btn'], deviceMenuOpen ? styles['active-blue'] : ''].filter(Boolean).join(' ')}
              disabled={previewType !== 'web' && previewType !== 'html'}
              title={`选择预览设备：${activeDeviceLabel}`}
              aria-label={`选择预览设备：${activeDeviceLabel}`}
              aria-expanded={deviceMenuOpen}
            >
              <AirPlayIcon />
            </button>
          </BaseContextMenu>
        </div>

        <div className={styles['toolbar-menu-trigger']}>
          <BaseContextMenu
            trigger="click"
            showArrow
            open={previewTabsMenuOpen}
            items={previewTabMenuItems}
            minWidth={280}
            density="default"
            menuClassName={styles['preview-tabs-context-menu']}
            onOpenChange={(open) => {
              setPreviewTabsMenuOpen(open);

              if (open) {
                setBrowserSwitcherOpen(false);
                setDeviceMenuOpen(false);

                vscode?.postMessage({
                  type: 'reqPreviewTabs',
                });
              }
            }}
          >
            <button
              type="button"
              className={[styles['icon-btn'], styles['preview-tabs-btn'], previewTabsMenuOpen ? styles['active-blue'] : ''].filter(Boolean).join(' ')}
              title={`当前打开 ${previewTabs.length || 1} 个预览标签页`}
              aria-label={`当前打开 ${previewTabs.length || 1} 个预览标签页`}
              aria-expanded={previewTabsMenuOpen}
            >
              <FontAwesomeIcon icon={faWindowRestore} />

              <span className={styles['preview-tabs-count']}>{previewTabs.length || 1}</span>
            </button>
          </BaseContextMenu>
        </div>

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

        <LivePreviewContextMenu
          onRefresh={handleRefresh}
          onNewTab={() => {
            vscode?.postMessage({
              type: 'openNewPreviewTab',
              device,
            });
          }}
          onOpenFav={() => {
            if (searchOpenRef.current) {
              closeSearchBar();
            }

            setActiveModal('fav');
          }}
          onOpenHistory={() => setActiveModal('history')}
          onClearCache={handleCacheClear}
          onOpenDevTools={() => vscode?.postMessage({ type: 'openDevTools' })}
        >
          <button type="button" className={styles['icon-btn']} title="更多操作">
            <FontAwesomeIcon icon={faEllipsis} />
          </button>
        </LivePreviewContextMenu>
      </div>

      <BaseSearch
        open={searchOpen}
        standalone
        draggable
        text=""
        placeholder="搜索网页内容"
        maxWidth={380}
        size={42}
        initialOffset={{ y: 44 }}
        result={{
          query: searchResult.keyword,
          current: searchResult.current,
          total: searchResult.total,
        }}
        onSearch={(query, direction) => {
          runPageSearch(query, direction === 'prev' ? 'previous' : 'next');
        }}
        onClose={closeSearchBar}
      />

      <div
        ref={previewContainerRef}
        className={`${styles['preview-container']} ${
          device === 'device-responsive' && previewType !== 'md' && previewType !== 'pdf' && previewType !== 'excel' && previewZoom === 1 ? styles['no-padding'] : ''
        }`}
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
                boxShadow: '0 0 10px var(--vscode-progressBar-background, #007acc), 0 0 5px var(--vscode-progressBar-background, #007acc)',
              }}
            />
          </div>
        )}

        {/* 原有转圈 Mask：可以与上方进度条共存，如果不喜欢可以将这行删掉 */}
        {renderPreviewLoadingMask()}

        {showPreviewZoom && frameUrl && (previewType === 'web' || previewType === 'html') && (
          <div className={styles['preview-zoom-indicator']} aria-live="polite">
            {Math.round(previewZoom * 100)}%
          </div>
        )}

        {!frameUrl ? (
          <WelcomePage
            onQuickOpen={handleGo}
            navigationFavorites={navigationFavorites}
            favoriteFolders={favoriteFolders}
          />
        ) : previewType === 'md' ? (
          <VditorApp key={frameUrl} />
        ) : previewType === 'pdf' ? (
          <PdfPreviewApp key={frameUrl} initialScale={0.8} />
        ) : previewType === 'excel' ? (
          <ExcelPreviewApp key={frameUrl} />
        ) : previewType === 'html' ? (
          <div
            id="deviceWrapper"
            className={`${styles[device] || device} ${isRotated ? styles['rotated'] : ''}`}
            style={
              {
                '--preview-zoom': previewZoom,
              } as React.CSSProperties
            }
          >
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
              {
                ...(device === 'device-responsive'
                  ? {
                      width: '100%',
                      height: '100%',
                      minWidth: 0,
                      minHeight: 0,
                      maxWidth: '100%',
                      maxHeight: '100%',
                    }
                  : null),
                '--preview-zoom': previewZoom,
              } as React.CSSProperties
            }
          >
            <BrowserSurface loading={previewLoading} previewZoom={previewZoom} onViewportChange={handleBrowserViewportChange} onFindShortcut={openSearchBar} />
          </div>
        )}
      </div>

      <FavoriteModal
        visible={activeModal === 'fav'}
        sortedFavorites={sortedFavorites}
        favoriteFolders={favoriteFolders}
        selectedFolderId={selectedFavoriteFolderId}
        favSort={favSort}
        favForm={favForm}
        copiedUrl={copiedUrl}
        navigationFavoriteUrls={navigationFavoriteUrls}
        setSelectedFolderId={setSelectedFavoriteFolderId}
        setFavSort={setFavSort}
        setFavForm={setFavForm}
        onClose={() => setActiveModal('none')}
        onOpenUrl={(url) => {
          handleGo(url);
          setActiveModal('none');
        }}
        onCopy={handleCopy}
        onToggleNavigation={toggleFavoriteNavigation}
        onSaveFavorite={saveFavorite}
        onDeleteFavorite={deleteFavorite}
        onCreateFolder={createFavoriteFolder}
        onRenameFolder={renameFavoriteFolder}
        onDeleteFolder={deleteFavoriteFolder}
        onMoveFavoriteToFolder={moveFavoriteToFolder}
        onImportFavorites={importFavorites}
        onExportFavorites={exportFavorites}
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
