import * as vscode from 'vscode';
import { IFeature } from '../core/interfaces/IFeature';
import ColorLog from '../utils/ColorLog';
import { getReactWebviewHtml } from '../utils/WebviewHelper';
import ProxyPreviewService, { type ProxyPreviewConfig } from '../services/ProxyPreviewService';

interface ProxyPreviewWebviewMessage {
  command: 'ready' | 'getConfig' | 'saveConfig' | 'start' | 'stop' | 'open';
  config?: ProxyPreviewConfig;
}

export class ProxyPreviewFeature implements IFeature {
  public readonly id = 'ProxyPreviewFeature';

  private panel: vscode.WebviewPanel | undefined;
  private proxyService: ProxyPreviewService | undefined;

  public activate(context: vscode.ExtensionContext): void {
    this.proxyService = new ProxyPreviewService(context);

    context.subscriptions.push(
      vscode.commands.registerCommand('quick-ops.proxyPreview.open', () => {
        this.openPanel(context);
      }),
      {
        dispose: () => {
          void this.proxyService?.dispose();
          this.proxyService = undefined;
        },
      },
    );

    ColorLog.black(`[${this.id}]`, 'Activated.');
  }

  private openPanel(context: vscode.ExtensionContext): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
      this.postStatus();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'quickOpsProxyPreview',
      '代理预览',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [context.extensionUri],
      },
    );

    this.panel.webview.html = getReactWebviewHtml(context.extensionUri, this.panel.webview, '/proxy-preview');

    this.panel.webview.onDidReceiveMessage(async (message: ProxyPreviewWebviewMessage) => {
      await this.handleWebviewMessage(message);
    });

    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });
  }

  private async handleWebviewMessage(message: ProxyPreviewWebviewMessage): Promise<void> {
    if (!this.proxyService) return;

    try {
      switch (message.command) {
        case 'ready':
        case 'getConfig':
          this.postStatus();
          break;

        case 'saveConfig':
          if (message.config) {
            await this.proxyService.saveConfig(message.config);
          }

          this.postStatus();
          vscode.window.showInformationMessage('代理配置已保存。');
          break;

        case 'start':
          await this.proxyService.start(message.config);
          this.postStatus();
          vscode.window.showInformationMessage('代理预览已启动。');
          break;

        case 'stop':
          await this.proxyService.stop();
          this.postStatus();
          vscode.window.showInformationMessage('代理预览已停止。');
          break;

        case 'open':
          await vscode.env.openExternal(vscode.Uri.parse(this.proxyService.getProxyUrl()));
          break;
      }
    } catch (error: any) {
      const messageText = error?.message || String(error);

      this.panel?.webview.postMessage({
        type: 'error',
        message: messageText,
      });

      vscode.window.showErrorMessage(`代理预览操作失败：${messageText}`);
    }
  }

  private postStatus(): void {
    if (!this.panel || !this.proxyService) return;

    this.panel.webview.postMessage({
      type: 'status',
      config: this.proxyService.getConfig(),
      status: this.proxyService.getStatus(),
    });
  }
}
