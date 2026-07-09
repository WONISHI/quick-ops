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

    const openCommand = vscode.commands.registerCommand('quick-ops.proxyPreview.open', () => {
      this.toggleProxyPreviewPanel(context);
    });

    context.subscriptions.push(
      openCommand,
      {
        dispose: () => {
          this.panel?.dispose();
          this.panel = undefined;
          void this.proxyService?.dispose();
          this.proxyService = undefined;
        },
      },
    );

    ColorLog.black(`[${this.id}]`, 'Activated.');
  }

  private toggleProxyPreviewPanel(context: vscode.ExtensionContext): void {
    if (this.panel?.visible) {
      this.panel.dispose();
      return;
    }

    this.showProxyPreviewPanel(context);
  }

  private showProxyPreviewPanel(context: vscode.ExtensionContext): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
      this.postStatus();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'quickOpsProxyPreview',
      '代理预览 (Proxy Preview)',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        enableFindWidget: true,
        localResourceRoots: [context.extensionUri],
      },
    );

    this.panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'resources', 'icons', 'proxy-preview.svg');

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
      if (message.command === 'ready' || message.command === 'getConfig') {
        this.postStatus();
        return;
      }

      if (message.command === 'saveConfig') {
        if (message.config) {
          await this.proxyService.saveConfig(message.config);
        }

        this.postStatus();
        vscode.window.showInformationMessage('代理预览配置已保存。');
        return;
      }

      if (message.command === 'start') {
        await this.proxyService.start(message.config);
        this.postStatus();
        vscode.window.showInformationMessage('代理预览已启动。');
        return;
      }

      if (message.command === 'stop') {
        await this.proxyService.stop();
        this.postStatus();
        vscode.window.showInformationMessage('代理预览已停止。');
        return;
      }

      if (message.command === 'open') {
        await vscode.env.openExternal(vscode.Uri.parse(this.proxyService.getProxyUrl()));
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
    if (!this.proxyService) return;

    this.panel?.webview.postMessage({
      type: 'status',
      config: this.proxyService.getConfig(),
      status: this.proxyService.getStatus(),
    });
  }
}
