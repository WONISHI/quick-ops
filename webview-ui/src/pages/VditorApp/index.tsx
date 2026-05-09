import { useEffect, useRef, useState } from 'react';
import Vditor from 'vditor';
import 'vditor/dist/index.css';
import { vscode } from '../../utils/vscode';
import styles from './index.module.css';
import { parseFileUriInfo } from "../../utils/index"

import { setupPlugins } from './plugins/setupPlugins';
import VditorMeta from './plugins/vditor-meta';
import VditorCompat from './plugins/vditor-compat';

export default function VditorApp() {
  const vditorRef = useRef<HTMLDivElement>(null);
  const vditorInstanceRef = useRef<Vditor | null>(null);
  const [, setVditor] = useState<Vditor>();
  const [isReadMode, setIsReadMode] = useState(false);

  useEffect(() => {
    vscode.postMessage({ command: 'webviewLoaded' });

    const handleGlobalClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;

      const copyBtn = target.closest('.meta-copy-btn');
      if (copyBtn) {
        const textToCopy = copyBtn.getAttribute('data-copy');
        if (textToCopy) {
          event.preventDefault();
          event.stopPropagation();
          vscode.postMessage({ command: 'copyToClipboard', text: textToCopy });
          return;
        }
      }

      const anchor = target.closest('a');
      const href = anchor?.getAttribute('href');

      if (anchor && href && (href.startsWith('http://') || href.startsWith('https://'))) {
        event.preventDefault();
        event.stopPropagation();

        // 抛出指令给 VS Code 后端，让其调用原生浏览器打开
        vscode.postMessage({ command: 'openExternal', url: href });
      }
    };

    window.addEventListener('click', handleGlobalClick, true);

    const handleMessage = (e: MessageEvent) => {
      const msg = e.data;

      if (msg.type === 'initVditorData') {
        const { fileName } = parseFileUriInfo(msg.fsPath)
        if (vditorRef.current) {
          const isEdit = msg.mode === 'edit';
          setIsReadMode(!isEdit);

          const appPlugins = setupPlugins();
          const processedContent = appPlugins
            .use(VditorMeta)
            .use(VditorCompat, { title: fileName || '文档预览' })
            .process(msg.content);

          const vd = new Vditor(vditorRef.current, {
            value: processedContent,
            mode: 'ir',
            theme: 'classic',
            lang: 'zh_CN',
            height: window.innerHeight,
            toolbar: isEdit ? undefined : [],
            toolbarConfig: {
              hide: !isEdit,
              pin: false,
            },
            cache: { enable: false },
            preview: {
              theme: {
                current: 'classic',
              },
              markdown: {
                linkBase: '',
                linkPrefix: '',
              },
            },
            after: () => {
              if (!isEdit) {
                const irElement = vditorRef.current?.querySelector('.vditor-ir');
                if (irElement) {
                  irElement.setAttribute('contenteditable', 'false');
                }
              }
            },
            input: () => { },
          });

          vditorInstanceRef.current = vd;
          setVditor(vd);
        }
      }
    };

    window.addEventListener('message', handleMessage);

    const handleResize = () => {
      if (vditorRef.current) {
        const vditorElement = vditorRef.current.querySelector('.vditor') as HTMLElement;
        if (vditorElement) {
          vditorElement.style.height = `${window.innerHeight}px`;
        }
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('message', handleMessage);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('click', handleGlobalClick, true);
      vditorInstanceRef.current?.destroy();
    };
  }, []);

  return (
    <div className={`${styles['vditor-container']} ${isReadMode ? styles['read-mode'] : ''}`}>
      <div ref={vditorRef} className={styles['vditor-wrapper']} />
    </div>
  );
}
