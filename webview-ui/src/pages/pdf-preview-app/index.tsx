import { useEffect, useState } from 'react';
import { vscode } from '@utils/vscode';
import { Document, Page, pdfjs } from 'react-pdf';
import Skeleton from 'react-loading-skeleton';
import 'react-loading-skeleton/dist/skeleton.css';
import 'react-pdf/dist/Page/TextLayer.css';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import styles from '@pages/pdf-preview-app/index.module.css';
import PdfPreviewSkeleton from '@pages/pdf-preview-app/components/pdf-preview-skeleton';
import type { PdfPreviewAppProps } from '@pages/pdf-preview-app/src/type';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.296/build/pdf.worker.min.mjs', import.meta.url).toString();

export default function PdfPreviewApp({ initialScale = 1.2 }: PdfPreviewAppProps) {
  const [loading, setLoading] = useState(true);
  const [documentLoading, setDocumentLoading] = useState(true);
  const [pdfBase64, setPdfBase64] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [numPages, setNumPages] = useState<number | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(initialScale);

  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      const msg = e.data;

      if (msg.type === 'initPdfData') {
        if (!msg.contentBase64) {
          setError('接收到的文件数据为空');
          setLoading(false);
          return;
        }

        setPdfBase64(msg.contentBase64);
        setDocumentLoading(true);

        if (msg.initialScale) {
          const finalScale = msg.initialScale > 10 ? msg.initialScale / 100 : msg.initialScale;
          setScale(finalScale);
        }

        setLoading(false);
      }
    };

    window.addEventListener('message', handleMessage);
    vscode.postMessage({ command: 'webviewLoaded' });

    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    setPageNumber(1);
    setDocumentLoading(false);
  };

  const changePage = (offset: number) => {
    setPageNumber((prev) => Math.min(Math.max(1, prev + offset), numPages || 1));
  };

  if (loading) {
    return (
      <div className={styles['app-container']}>
        <div className={styles.toolbar}>
          <Skeleton
            width={148}
            height={12}
            baseColor="var(--vscode-list-inactiveSelectionBackground, rgba(127, 127, 127, 0.12))"
            highlightColor="var(--vscode-list-hoverBackground, rgba(127, 127, 127, 0.2))"
          />
        </div>

        <div className={styles['render-area']}>
          <PdfPreviewSkeleton />
        </div>
      </div>
    );
  }

  if (error || !pdfBase64) {
    return (
      <div className={styles['status-view']}>
        <span className={`codicon codicon-error ${styles['status-icon']} ${styles['error-icon']} ${styles['error-text']}`} />
        <span className={styles['error-text']}>{error || '加载失败或文件为空。'}</span>
      </div>
    );
  }

  return (
    <div className={styles['app-container']}>
      <div className={styles.toolbar}>
        <div className={styles['toolbar-group']}>
          <button onClick={() => setScale((s) => Math.max(0.3, s - 0.1))} className={styles['icon-btn']} title="缩小">
            <span className="codicon codicon-zoom-out" />
          </button>

          <span className={styles['scale-text']}>{Math.round(scale * 100)}%</span>

          <button onClick={() => setScale((s) => Math.min(5.0, s + 0.1))} className={styles['icon-btn']} title="放大">
            <span className="codicon codicon-zoom-in" />
          </button>
        </div>

        <div className={styles.divider} />

        <div className={styles['toolbar-group']}>
          <button onClick={() => changePage(-1)} disabled={pageNumber <= 1} className={styles['icon-btn']} title="上一页">
            <span className="codicon codicon-chevron-left" />
          </button>

          <span className={styles['page-text']}>
            第 {pageNumber} / {numPages || '--'} 页
          </span>

          <button onClick={() => changePage(1)} disabled={pageNumber >= (numPages || 1)} className={styles['icon-btn']} title="下一页">
            <span className="codicon codicon-chevron-right" />
          </button>
        </div>
      </div>

      <div className={styles['render-area']}>
        {documentLoading && <PdfPreviewSkeleton />}

        <div className={documentLoading ? styles['document-hidden'] : ''}>
          <Document
            file={`data:application/pdf;base64,${pdfBase64}`}
            onLoadSuccess={onDocumentLoadSuccess}
            onLoadError={(err) => {
              setDocumentLoading(false);
              setError(`PDF 解析失败: ${err.message}`);
            }}
          >
            <div className={styles['page-wrapper']}>
              <Page pageNumber={pageNumber} scale={scale} renderTextLayer={true} renderAnnotationLayer={true} />
            </div>
          </Document>
        </div>
      </div>
    </div>
  );
}
