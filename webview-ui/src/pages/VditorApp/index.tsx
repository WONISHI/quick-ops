import { useEffect, useRef, useState } from 'react';
import Vditor from 'vditor';
import 'vditor/dist/index.css';
import { vscode } from '../../utils/vscode';
import styles from './index.module.css';
import { parseFileUriInfo } from '../../utils/index';

import { setupPlugins } from './plugins/setupPlugins';
import VditorMeta from './plugins/vditor-meta';
import VditorCompat from './plugins/vditor-compat';

interface VditorAppProps {
  /**
   * true：作为独立路由页面使用
   * false：作为其它页面里的组件使用
   */
  pageMode?: boolean;
}

export default function VditorApp(props: VditorAppProps) {
  const { pageMode = false } = props;

  const vditorRef = useRef<HTMLDivElement>(null);
  const vditorInstanceRef = useRef<Vditor | null>(null);
  const [isReadMode, setIsReadMode] = useState(false);

  const destroyVditor = () => {
    try {
      vditorInstanceRef.current?.destroy();
    } catch {
      // ignore
    }

    vditorInstanceRef.current = null;

    if (vditorRef.current) {
      vditorRef.current.innerHTML = '';
    }
  };

  const renderMarkdown = async (content: string, fsPath: string, mode: 'read' | 'edit') => {
    if (!vditorRef.current) return;

    destroyVditor();

    const { fileName } = parseFileUriInfo(fsPath);
    const isEdit = mode === 'edit';

    setIsReadMode(!isEdit);

    const appPlugins = setupPlugins();

    const processedContent = appPlugins
      .use(VditorMeta)
      .use(VditorCompat, {
        title: fileName || '文档预览',
      })
      .process(content || '');

    if (!isEdit) {
      await Vditor.preview(vditorRef.current, processedContent, {
        mode: 'light',
        theme: {
          current: 'classic',
        },
        markdown: {
          linkBase: '',
          linkPrefix: '',
          sanitize: false,
        },
        after: () => {
          const links = vditorRef.current?.querySelectorAll('a[href]') || [];

          links.forEach((link) => {
            const href = link.getAttribute('href') || '';

            if (href.startsWith('http://') || href.startsWith('https://')) {
              link.setAttribute('target', '_blank');
              link.setAttribute('rel', 'noopener noreferrer');
            }
          });
        },
      } as any);

      return;
    }

    const vd = new Vditor(vditorRef.current, {
      value: processedContent,
      mode: 'ir',
      theme: 'classic',
      lang: 'zh_CN',
      height: '100%',
      toolbar: undefined,
      toolbarConfig: {
        hide: false,
        pin: false,
      },
      cache: {
        enable: false,
      },
      preview: {
        theme: {
          current: 'classic',
        },
        markdown: {
          linkBase: '',
          linkPrefix: '',
          sanitize: false,
        },
      },
      after: () => {
        const vditorElement = vditorRef.current?.querySelector('.vditor') as HTMLElement | null;

        if (vditorElement) {
          vditorElement.style.height = '100%';
        }
      },
      input: () => {},
    });

    vditorInstanceRef.current = vd;
  };

  useEffect(() => {
    const handleGlobalClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;

      const copyBtn = target.closest('.meta-copy-btn');

      if (copyBtn) {
        const textToCopy = copyBtn.getAttribute('data-copy');

        if (textToCopy) {
          event.preventDefault();
          event.stopPropagation();

          vscode.postMessage({
            command: 'copyToClipboard',
            text: textToCopy,
          });

          return;
        }
      }

      const anchor = target.closest('a');
      const href = anchor?.getAttribute('href');

      if (anchor && href && (href.startsWith('http://') || href.startsWith('https://'))) {
        event.preventDefault();
        event.stopPropagation();

        vscode.postMessage({
          command: 'openExternal',
          url: href,
        });
      }
    };

    const handleMessage = (e: MessageEvent) => {
      const msg = e.data;

      if (msg.type === 'initVditorData') {
        void renderMarkdown(msg.content || '', msg.fsPath || '', msg.mode === 'edit' ? 'edit' : 'read');
      }

      if (msg.type === 'initLocalFileError') {
        destroyVditor();

        if (vditorRef.current) {
          vditorRef.current.innerHTML = `<div class="${styles['vditor-error']}">${msg.message || 'Markdown 文件读取失败'}</div>`;
        }
      }
    };

    window.addEventListener('message', handleMessage);
    window.addEventListener('click', handleGlobalClick, true);

    vscode.postMessage({
      command: 'webviewLoaded',
    });

    return () => {
      window.removeEventListener('message', handleMessage);
      window.removeEventListener('click', handleGlobalClick, true);
      destroyVditor();
    };
  }, []);

  return (
    <div
      className={`${styles['vditor-container']} ${pageMode ? styles['page-mode'] : ''} ${
        isReadMode ? styles['read-mode'] : ''
      }`}
    >
      <div ref={vditorRef} className={styles['vditor-wrapper']} />
    </div>
  );
}