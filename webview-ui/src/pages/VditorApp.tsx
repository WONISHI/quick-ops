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

          const vd = new Vditor(vditorRef.current, {
            value: msg.content,
            mode: 'ir',
            theme: 'classic',
            lang: 'zh_CN',
            // 🌟 核心修复：必须指定高度为视口高度，否则 Vditor 会无限伸展导致滚动条丢失！
            height: '100vh', 
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

    return () => {
      window.removeEventListener('message', handleMessage);
      vditor?.destroy();
    };
  }, []);

  return (
    // 🌟 外层加上 overflow: hidden，防止出现多余的白边或双滚动条
    <div style={{ height: '100vh', width: '100vw', backgroundColor: '#ffffff', overflow: 'hidden' }}>
      <style>
        {`
          /* 去除 Vditor 默认的浅灰色背景 */
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
          
          /* 强制加深字体颜色，告别灰蒙蒙 */
          .vditor-ir {
            color: #24292e !important;
          }

          /* 只读模式专属屏蔽 */
          ${isReadMode ? `
            .vditor-toolbar { display: none !important; }
            .vditor-ir { caret-color: transparent !important; } 

            /* 屏蔽点击代码块/公式时弹出的源码框（灰色背景的 \`\`\`JS） */
            .vditor-ir__marker,
            .vditor-ir__node--expand pre.vditor-ir__marker {
              display: none !important;
            }

            /* 屏蔽代码块点击后右上角弹出的语言修改输入框 */
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