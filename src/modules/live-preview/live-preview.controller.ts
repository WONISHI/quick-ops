import * as vscode from 'vscode';
import ColorLog from '../../utils/ColorLog';
import type { OnModuleInit } from '../../core/lifecycle/lifecycle.interface';
import { ExtensionContextProvider } from '../../common/providers/extension-context.provider';
import { LivePreviewService } from './live-preview.service';
import { LivePreviewProvider } from './providers/live-preview.provider';

export class LivePreviewController implements OnModuleInit {
  public static inject = [
    ExtensionContextProvider,
    LivePreviewService,
    LivePreviewProvider,
  ];

  private readonly id = 'LivePreviewModule';

  constructor(
    private readonly extensionContextProvider: ExtensionContextProvider,
    private readonly livePreviewService: LivePreviewService,
    private readonly livePreviewProvider: LivePreviewProvider,
    
  ) {}

  public onModuleInit(): void {
    const context = this.extensionContextProvider.getContext();

    context.globalState.setKeysForSync([
      this.livePreviewService.globalFavoritesKey,
    ]);

    this.registerCommands();
    this.registerListeners();

    ColorLog.black(`[${this.id}]`, 'Activated.');
  }

  public dispose(): void {
    this.livePreviewProvider.dispose();
    this.livePreviewService.dispose();
  }

  private registerCommands(): void {
    this.extensionContextProvider.register(
      vscode.commands.registerCommand('quick-ops.openLivePreview', async () => {
        await this.livePreviewProvider.togglePreviewPanel();
      }),

      vscode.commands.registerCommand(
        'quick-ops.openLivePreviewUrl',
        async (url?: string) => {
          await this.livePreviewProvider.openPreviewPanel(url || '');
        },
      ),

      vscode.commands.registerCommand(
        'quick-ops.previewLocalFile',
        async (uri?: vscode.Uri) => {
          await this.livePreviewProvider.previewLocalFile(uri);
        },
      ),
    );
  }

  private registerListeners(): void {
    this.extensionContextProvider.register(
      vscode.window.onDidChangeWindowState(state => {
        if (state.focused) {
          void this.livePreviewProvider.syncFavoritesToPanel();
        }
      }),
    );
  }
}