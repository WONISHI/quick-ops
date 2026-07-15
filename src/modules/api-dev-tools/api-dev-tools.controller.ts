import * as vscode from 'vscode';

import type { OnModuleInit } from '@core/lifecycle/lifecycle.interface';
import { ExtensionContextProvider } from '@common/providers/extension-context.provider';
import { ApiDevToolsWebviewProvider } from '@modules/api-dev-tools/providers/api-dev-tools-webview.provider';

export class ApiDevToolsController implements OnModuleInit {
  public static inject = [ExtensionContextProvider, ApiDevToolsWebviewProvider];

  private readonly id = 'ApiDevToolsModule';

  constructor(
    private readonly extensionContextProvider: ExtensionContextProvider,
    private readonly apiDevToolsWebviewProvider: ApiDevToolsWebviewProvider,
  ) {}

  public onModuleInit(): void {
    this.registerProviders();
  }

  public dispose(): void {
    this.apiDevToolsWebviewProvider.dispose();
  }

  private registerProviders(): void {
    this.extensionContextProvider.register(
      vscode.window.registerWebviewViewProvider(ApiDevToolsWebviewProvider.viewType, this.apiDevToolsWebviewProvider, {
        webviewOptions: {
          retainContextWhenHidden: true,
        },
      }),
    );
  }
}
