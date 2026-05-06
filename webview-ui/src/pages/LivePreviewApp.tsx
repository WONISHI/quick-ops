import React, { useState, useEffect, useRef } from 'react';
import { vscode } from '../utils/vscode';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faDesktop } from '@fortawesome/free-solid-svg-icons';

export default function LivePreviewApp() {
  const [frameData, setFrameData] = useState<string>('');
  const imgRef = useRef<HTMLImageElement>(null);

  // 与主进程虚拟视口的尺寸保持绝对一致
  const VIRTUAL_WIDTH = 1200;
  const VIRTUAL_HEIGHT = 800;

  useEffect(() => {
    // 监听主进程推过来的每一帧 Base64 图片
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      if (message.type === 'renderFrame') {
        setFrameData(message.base64Data);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // ⚠️ 核心算法：将真实的鼠标坐标，换算成图片原始(虚拟)尺寸下的相对坐标
  const getMappedCoordinates = (e: React.MouseEvent | React.WheelEvent) => {
    if (!imgRef.current) return { x: 0, y: 0 };

    // 获取当前图片在屏幕上的实际渲染尺寸和位置
    const rect = imgRef.current.getBoundingClientRect();

    // 计算缩放比例
    const scaleX = VIRTUAL_WIDTH / rect.width;
    const scaleY = VIRTUAL_HEIGHT / rect.height;

    // 换算出在原始虚拟视口中的绝对坐标
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    return { x: Math.round(x), y: Math.round(y) };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const { x, y } = getMappedCoordinates(e);
    vscode?.postMessage({ type: 'mouseMove', x, y });
  };

  const handleMouseClick = (e: React.MouseEvent) => {
    const { x, y } = getMappedCoordinates(e);
    vscode?.postMessage({ type: 'mouseClick', x, y });
  };

  const handleWheel = (e: React.WheelEvent) => {
    // 拦截网页自身的滚动，转交给后台的 Puppeteer 去滚
    vscode?.postMessage({ type: 'mouseScroll', deltaY: e.deltaY });
  };

  // 全局键盘监听转发
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      vscode?.postMessage({ type: 'keyboardType', key: e.key });
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--vscode-editor-background)',
        color: 'var(--vscode-editor-foreground)',
      }}
    >
      {/* 顶部简易工具栏 */}
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--vscode-panel-border)', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <FontAwesomeIcon icon={faDesktop} />
        <span style={{ fontSize: '13px', fontWeight: 'bold' }}>Screencast 投屏引擎 (无 iframe 跨域限制)</span>
      </div>

      {/* 画面渲染区 */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', justifyContent: 'center', alignItems: 'center', backgroundColor: '#111' }}>
        {!frameData ? (
          <div style={{ opacity: 0.5 }}>等待后台引擎推流...</div>
        ) : (
          <img
            ref={imgRef}
            src={`data:image/jpeg;base64,${frameData}`}
            alt="Screencast Frame"
            draggable={false}
            onClick={handleMouseClick}
            onMouseMove={handleMouseMove}
            onWheel={handleWheel}
            style={{
              // 保持比例居中显示，类似于 object-fit: contain
              maxWidth: '100%',
              maxHeight: '100%',
              boxShadow: '0 0 20px rgba(0,0,0,0.5)',
              cursor: 'crosshair',
            }}
          />
        )}
      </div>
    </div>
  );
}
