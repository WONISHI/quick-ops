import * as vscode from 'vscode';
import { IFeature } from '../core/interfaces/IFeature';
import ColorLog from '../utils/ColorLog';

export class LivePreviewFeature implements IFeature {
  public readonly id = 'LivePreviewFeature';
  private panel: vscode.WebviewPanel | undefined;

  public activate(context: vscode.ExtensionContext): void {
    const command = vscode.commands.registerCommand('quickOps.openLivePreview', () => {
      this.showPreviewPanel(context);
    });

    context.subscriptions.push(command);
    ColorLog.black(`[${this.id}]`, 'Activated.');
  }

  private showPreviewPanel(context: vscode.ExtensionContext) {
    // 如果已经打开了，就直接聚焦
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
      return;
    }

    // 创建一个新的 Webview 放在侧边分屏
    this.panel = vscode.window.createWebviewPanel(
      'quickOpsLivePreview',
      '网页预览台 (Preview)',
      vscode.ViewColumn.Beside, // 永远在侧边打开，方便边写边看
      {
        enableScripts: true,
        retainContextWhenHidden: true, // 切换回代码 tab 时不销毁网页，保持页面状态
      },
    );

    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });

    // 从缓存读取上次的预览地址，默认给一个 Vite 的常用端口
    const lastUrl = context.workspaceState.get<string>('quickOps.lastPreviewUrl') || 'http://localhost:5173';

    this.panel.webview.html = this.getWebviewContent(lastUrl);

    // 监听 Webview 传来的保存 URL 消息
    this.panel.webview.onDidReceiveMessage(async (message) => {
      if (message.type === 'saveUrl') {
        await context.workspaceState.update('quickOps.lastPreviewUrl', message.url);
      }
    });
  }

  private getWebviewContent(defaultUrl: string): string {
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        html, body { margin: 0; padding: 0; height: 100%; overflow: hidden; background-color: #fff; }
        .toolbar { 
          display: flex; padding: 8px 12px; background: var(--vscode-editor-background); 
          border-bottom: 1px solid var(--vscode-panel-border); gap: 10px; align-items: center; 
        }
        .address-bar { 
          flex: 1; padding: 6px 12px; border: 1px solid var(--vscode-input-border); 
          background: var(--vscode-input-background); color: var(--vscode-input-foreground); 
          border-radius: 4px; outline: none; font-family: monospace; font-size: 13px; 
        }
        .address-bar:focus { border-color: var(--vscode-focusBorder); }
        button { 
          background: var(--vscode-button-background); color: var(--vscode-button-foreground); 
          border: none; padding: 6px 14px; border-radius: 4px; cursor: pointer; font-size: 12px; 
          font-weight: 500; display: flex; align-items: center; gap: 6px;
        }
        button:hover { background: var(--vscode-button-hoverBackground); }
        .icon { font-size: 14px; }
        /* 让底部的 iframe 填满剩余空间，背景纯白防止深色模式下闪烁 */
        iframe { width: 100%; height: calc(100vh - 46px); border: none; background: #fff; }
      </style>
    </head>
    <body>
      <div class="toolbar">
        <button id="refreshBtn" title="刷新页面"><span class="icon">🔄</span> 刷新</button>
        <input type="text" id="urlInput" class="address-bar" value="${defaultUrl}" placeholder="输入本地服务地址，如: http://localhost:8080" />
        <button id="goBtn" title="访问该地址"><span class="icon">🚀</span> 访问</button>
      </div>
      <iframe id="previewFrame" src="${defaultUrl}" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals" allow="clipboard-read; clipboard-write;"></iframe>
      <script>
        const vscode = acquireVsCodeApi();
        const urlInput = document.getElementById('urlInput');
        const previewFrame = document.getElementById('previewFrame');
        const goBtn = document.getElementById('goBtn');
        const refreshBtn = document.getElementById('refreshBtn');

        function loadUrl() {
          let url = urlInput.value.trim();
          if (!url) return;
          // 自动补全 http 协议
          if (!url.startsWith('http://') && !url.startsWith('https://')) {
            url = 'http://' + url;
            urlInput.value = url;
          }
          previewFrame.src = url;
          vscode.postMessage({ type: 'saveUrl', url: url });
        }

        goBtn.addEventListener('click', loadUrl);
        refreshBtn.addEventListener('click', () => {
          // 巧用重新赋值 src 触发 iframe 强刷新
          previewFrame.src = previewFrame.src; 
        });
        urlInput.addEventListener('keypress', (e) => {
          if (e.key === 'Enter') loadUrl();
        });
      </script>
    </body>
    </html>`;
  }
}
