import React, { useState, useEffect, useRef } from 'react';
import { vscode } from '../utils/vscode';

// -------------------------------------------------------------------------
// 🌟 提取原版 SVG 图标
// -------------------------------------------------------------------------
const CarbonArrowLeft = (props: any) => (
  <svg width="1em" height="1em" viewBox="0 0 32 32" {...props}><path d="M14 26l1.41-1.41L7.83 17H28v-2H7.83l7.58-7.59L14 6L4 16l10 10z" fill="currentColor"></path></svg>
);
const CarbonArrowRight = (props: any) => (
  <svg width="1em" height="1em" viewBox="0 0 32 32" {...props}><path d="M18 6l-1.43 1.393L24.15 15H4v2h20.15l-7.58 7.573L18 26l10-10L18 6z" fill="currentColor"></path></svg>
);
const CarbonRenew = (props: any) => (
  <svg width="1em" height="1em" viewBox="0 0 32 32" {...props}>
    <path d="M12 10H6.78A11 11 0 0 1 27 16h2A13 13 0 0 0 6 7.68V4H4v8h8z" fill="currentColor"></path>
    <path d="M20 22h5.22A11 11 0 0 1 5 16H3a13 13 0 0 0 23 8.32V28h2v-8h-8z" fill="currentColor"></path>
  </svg>
);

