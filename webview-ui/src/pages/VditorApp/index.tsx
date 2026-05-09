import { useEffect, useRef, useState } from 'react';
import Vditor from 'vditor';
import 'vditor/dist/index.css';
import { vscode } from '../../utils/vscode';
import styles from './index.module.css';

export default function VditorApp() {
  const vditorRef = useRef<HTMLDivElement>(null);
  const vditorInstanceRef = useRef<Vditor | null>(null);

  const [, setVditor] = useState<Vditor>();
  const [isReadMode, setIsReadMode] = useState(false);

  useEffect(() => {
    vscode.postMessage({ command: 'webviewLoaded' });

    const handleMessage = (e: MessageEvent) => {
      const msg = e.data;

      if (msg.type === 'initVditorData') {
        if (vditorRef.current) {
          const isEdit = msg.mode === 'edit';
          setIsReadMode(!isEdit);

          let processedContent = msg.content;

          const wikiRegex = /!\[\[(.*?)\]\]/g;
          processedContent = processedContent.replace(wikiRegex, (_: string, rawImageName: string) => {
            const exactName = rawImageName.trim();
            if (msg.imageMap && msg.imageMap[exactName]) {
              return `![${exactName}](${msg.imageMap[exactName]})`;
            }
            return `![${exactName}](${exactName})`;
          });

          const mdRegex = /!\[(.*?)\]\((.*?)\)/g;
          processedContent = processedContent.replace(mdRegex, (match: string, alt: string, path: string) => {
            const exactPath = path.trim();
            if (msg.imageMap && msg.imageMap[exactPath]) {
              return `![${alt}](${msg.imageMap[exactPath]})`;
            }
            return match;
          });

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
            },
            after: () => {
              if (!isEdit) {
                const irElement = vditorRef.current?.querySelector('.vditor-ir');
                if (irElement) {
                  irElement.setAttribute('contenteditable', 'false');
                }
              }
            },
            input: () => {
              // vscode.postMessage({ command: 'saveMarkdown', content: value });
            },
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
      vditorInstanceRef.current?.destroy();
    };
  }, []);

  return (
    <div className={`${styles['vditor-container']} ${isReadMode ? styles['read-mode'] : ''}`}>
      <div ref={vditorRef} className={styles['vditor-wrapper']} />
    </div>
  );
}