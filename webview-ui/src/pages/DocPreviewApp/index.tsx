import { useEffect, useRef, useState } from 'react';
import { renderAsync } from 'docx-preview';
import { vscode } from '../../utils/vscode';
import wordIcon from 'material-icon-theme/icons/word.svg';
import styles from './index.module.css';

interface DocPreviewData {
  fsPath: string;
  fileName: string;
  extension?: string;
  contentBase64: string;
}

function base64ToArrayBuffer(base64: string) {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes.buffer;
}

function getFileExtension(data: DocPreviewData) {
  const extension = (data.extension || '').trim().toLowerCase();

  if (extension) {
    return extension.startsWith('.') ? extension : `.${extension}`;
  }

  const filePath = data.fileName || data.fsPath || '';
  const cleanPath = filePath.split('?')[0].split('#')[0];
  const match = cleanPath.match(/\.[^./\\]+$/);

  return match ? match[0].toLowerCase() : '';
}

export default function DocPreviewApp() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pendingDataRef = useRef<DocPreviewData | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');

  const renderDocx = async (data: DocPreviewData) => {
    const container = containerRef.current;

    if (!container) {
      pendingDataRef.current = data;
      return;
    }

    const extension = getFileExtension(data);

    setFileName(data.fileName || 'Word 文档');
    setError('');
    setLoading(true);
    container.innerHTML = '';

    if (!data.contentBase64) {
      setError('接收到的文件数据为空。');
      setLoading(false);
      return;
    }

    if (extension === '.doc') {
      setError('暂不支持旧版 .doc 预览，请转换为 .docx 后再预览。');
      setLoading(false);
      return;
    }

    if (extension !== '.docx') {
      setError(`暂不支持 ${extension || '该类型'} 文件预览。`);
      setLoading(false);
      return;
    }

    try {
      const arrayBuffer = base64ToArrayBuffer(data.contentBase64);

      await renderAsync(arrayBuffer, container, undefined, {
        className: styles['docx-content'],
        inWrapper: true,
        ignoreWidth: false,
        ignoreHeight: false,
        ignoreFonts: false,
        breakPages: true,
        renderHeaders: true,
        renderFooters: true,
        renderFootnotes: true,
        renderEndnotes: true,
        useBase64URL: true,
      });
    } catch (err: any) {
      setError(`Word 文档解析失败: ${err?.message || String(err)}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!containerRef.current || !pendingDataRef.current) return;

    const pendingData = pendingDataRef.current;
    pendingDataRef.current = null;

    void renderDocx(pendingData);
  }, []);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const msg = event.data;

      if (msg.type === 'initDocData') {
        void renderDocx({
          fsPath: msg.fsPath || '',
          fileName: msg.fileName || '',
          extension: msg.extension || '',
          contentBase64: msg.contentBase64 || '',
        });
        return;
      }

      if (msg.type === 'initDocError') {
        setFileName(msg.fileName || 'Word 预览');
        setError(msg.message || 'Word 文件读取失败。');
        setLoading(false);
      }
    };

    window.addEventListener('message', handleMessage);

    vscode.postMessage({
      command: 'webviewLoaded',
    });

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, []);

  return (
    <div className={styles['app-container']}>
      <div className={styles['toolbar']}>
        <div className={styles['toolbar-title']}>
          <img
            src={wordIcon}
            className={styles['toolbar-icon']}
            alt=""
            draggable={false}
          />
          <span className={styles['toolbar-file-name']}>{fileName || 'Word 预览'}</span>
        </div>
      </div>

      <div className={styles['render-area']}>
        {loading && (
          <div className={styles['status-view']}>
            <i className={`codicon codicon-loading codicon-modifier-spin ${styles['status-icon']}`} />
            <span>正在加载 Word 文档...</span>
          </div>
        )}

        {!!error && !loading && (
          <div className={`${styles['status-view']} ${styles['error-view']}`}>
            <i className={`codicon codicon-error ${styles['status-icon']}`} />
            <span>{error}</span>
          </div>
        )}

        <div
          ref={containerRef}
          className={`${styles['doc-container']} ${loading || error ? styles['doc-container-hidden'] : ''}`}
        />
      </div>
    </div>
  );
}