export default function LivePreviewApp() {
  const [frameData, setFrameData] = useState<string>('');
  const [frameMime, setFrameMime] = useState<'png' | 'jpeg'>('jpeg');
  const [urlInput, setUrlInput] = useState('');
  
  const imgContainerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const modifiersForEvent = (event: any) => {
    return (event.altKey ? 1 : 0) | (event.ctrlKey ? 2 : 0) | (event.metaKey ? 4 : 0) | (event.shiftKey ? 8 : 0);
  };

  const dispatchMouseEvent = (event: React.MouseEvent | React.WheelEvent) => {
    event.stopPropagation();
    const nativeEvent = event.nativeEvent as any;
    
    let clickCount = 0;
    const buttons = { 0: 'none', 1: 'left', 2: 'middle', 3: 'right' };
    const types = {
      mousedown: 'mousePressed',
      mouseup: 'mouseReleased',
      mousemove: 'mouseMoved',
      wheel: 'mouseWheel',
      click: 'mousePressed'
    };

    if (!(nativeEvent.type in types)) return;

    const x = Math.round(nativeEvent.offsetX);
    const y = Math.round(nativeEvent.offsetY);
    const type = (types as any)[nativeEvent.type];

    if (type === 'mousePressed' || type === 'mouseReleased') {
      clickCount = 1;
    }

    const params: any = {
      type, x, y,
      modifiers: modifiersForEvent(nativeEvent),
      button: (buttons as any)[nativeEvent.which],
      clickCount, deltaX: 0, deltaY: 0,
    };

    if (type === 'mouseWheel') {
      params.deltaX = nativeEvent.deltaX;
      params.deltaY = nativeEvent.deltaY;
    }

    vscode?.postMessage({
      type: 'interaction', action: 'Input.dispatchMouseEvent', params: params
    });

    if (nativeEvent.type === 'mousedown') {
      imgRef.current?.focus();
    }
  };

  const emitKeyEvent = (event: React.KeyboardEvent) => {
    event.stopPropagation();
    const nativeEvent = event.nativeEvent as any;

    if (nativeEvent.key === 'Tab') nativeEvent.preventDefault();

    let type;
    switch (nativeEvent.type) {
      case 'keydown': type = 'keyDown'; break;
      case 'keyup': type = 'keyUp'; break;
      case 'keypress': type = 'char'; break;
      default: return;
    }

    const text = nativeEvent.type === 'keypress' ? String.fromCharCode(nativeEvent.charCode) : undefined;
    
    vscode?.postMessage({
      type: 'interaction',
      action: 'Input.dispatchKeyEvent',
      params: {
        type, modifiers: modifiersForEvent(nativeEvent), text,
        unmodifiedText: text ? text.toLowerCase() : undefined,
        keyIdentifier: nativeEvent.keyIdentifier, code: nativeEvent.code,
        key: nativeEvent.key, windowsVirtualKeyCode: nativeEvent.keyCode,
        nativeVirtualKeyCode: nativeEvent.keyCode, autoRepeat: false,
        isKeypad: false, isSystemKey: false,
      }
    });

    if (imgRef.current) imgRef.current.focus();
  };

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      if (message.type === 'renderFrame') {
        setFrameData(message.base64Data);
        setFrameMime(message.format);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  useEffect(() => {
    if (!imgContainerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          vscode?.postMessage({ type: 'resize', width, height });
        }
      }
    });
    observer.observe(imgContainerRef.current);
    return () => observer.disconnect();
  }, []);

  const handleGo = () => {
    let finalUrl = urlInput.trim();
    if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
      finalUrl = 'http://' + finalUrl;
    }
    vscode?.postMessage({ type: 'navigate', url: finalUrl });
  };

  return (
    <>
      {/* 🌟 完全注入 vscode-browse-lite 的核心 CSS 变量与样式 */}
      <style>{`
        html, body {
          height: 100%; margin: 0; padding: 0; font-size: 14px; font-weight: 400; overflow: hidden;
        }
        .App {
          text-align: center; height: 100vh; display: flex; flex-direction: column; background-color: var(--vscode-editor-background);
        }
        .toolbar {
          background: var(--vscode-tab-activeBackground);
          padding: 6px 6px 5px 6px;
          border-bottom: 1px solid var(--vscode-tab-border);
          box-shadow: -1px 1px 2px rgba(0, 0, 0, 0.1);
        }
        .inner { display: flex; flex: 1; }
        .toolbar button {
          cursor: pointer !important;
          background: transparent;
          transition: background-color 0.2s ease-in-out;
          padding: 0 5px;
          color: var(--vscode-tab-activeForeground);
          outline: none; border: none; font-size: 21px; border-radius: 2px;
          height: 29px; width: 29px; display: flex; align-items: center; justify-content: center;
        }
        .toolbar button svg { display: block; font-size: 0.85em; }
        .toolbar button:hover, .toolbar button:active { background-color: var(--vscode-button-secondaryBackground); }
        .urlbar {
          display: flex; flex: 1; margin: 0 4px 0 4px; padding: 0 6px; height: 29px;
        }
        .urlbar input {
          width: 100%;
          color: var(--vscode-input-foreground);
          border: 1px solid var(--vscode-input-border);
          outline: none !important; border-radius: 2px;
          background: var(--vscode-input-background);
          padding: 0 8px; font-family: inherit;
        }
        .urlbar input:focus { border-color: var(--vscode-inputOption-activeBorder); }
        .viewport {
          flex: 1; display: flex; overflow: hidden; position: relative; background: var(--vscode-editor-background);
        }
        .viewport-inner { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; }
      `}</style>

      <div className="App">
        {/* 🌟 1:1 还原：Toolbar 组件结构 */}
        <div className="toolbar">
          <div className="inner">
            <button className="backward" title="Go Back" onClick={() => vscode?.postMessage({ type: 'goBack' })}>
              <CarbonArrowLeft />
            </button>
            <button className="forward" title="Go Forward" onClick={() => vscode?.postMessage({ type: 'goForward' })}>
              <CarbonArrowRight />
            </button>
            <button className="refresh" title="Reload" onClick={() => vscode?.postMessage({ type: 'reload' })}>
              <CarbonRenew />
            </button>
            
            <div className="urlbar">
              <input 
                type="text"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                  if (e.key === 'Enter') {
                    e.currentTarget.blur();
                    handleGo();
                  }
                }}
                onFocus={(e) => e.target.select()}
                placeholder="Enter URL..."
              />
            </div>
          </div>
        </div>

        {/* 🌟 渲染区 */}
        <div className="viewport" ref={imgContainerRef}>
          <div className="viewport-inner">
            {frameData ? (
              <img
                ref={imgRef}
                src={`data:image/${frameMime};base64,${frameData}`}
                draggable="false"
                onMouseDown={dispatchMouseEvent}
                onMouseUp={dispatchMouseEvent}
                onMouseMove={dispatchMouseEvent}
                onClick={dispatchMouseEvent}
                onWheel={dispatchMouseEvent}
                onKeyDown={emitKeyEvent}
                onKeyUp={emitKeyEvent}
                onKeyPress={emitKeyEvent}
                onContextMenu={(e) => e.preventDefault()}
                tabIndex={0}
                style={{
                  width: '100%', height: '100%',
                  objectFit: 'fill', /* 保证鼠标坐标严丝合缝 */
                  cursor: 'auto', outline: 'none', display: 'block'
                }}
              />
            ) : (
              <div style={{ color: 'var(--vscode-descriptionForeground)' }}>引擎启动中...</div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}