import * as vscode from 'vscode';
import type { OnModuleInit } from '@core/lifecycle/lifecycle.interface';
import { ExtensionContextProvider } from '@common/providers/extension-context.provider';
import { ApiProxyWebviewProvider } from '@modules/api-proxy/providers/api-proxy-webview.provider';

export class ApiProxyController implements OnModuleInit {
  public static inject = [ExtensionContextProvider, ApiProxyWebviewProvider];

  constructor(
    private readonly extensionContextProvider: ExtensionContextProvider,
    private readonly apiProxyWebviewProvider: ApiProxyWebviewProvider,
  ) {}

  public onModuleInit(): void {
    const context = this.extensionContextProvider.getContext();

    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(ApiProxyWebviewProvider.listViewType, this.apiProxyWebviewProvider, {
        webviewOptions: {
          retainContextWhenHidden: true,
        },
      }),

      vscode.commands.registerCommand('quickOps.apiProxy.addGroup', async () => {
        await this.apiProxyWebviewProvider.createGroupFromViewTitle();
      }),

      vscode.commands.registerCommand('quickOps.apiProxy.addProxy', async () => {
        await this.apiProxyWebviewProvider.createProxyFromViewTitle();
      }),
    );
  }

  public dispose(): void {
    this.apiProxyWebviewProvider.dispose();
  }
}
