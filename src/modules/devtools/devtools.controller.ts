import * as vscode from 'vscode';
import ColorLog from '../../utils/ColorLog';
import type { OnModuleInit } from '../../core/lifecycle/lifecycle.interface';
import { ExtensionContextProvider } from '../../common/providers/extension-context.provider';
import { DevToolsWebviewProvider } from './providers/devtools-webview.provider';

export class DevToolsController implements OnModuleInit {
  public static inject = [ExtensionContextProvider, DevToolsWebviewProvider];

  private readonly id = 'DevToolsModule';

  constructor(
    private readonly extensionContextProvider: ExtensionContextProvider,
    private readonly devToolsWebviewProvider: DevToolsWebviewProvider,
  ) {}

  public onModuleInit(): void {
    this.registerProviders();
    this.registerCommands();

    ColorLog.black(`[${this.id}]`, 'Activated.');
  }

  public dispose(): void {
    this.devToolsWebviewProvider.dispose();
  }

  private registerProviders(): void {
    this.extensionContextProvider.register(
      vscode.window.registerWebviewViewProvider(
        DevToolsWebviewProvider.viewType,
        this.devToolsWebviewProvider,
        {
          webviewOptions: {
            retainContextWhenHidden: true,
          },
        },
      ),
    );
  }

  private registerCommands(): void {
    this.extensionContextProvider.register(
      vscode.commands.registerCommand(
        'quickOps.openDevTools',
        async (devToolsUrl?: string) => {
          if (!devToolsUrl) {
            vscode.window.showWarningMessage('DevTools 地址不能为空');
            return;
          }

          await this.devToolsWebviewProvider.open(devToolsUrl);
        },
      ),

      vscode.commands.registerCommand('quickOps.clearDevTools', () => {
        this.devToolsWebviewProvider.clear();
      }),
    );
  }
}