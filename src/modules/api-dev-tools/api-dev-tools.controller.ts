import * as vscode from 'vscode';

import type { OnModuleInit } from '@core/lifecycle/lifecycle.interface';
import { ExtensionContextProvider } from '@common/providers/extension-context.provider';
import { API_DEV_TOOLS_COMMANDS, API_DEV_TOOLS_LOADING_CONTEXT } from '@modules/api-dev-tools/constants/api-dev-tools.constant';
import { ApiDevToolsWebviewProvider } from '@modules/api-dev-tools/providers/api-dev-tools-webview.provider';
import type { ApiDevToolsViewTitleAction } from '@modules/api-dev-tools/api-dev-tools.type';

export class ApiDevToolsController implements OnModuleInit {
  public static inject = [ExtensionContextProvider, ApiDevToolsWebviewProvider];

  private readonly id = 'ApiDevToolsModule';

  constructor(
    private readonly extensionContextProvider: ExtensionContextProvider,
    private readonly apiDevToolsWebviewProvider: ApiDevToolsWebviewProvider,
  ) {}

  /**
   * @description 初始化 API DevTools Provider 和 View 标题栏命令
   */
  public onModuleInit(): void {
    this.registerProviders();
    this.registerCommands();

    void vscode.commands.executeCommand('setContext', API_DEV_TOOLS_LOADING_CONTEXT, false);
  }

  /**
   * @description 销毁 API DevTools
   */
  public dispose(): void {
    this.apiDevToolsWebviewProvider.dispose();
  }

  /**
   * @description 注册 API DevTools Webview View Provider
   */
  private registerProviders(): void {
    this.extensionContextProvider.register(
      vscode.window.registerWebviewViewProvider(ApiDevToolsWebviewProvider.viewType, this.apiDevToolsWebviewProvider, {
        webviewOptions: {
          retainContextWhenHidden: true,
        },
      }),
    );
  }

  /**
   * @description 注册 API DevTools 原生 View 标题栏命令
   */
  private registerCommands(): void {
    this.extensionContextProvider.register(
      vscode.commands.registerCommand(API_DEV_TOOLS_COMMANDS.OPEN_FLOATING, async () => {
        await this.apiDevToolsWebviewProvider.openFloatingEditor();
      }),
    );

    const commands: Array<readonly [string, ApiDevToolsViewTitleAction]> = [
      [API_DEV_TOOLS_COMMANDS.ADD_PROJECT, 'add-project'],
      [API_DEV_TOOLS_COMMANDS.SAVE_INTERFACE, 'save-interface'],
      [API_DEV_TOOLS_COMMANDS.SHARE_DOCS, 'share-docs'],
      [API_DEV_TOOLS_COMMANDS.EXPORT_DOCS, 'export-docs'],
      [API_DEV_TOOLS_COMMANDS.SHOW_GLOBALS, 'show-globals'],
      [API_DEV_TOOLS_COMMANDS.CLEAR_ALL, 'clear-all'],
      [API_DEV_TOOLS_COMMANDS.SEND_REQUEST, 'send-request'],
    ];

    commands.forEach(([command, action]) => {
      this.extensionContextProvider.register(
        vscode.commands.registerCommand(command, async () => {
          await this.apiDevToolsWebviewProvider.executeViewTitleAction(action);
        }),
      );
    });

    this.extensionContextProvider.register(
      vscode.commands.registerCommand(API_DEV_TOOLS_COMMANDS.STOP_REQUEST, async () => {
        await this.apiDevToolsWebviewProvider.stopApiRequest();
      }),
    );
  }
}
