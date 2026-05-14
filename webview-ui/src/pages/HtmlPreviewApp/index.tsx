import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { vscode } from '../../utils/vscode';
import styles from './index.module.css';

interface HtmlPreviewAppProps {
  fsPath?: string;
  iframeRef?: RefObject<HTMLIFrameElement | null>;
  onTitleChange?: (title: string) => void;
}

export default function HtmlPreviewApp(props: HtmlPreviewAppProps) {
  const { iframeRef, onTitleChange } = props;

  const internalIframeRef = useRef<HTMLIFrameElement | null>(null);
  const currentIframeRef = iframeRef || internalIframeRef;

  const [currentFsPath, setCurrentFsPath] = useState(props.fsPath || '');
  const [htmlContent, setHtmlContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;

      if (message.type === 'initHtmlPreviewPath') {
        setCurrentFsPath(message.fsPath || '');
      }

      if (message.type === 'initHtmlData') {
        if (message.fsPath && currentFsPath && message.fsPath !== currentFsPath) return;

        setHtmlContent(message.content || '');
        setErrorMessage('');
        setLoading(false);
      }

      if (message.type === 'initLocalFileError') {
        if (message.fsPath && currentFsPath && message.fsPath !== currentFsPath) return;

        setHtmlContent('');
        setErrorMessage(message.message || 'HTML 文件读取失败');
        setLoading(false);
      }
    };

    window.addEventListener('message', handleMessage);

    vscode?.postMessage({
      command: 'webviewLoaded',
    });

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [currentFsPath]);

  useEffect(() => {
    if (!currentFsPath) return;

    setLoading(true);
    setErrorMessage('');
    setHtmlContent('');

    vscode?.postMessage({
      type: 'loadLocalHtmlFile',
      fsPath: currentFsPath,
    });
  }, [currentFsPath]);

  const handleIframeLoad = () => {
    try {
      const doc = currentIframeRef.current?.contentDocument || currentIframeRef.current?.contentWindow?.document;
      const title = doc?.title?.trim();

      if (title) {
        onTitleChange?.(title);
      }
    } catch {
      // srcDoc 大多数情况下可读，异常时忽略即可
    }
  };

  if (loading) {
    return (
      <div className={styles['html-preview-state']}>
        <div className={styles['html-preview-spinner']} />
        <div className={styles['html-preview-text']}>正在加载本地 HTML...</div>
      </div>
    );
  }

  if (errorMessage) {
    return (
      <div className={`${styles['html-preview-state']} ${styles['error']}`}>
        <div className={styles['html-preview-title']}>HTML 预览失败</div>
        <div className={styles['html-preview-text']}>{errorMessage}</div>
      </div>
    );
  }

  return (
    <iframe
      ref={currentIframeRef}
      srcDoc={htmlContent}
      className={styles['html-preview-iframe']}
      title="html-preview"
      onLoad={handleIframeLoad}
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
    />
  );
}