import * as vscode from 'vscode';

import type { OnModuleInit } from '@core/lifecycle/lifecycle.interface';
import { ExtensionContextProvider } from '@common/providers/extension-context.provider';
import { LivePreviewService } from '@modules/live-preview/live-preview.service';
import { LivePreviewProvider } from '@modules/live-preview/providers/live-preview.provider';
import { DevToolsWebviewProvider } from '@modules/live-preview/providers/dev-tools-webview.provider';

export class LivePreviewController implements OnModuleInit {
  public static inject = [ExtensionContextProvider, LivePreviewService, LivePreviewProvider, DevToolsWebviewProvider];

  private readonly id = 'LivePreviewModule';

  constructor(
    private readonly extensionContextProvider: ExtensionContextProvider,
    private readonly livePreviewService: LivePreviewService,
    private readonly livePreviewProvider: LivePreviewProvider,
    private readonly devToolsWebviewProvider: DevToolsWebviewProvider,
  ) {}

  public onModuleInit(): void {
    const context = this.extensionContextProvider.getContext();

    context.globalState.setKeysForSync([this.livePreviewService.globalFavoritesKey, this.livePreviewService.globalFavoriteFoldersKey]);

    this.registerProviders();
    this.registerCommands();
    this.registerListeners();

  }

  public dispose(): void {
    this.livePreviewProvider.dispose();
    this.devToolsWebviewProvider.dispose();
    this.livePreviewService.dispose();
  }

  private registerProviders(): void {
    this.extensionContextProvider.register(
      vscode.window.registerWebviewViewProvider(DevToolsWebviewProvider.viewType, this.devToolsWebviewProvider, {
        webviewOptions: {
          retainContextWhenHidden: true,
        },
      }),
    );
  }

  private registerCommands(): void {
    this.extensionContextProvider.register(
      vscode.commands.registerCommand('quickOps.openLivePreview', async () => {
        await this.livePreviewProvider.togglePreviewPanel();
      }),

      vscode.commands.registerCommand('quickOps.openLivePreviewUrl', async (url?: string) => {
        await this.livePreviewProvider.openPreviewPanel(url || '');
      }),

      vscode.commands.registerCommand('quick-ops.previewLocalFile', async (uri?: vscode.Uri) => {
        await this.livePreviewProvider.previewLocalFile(uri);
      }),
    );
  }

  private registerListeners(): void {
    this.extensionContextProvider.register(
      vscode.window.onDidChangeWindowState((state) => {
        if (state.focused) {
          void this.livePreviewProvider.syncFavoritesToPanel();
        }
      }),
    );
  }
}
