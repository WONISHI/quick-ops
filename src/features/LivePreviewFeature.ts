import * as vscode from 'vscode';
import { IFeature } from '../core/interfaces/IFeature';
import ColorLog from '../utils/ColorLog';
import { getLivePreviewHtml } from '../views/LivePreviewWebviewHtml'; // 引入分离的HTML

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
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
      return;
    }

    this.panel = vscode.window.createWebviewPanel('quickOpsLivePreview', '网页预览 (Preview)', vscode.ViewColumn.Beside, {
      enableScripts: true,
      retainContextWhenHidden: true,
    });

    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });

    // 读取缓存的 URL 和设备类型
    const lastUrl = context.workspaceState.get<string>('quickOps.lastPreviewUrl') || 'http://localhost:5173';
    const lastDevice = context.workspaceState.get<string>('quickOps.lastPreviewDevice') || 'device-responsive';

    this.panel.webview.html = getLivePreviewHtml(lastUrl);

    // 等待 Webview 加载完毕后，初始化设备状态
    setTimeout(() => {
      this.panel?.webview.postMessage({ type: 'init', device: lastDevice });
    }, 500);

    // 监听 Webview 的消息
    this.panel.webview.onDidReceiveMessage(async (message) => {
      if (message.type === 'saveUrl') {
        await context.workspaceState.update('quickOps.lastPreviewUrl', message.url);
      } else if (message.type === 'saveDevice') {
        await context.workspaceState.update('quickOps.lastPreviewDevice', message.device);
      } else if (message.type === 'openDevTools') {
        // 🌟 核心：触发 VS Code 原生的 Webview 开发者工具！
        vscode.commands.executeCommand('workbench.action.webview.openDeveloperTools');
      }
    });
  }
}
