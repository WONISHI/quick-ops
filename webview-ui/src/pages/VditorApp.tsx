import React, { useEffect, useRef, useState } from 'react';
import Vditor from 'vditor';
import 'vditor/dist/index.css';
import { vscode } from '../utils/vscode';

export default function VditorApp() {
  const vditorRef = useRef<HTMLDivElement>(null);
  const [vditor, setVditor] = useState<Vditor>();
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
            return match; // 找不到保持原样
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
              pin: false
            },
            cache: { enable: false },
            preview: {
              theme: {
                current: 'classic'
              }
            },
            after: () => {
              if (!isEdit) {
                const irElement = vditorRef.current?.querySelector('.vditor-ir');
                if (irElement) {
                  irElement.setAttribute('contenteditable', 'false');
                }
              }
            },
            input: (value: string) => {
              // vscode.postMessage({ command: 'saveMarkdown', content: value });
            }
          });
          
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
      vditor?.destroy();
    };
  }, []);

  return (
    <div style={{ height: '100vh', backgroundColor: '#ffffff' }}>
      <style>
        {`
          .vditor, .vditor-ir, .vditor-reset {
            background-color: transparent !important;
          }
          
          .vditor-ir, .vditor-reset {
            max-width: 100% !important;
            padding-left: 20px !important;
            padding-right: 20px !important;
            padding-top: 24px !important; 
            padding-bottom: 24px !important;
          }
          
          .vditor-ir {
            color: #24292e !important;
          }

          ${isReadMode ? `
            .vditor-toolbar { display: none !important; }
            .vditor-ir { caret-color: transparent !important; } 

            .vditor-ir__marker,
            .vditor-ir__node--expand pre.vditor-ir__marker {
              display: none !important;
            }

            .vditor-ir__info {
              display: none !important;
            }
          ` : ''}
        `}
      </style>
      <div ref={vditorRef} style={{ border: 'none', height: '100%' }} />
    </div>
  );
}