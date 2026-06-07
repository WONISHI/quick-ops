import { useEffect, useState } from 'react';
import { vscode } from '../../utils/vscode';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/TextLayer.css';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import styles from './index.module.css';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

interface PdfPreviewAppProps {
  initialScale?: number;
}

export default function PdfPreviewApp({ initialScale = 1.2 }: PdfPreviewAppProps) {
  const [loading, setLoading] = useState(true);
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
  };

  const changePage = (offset: number) => {
    setPageNumber((prev) => Math.min(Math.max(1, prev + offset), numPages || 1));
  };

  if (loading) {
    return (
      <div className={styles['status-view']}>
        <span
          className={`codicon codicon-loading codicon-modifier-spin ${styles['status-icon']} ${styles['loading-text']}`}
        />
        <span className={styles['loading-text']}>正在加载 PDF 文档...</span>
      </div>
    );
  }

  if (error || !pdfBase64) {
    return (
      <div className={styles['status-view']}>
        <span
          className={`codicon codicon-error ${styles['status-icon']} ${styles['error-icon']} ${styles['error-text']}`}
        />
        <span className={styles['error-text']}>{error || '加载失败或文件为空。'}</span>
      </div>
    );
  }

  return (
    <div className={styles['app-container']}>
      <div className={styles.toolbar}>
        <div className={styles['toolbar-group']}>
          <button
            onClick={() => setScale((s) => Math.max(0.3, s - 0.1))}
            className={styles['icon-btn']}
            title="缩小"
          >
            <span className="codicon codicon-zoom-out" />
          </button>

          <span className={styles['scale-text']}>{Math.round(scale * 100)}%</span>

          <button
            onClick={() => setScale((s) => Math.min(5.0, s + 0.1))}
            className={styles['icon-btn']}
            title="放大"
          >
            <span className="codicon codicon-zoom-in" />
          </button>
        </div>

        <div className={styles.divider} />

        <div className={styles['toolbar-group']}>
          <button
            onClick={() => changePage(-1)}
            disabled={pageNumber <= 1}
            className={styles['icon-btn']}
            title="上一页"
          >
            <span className="codicon codicon-chevron-left" />
          </button>

          <span className={styles['page-text']}>
            第 {pageNumber} / {numPages || '--'} 页
          </span>

          <button
            onClick={() => changePage(1)}
            disabled={pageNumber >= (numPages || 1)}
            className={styles['icon-btn']}
            title="下一页"
          >
            <span className="codicon codicon-chevron-right" />
          </button>
        </div>
      </div>

      <div className={styles['render-area']}>
        <Document
          file={`data:application/pdf;base64,${pdfBase64}`}
          onLoadSuccess={onDocumentLoadSuccess}
          onLoadError={(err) => setError(`PDF 解析失败: ${err.message}`)}
        >
          <div className={styles['page-wrapper']}>
            <Page
              pageNumber={pageNumber}
              scale={scale}
              renderTextLayer={true}
              renderAnnotationLayer={true}
            />
          </div>
        </Document>
      </div>
    </div>
  );
}