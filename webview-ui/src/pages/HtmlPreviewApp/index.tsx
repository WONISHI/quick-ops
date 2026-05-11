import React, { useEffect, useRef, useState } from 'react';
import { vscode } from '../../utils/vscode';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faMagnifyingGlass, faXmark, faChevronUp, faChevronDown } from '@fortawesome/free-solid-svg-icons';

export default function HtmlPreviewApp() {
  const [htmlContent, setHtmlContent] = useState<string | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [searchText, setSearchText] = useState('');
  
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // 🌟 修复 1：将函数的定义提前，解决变量未初始化就被访问的错误
  const closeSearch = () => {
    setShowSearch(false);
    setSearchText('');
    iframeRef.current?.contentWindow?.getSelection()?.removeAllRanges();
  };

  const executeSearch = (backward: boolean = false) => {
    if (!searchText.trim() || !iframeRef.current?.contentWindow) return;
    
    // 🌟 修复 2：使用 as any 绕过 TypeScript 类型检查，调用 Chromium 原生的 find 方法
    const win = iframeRef.current.contentWindow as any;
    const found = win.find(searchText, false, backward, true, false, false, false);
    
    if (!found) {
      if (searchInputRef.current) {
        searchInputRef.current.style.color = '#e74c3c';
        setTimeout(() => {
          if (searchInputRef.current) searchInputRef.current.style.color = 'inherit';
        }, 500);
      }
    }
  };

  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      const msg = e.data;
      if (msg.type === 'initHtmlContent') {
        setHtmlContent(msg.content);
      }
    };
    window.addEventListener('message', handleMessage);
    vscode.postMessage({ command: 'webviewLoaded' });

    // 监听键盘事件，拦截 Ctrl+F
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setShowSearch(true);
        setTimeout(() => searchInputRef.current?.focus(), 50);
      }
      if (e.key === 'Escape' && showSearch) {
        closeSearch();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('message', handleMessage);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [showSearch]); // 依赖 showSearch 状态，保证 Escape 键能获取最新状态

  if (htmlContent === null) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: 'var(--vscode-descriptionForeground)' }}>
        正在深度解析 HTML 文件及静态依赖...
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {/* 搜索悬浮条 */}
      {showSearch && (
        <div style={{
          position: 'absolute', top: '10px', right: '20px', zIndex: 100,
          background: 'var(--vscode-editorWidget-background)',
          border: '1px solid var(--vscode-editorWidget-border)',
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          borderRadius: '4px', padding: '6px 12px',
          display: 'flex', alignItems: 'center', gap: '8px'
        }}>
          <FontAwesomeIcon icon={faMagnifyingGlass} style={{ color: 'var(--vscode-icon-foreground)' }} />
          <input
            ref={searchInputRef}
            type="text"
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') executeSearch(e.shiftKey);
            }}
            placeholder="在页面中查找... (Enter/Shift+Enter)"
            style={{
              background: 'var(--vscode-input-background)',
              color: 'var(--vscode-input-foreground)',
              border: '1px solid var(--vscode-input-border)',
              outline: 'none', padding: '4px 6px', width: '180px', borderRadius: '2px'
            }}
          />
          <button onClick={() => executeSearch(true)} style={searchBtnStyle} title="上一项 (Shift+Enter)">
            <FontAwesomeIcon icon={faChevronUp} />
          </button>
          <button onClick={() => executeSearch(false)} style={searchBtnStyle} title="下一项 (Enter)">
            <FontAwesomeIcon icon={faChevronDown} />
          </button>
          <div style={{ width: '1px', height: '16px', background: 'var(--vscode-editorWidget-border)', margin: '0 4px' }}></div>
          <button onClick={closeSearch} style={searchBtnStyle} title="关闭 (Esc)">
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>
      )}

      {/* 使用 srcDoc 将解析好的字符串安全塞入 iframe */}
      <iframe
        ref={iframeRef}
        srcDoc={htmlContent}
        title="html-preview"
        style={{ width: '100%', height: '100%', border: 'none', background: '#fff' }}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
      />
    </div>
  );
}

const searchBtnStyle: React.CSSProperties = {
  background: 'transparent', border: 'none', color: 'var(--vscode-icon-foreground)',
  cursor: 'pointer', padding: '4px', borderRadius: '3px', outline: 'none'
};