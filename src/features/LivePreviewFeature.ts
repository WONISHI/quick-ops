import * as vscode from 'vscode';
import { IFeature } from '../core/interfaces/IFeature';
import ColorLog from '../utils/ColorLog';
// 🌟 1. 引入 React Webview 辅助函数，移除原来的 getLivePreviewHtml
import { getReactWebviewHtml } from '../utils/WebviewHelper';

export class LivePreviewFeature implements IFeature {
  public readonly id = 'LivePreviewFeature';
  private panel: vscode.WebviewPanel | undefined;

  public activate(context: vscode.ExtensionContext): void {
    const command = vscode.commands.registerCommand('quick-ops.openLivePreview', () => {
      this.showPreviewPanel(context);
    });

    context.subscriptions.push(command);
    ColorLog.black(`[${this.id}]`, 'Activated.');
  }

  private showPreviewPanel(context: vscode.ExtensionContext) {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
      return;
    }

    this.panel = vscode.window.createWebviewPanel('quickOpsLivePreview', '网页预览 (Preview)', vscode.ViewColumn.Beside, {
      enableScripts: true,
      retainContextWhenHidden: true,
      enableFindWidget: true,
      // 🌟 2. 允许加载本地静态资源
      localResourceRoots: [context.extensionUri]
    });

    this.panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'icon.png');

    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });

    const lastUrl = context.workspaceState.get<string>('quickOps.lastPreviewUrl') || '';
    const lastDevice = context.workspaceState.get<string>('quickOps.lastPreviewDevice') || 'device-responsive';

    // 🌟 3. 使用 React Webview 页面，挂载到 `/preview` 路由
    this.panel.webview.html = getReactWebviewHtml(context.extensionUri, this.panel.webview, '/preview');

    // 🌟 4. 把 lastUrl 也放进初始化消息传给前端（前端收到后用来恢复上一次的输入框状态）
    setTimeout(() => {
      this.panel?.webview.postMessage({ type: 'init', device: lastDevice, url: lastUrl });
    }, 500);

    this.panel.webview.onDidReceiveMessage(async (message) => {
      // 🌟 5. 新增: 为了解决 setTimeout(500) 可能带来的时序问题，最好也监听前端的 ready 事件发数据
      if (message.type === 'ready') {
        this.panel?.webview.postMessage({ type: 'init', device: lastDevice, url: lastUrl });
      }
      else if (message.type === 'saveUrl') {
        await context.workspaceState.update('quickOps.lastPreviewUrl', message.url);
      } 
      else if (message.type === 'saveDevice') {
        await context.workspaceState.update('quickOps.lastPreviewDevice', message.device);
      } 
      // 请求同步数据
      else if (message.type === 'reqSyncFavorites') {
        const favs = context.globalState.get<any[]>('quickOps.globalFavorites') || [];
        this.panel?.webview.postMessage({ type: 'syncFavorites', favorites: favs });
      } 
      // 前端进行了增、删、改后，全量覆盖保存
      else if (message.type === 'saveAllFavorites') {
        await context.globalState.update('quickOps.globalFavorites', message.favorites);
        this.panel?.webview.postMessage({ type: 'syncFavorites', favorites: message.favorites });
      }
      // 点击星星快捷收藏 (加上时间戳)
      else if (message.type === 'toggleFavorite') {
        let favs = context.globalState.get<any[]>('quickOps.globalFavorites') || [];
        const index = favs.findIndex(f => f.url === message.url);
        
        if (index > -1) {
          favs.splice(index, 1);
          vscode.window.showInformationMessage('已取消收藏');
        } else {
          favs.push({ url: message.url, title: message.title, timestamp: Date.now() });
          vscode.window.showInformationMessage('⭐️ 已添加到全局收藏夹');
        }
        
        await context.globalState.update('quickOps.globalFavorites', favs);
        this.panel?.webview.postMessage({ type: 'syncFavorites', favorites: favs });
      }
      else if (message.type === 'showFindWidget') {
        vscode.commands.executeCommand('editor.action.webvieweditor.showFindWidget');
      }
      else if (message.type === 'openDevTools') {
        vscode.commands.executeCommand('workbench.action.webview.openDeveloperTools');
      } 
      else if (message.type === 'openExternalBrowser') {
        vscode.env.openExternal(vscode.Uri.parse(message.url));
      } 
      else if (message.type === 'showInfo') {
        vscode.window.showInformationMessage(message.message);
      } 
      else if (message.type === 'showWarning') {
        vscode.window.showWarningMessage(message.message);
      } 
      else if (message.type === 'showError') {
        vscode.window.showErrorMessage(message.message);
      } 
      else if (message.type === 'vConsoleFallback') {
        const snippet = `<script src="https://unpkg.com/vconsole@latest/dist/vconsole.min.js"></script>\n<script>window.vConsole = new window.VConsole();</script>`;
        await vscode.env.clipboard.writeText(snippet);
        vscode.window.showInformationMessage(
          '由于跨域安全限制，无法直接注入 iframe。\n\n✅ 已为您复制了 vConsole 代码！请直接去项目中「粘贴 (Ctrl+V)」到 index.html 的 <head> 标签内即可生效。',
          { modal: true }
        );
      }
    });
  }
}