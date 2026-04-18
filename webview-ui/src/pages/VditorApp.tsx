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
              if (!isEdit) vd.disabled();
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
    <div style={{ height: '100vh', width: '100vw', backgroundColor: '#ffffff' }}>
      <style>
        {`
          /* 🌟 修复 1：去除 Vditor 默认的浅灰色背景 */
          .vditor, .vditor-ir, .vditor-reset {
            background-color: transparent !important;
          }
          
          /* 🌟 修复 2：打破默认 800px 最大宽度限制，填满两边空隙 */
          .vditor-ir {
            max-width: 100% !important;
            padding: 24px 40px !important;
          }

          /* 🌟 修复 3：解决 vd.disabled() 导致整体透明度变成 0.3 发灰的问题 */
          .vditor--disabled {
            opacity: 1 !important;
          }
          
          /* 强制加深字体颜色，告别灰蒙蒙 */
          .vditor-ir {
            color: #24292e !important;
          }

          /* 只读模式专属屏蔽 */
          ${isReadMode ? `
            .vditor-toolbar { display: none !important; }
            .vditor-ir { caret-color: transparent !important; } 
          ` : ''}
        `}
      </style>
      
      <div ref={vditorRef} style={{ border: 'none', height: '100%' }} />
    </div>
  );
}