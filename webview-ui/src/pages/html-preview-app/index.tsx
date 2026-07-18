import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { vscode } from '@utils/vscode';
import styles from './index.module.css';

interface HtmlPreviewAppProps {
  fsPath?: string;
  iframeRef?: RefObject<HTMLIFrameElement | null>;
  onTitleChange?: (title: string) => void;
}

interface HtmlPreviewMessage {
  type?: string;
  fsPath?: string;
  content?: string;
  message?: string;
}

export default function HtmlPreviewApp(props: HtmlPreviewAppProps) {
  const { iframeRef, onTitleChange } = props;

  const internalIframeRef = useRef<HTMLIFrameElement | null>(null);
  const currentIframeRef = iframeRef || internalIframeRef;

  /**
   * 当前正在预览的文件路径不参与页面渲染，
   * 使用 ref 避免消息监听函数读取到旧值。
   */
  const currentFsPathRef = useRef(props.fsPath || '');

  const [htmlContent, setHtmlContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    /**
     * @description 请求加载指定的本地 HTML 文件
     */
    const loadLocalHtmlFile = (fsPath: string) => {
      const nextFsPath = String(fsPath || '').trim();

      currentFsPathRef.current = nextFsPath;
      setHtmlContent('');
      setErrorMessage('');

      if (!nextFsPath) {
        setLoading(false);
        setErrorMessage('HTML 文件路径不能为空');
        return;
      }

      setLoading(true);

      vscode?.postMessage({
        type: 'loadLocalHtmlFile',
        fsPath: nextFsPath,
      });
    };

    /**
     * @description 接收 Extension Host 发送的 HTML 预览消息
     */
    const handleMessage = (event: MessageEvent<HtmlPreviewMessage>) => {
      const message = event.data;

      if (!message || typeof message !== 'object') return;

      if (message.type === 'initHtmlPreviewPath') {
        loadLocalHtmlFile(message.fsPath || '');
        return;
      }

      if (message.type === 'initHtmlData') {
        const currentFsPath = currentFsPathRef.current;

        if (message.fsPath && currentFsPath && message.fsPath !== currentFsPath) {
          return;
        }

        setHtmlContent(message.content || '');
        setErrorMessage('');
        setLoading(false);
        return;
      }

      if (message.type === 'initLocalFileError') {
        const currentFsPath = currentFsPathRef.current;

        if (message.fsPath && currentFsPath && message.fsPath !== currentFsPath) {
          return;
        }

        setHtmlContent('');
        setErrorMessage(message.message || 'HTML 文件读取失败');
        setLoading(false);
      }
    };

    window.addEventListener('message', handleMessage);

    vscode?.postMessage({
      command: 'webviewLoaded',
    });

    /**
     * props.fsPath 存在时直接向 Extension Host 请求文件。
     * 这里只同步外部系统，不同步调用 setState。
     */
    const initialFsPath = currentFsPathRef.current;

    if (initialFsPath) {
      vscode?.postMessage({
        type: 'loadLocalHtmlFile',
        fsPath: initialFsPath,
      });
    }

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, []);

  /**
   * @description HTML iframe 加载完成后同步页面标题
   */
  const handleIframeLoad = () => {
    try {
      const iframe = currentIframeRef.current;
      const doc = iframe?.contentDocument || iframe?.contentWindow?.document;

      const title = doc?.title?.trim();

      if (title) {
        onTitleChange?.(title);
      }
    } catch {
      // srcDoc 通常允许读取，遇到跨域或安全限制时忽略
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
      <div className={[styles['html-preview-state'], styles.error].filter(Boolean).join(' ')}>
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
