import { useEffect, useRef, useState } from 'react';
import { renderAsync } from 'docx-preview';
import Skeleton, { SkeletonTheme } from 'react-loading-skeleton';
import 'react-loading-skeleton/dist/skeleton.css';
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

/**
 * @description Word 文档加载骨架屏
 */
function DocPreviewSkeleton() {
  const lineWidths = ['92%', '86%', '78%', '94%', '72%', '88%', '64%', '90%', '82%', '70%'];

  return (
    <div className={styles['skeleton-view']}>
      <div className={styles['skeleton-page']}>
        <SkeletonTheme baseColor="#e5e7eb" highlightColor="#f3f4f6" borderRadius={3} duration={1.35}>
          <div className={styles['skeleton-page-content']}>
            <Skeleton width="42%" height={22} />

            <div className={styles['skeleton-meta']}>
              <Skeleton width="28%" height={10} />
              <Skeleton width="18%" height={10} />
            </div>

            <div className={styles['skeleton-paragraph']}>
              {lineWidths.slice(0, 5).map((width, index) => (
                <Skeleton key={index} width={width} height={11} />
              ))}
            </div>

            <div className={styles['skeleton-heading']}>
              <Skeleton width="34%" height={16} />
            </div>

            <div className={styles['skeleton-paragraph']}>
              {lineWidths.slice(5).map((width, index) => (
                <Skeleton key={index} width={width} height={11} />
              ))}
            </div>

            <div className={styles['skeleton-table']}>
              {Array.from({ length: 12 }).map((_, index) => (
                <Skeleton key={index} width="100%" height={28} borderRadius={0} />
              ))}
            </div>
          </div>
        </SkeletonTheme>
      </div>
    </div>
  );
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
          <img src={wordIcon} className={styles['toolbar-icon']} alt="" draggable={false} />

          {loading && !fileName ? (
            <Skeleton
              width={132}
              height={12}
              baseColor="var(--vscode-list-inactiveSelectionBackground, rgba(127, 127, 127, 0.12))"
              highlightColor="var(--vscode-list-hoverBackground, rgba(127, 127, 127, 0.2))"
            />
          ) : (
            <span className={styles['toolbar-file-name']}>{fileName || 'Word 预览'}</span>
          )}
        </div>
      </div>

      <div className={styles['render-area']}>
        {loading && <DocPreviewSkeleton />}

        {!!error && !loading && (
          <div className={`${styles['status-view']} ${styles['error-view']}`}>
            <i className={`codicon codicon-error ${styles['status-icon']}`} />
            <span>{error}</span>
          </div>
        )}

        <div ref={containerRef} className={`${styles['doc-container']} ${loading || error ? styles['doc-container-hidden'] : ''}`} />
      </div>
    </div>
  );
}
