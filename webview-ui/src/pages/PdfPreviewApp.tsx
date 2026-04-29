import React, { useEffect, useState } from 'react';
import { vscode } from '../utils/vscode';
import { Document, Page, pdfjs } from 'react-pdf';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
).toString();

export default function PdfPreviewApp() {
    const [loading, setLoading] = useState(true);
    const [pdfBase64, setPdfBase64] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    // PDF 控制状态
    const [numPages, setNumPages] = useState<number | null>(null);
    const [pageNumber, setPageNumber] = useState(1);
    const [scale, setScale] = useState(1.2); // 默认缩放比例

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
                setLoading(false);
            }
        };

        window.addEventListener('message', handleMessage);

        // 通知后端 Webview 已就绪，可以发送 PDF 数据了
        vscode.postMessage({ command: 'webviewLoaded' });

        return () => window.removeEventListener('message', handleMessage);
    }, []);

    const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
        setNumPages(numPages);
        setPageNumber(1);
    };

    const changePage = (offset: number) => {
        setPageNumber((prevPageNumber) => {
            const newPage = prevPageNumber + offset;
            return Math.min(Math.max(1, newPage), numPages || 1);
        });
    };

    if (loading) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', color: 'var(--vscode-editor-foreground)', fontSize: '14px' }}>
                <span className="codicon codicon-loading codicon-modifier-spin" style={{ marginRight: '8px', fontSize: '18px' }}></span>
                正在加载 PDF 文档...
            </div>
        );
    }

    if (error || !pdfBase64) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', color: 'var(--vscode-errorForeground)' }}>
                <span className="codicon codicon-error" style={{ marginRight: '8px', fontSize: '24px' }}></span>
                {error || '加载失败或文件为空。'}
            </div>
        );
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', backgroundColor: 'var(--vscode-editor-background)' }}>

            {/* 顶部工具栏 */}
            <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '16px',
                padding: '8px',
                backgroundColor: 'var(--vscode-editorGroupHeader-tabsBackground)',
                borderBottom: '1px solid var(--vscode-panel-border)',
                color: 'var(--vscode-foreground)',
                flexShrink: 0
            }}>
                <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                        onClick={() => setScale(s => Math.max(0.5, s - 0.2))}
                        style={btnStyle}
                        title="缩小"
                    >
                        <span className="codicon codicon-zoom-out"></span>
                    </button>
                    <span style={{ fontSize: '13px', minWidth: '40px', textAlign: 'center', lineHeight: '24px' }}>
                        {Math.round(scale * 100)}%
                    </span>
                    <button
                        onClick={() => setScale(s => Math.min(3.0, s + 0.2))}
                        style={btnStyle}
                        title="放大"
                    >
                        <span className="codicon codicon-zoom-in"></span>
                    </button>
                </div>

                <div style={{ width: '1px', height: '16px', backgroundColor: 'var(--vscode-panel-border)' }}></div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button
                        onClick={() => changePage(-1)}
                        disabled={pageNumber <= 1}
                        style={{ ...btnStyle, opacity: pageNumber <= 1 ? 0.5 : 1, cursor: pageNumber <= 1 ? 'not-allowed' : 'pointer' }}
                    >
                        <span className="codicon codicon-chevron-left"></span>
                    </button>

                    <span style={{ fontSize: '13px' }}>
                        第 {pageNumber} 页，共 {numPages || '--'} 页
                    </span>

                    <button
                        onClick={() => changePage(1)}
                        disabled={pageNumber >= (numPages || 1)}
                        style={{ ...btnStyle, opacity: pageNumber >= (numPages || 1) ? 0.5 : 1, cursor: pageNumber >= (numPages || 1) ? 'not-allowed' : 'pointer' }}
                    >
                        <span className="codicon codicon-chevron-right"></span>
                    </button>
                </div>
            </div>

            {/* PDF 渲染区域 */}
            <div style={{ flex: 1, overflow: 'auto', display: 'flex', justifyContent: 'center', padding: '20px' }}>
                <Document
                    file={`data:application/pdf;base64,${pdfBase64}`}
                    onLoadSuccess={onDocumentLoadSuccess}
                    onLoadError={(err) => setError(`PDF 引擎解析失败: ${err.message}`)}
                    loading={
                        <div style={{ color: 'var(--vscode-descriptionForeground)' }}>
                            正在解析文档页面...
                        </div>
                    }
                >
                    {/* 将背景设置为白色，因为很多 PDF 是透明背景，在暗色主题下会看不清字 */}
                    <div style={{ backgroundColor: '#ffffff', boxShadow: '0 4px 8px rgba(0,0,0,0.2)' }}>
                        <Page
                            pageNumber={pageNumber}
                            scale={scale}
                            renderTextLayer={false}
                            renderAnnotationLayer={false}
                        />
                    </div>
                </Document>
            </div>
        </div>
    );
}

// 统一的按钮内联样式（适配 VS Code 质感）
const btnStyle: React.CSSProperties = {
    background: 'transparent',
    border: 'none',
    color: 'var(--vscode-icon-foreground)',
    cursor: 'pointer',
    padding: '4px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '3px'
};