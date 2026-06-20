    import * as vscode from 'vscode';
import ColorLog from '../../utils/ColorLog';
import type { OnModuleInit } from '../../core/lifecycle/lifecycle.interface';
import { ExtensionContextProvider } from '../../common/providers/extension-context.provider';
import { FocusHistoryService } from './focus-history.service';

export class FocusHistoryController implements OnModuleInit {
  public static inject = [ExtensionContextProvider, FocusHistoryService];

  private readonly id = 'FocusHistoryModule';

  constructor(
    private readonly extensionContextProvider: ExtensionContextProvider,
    private readonly focusHistoryService: FocusHistoryService,
  ) {}

  public onModuleInit(): void {
    this.registerListeners();
    this.registerCommands();

    ColorLog.black(`[${this.id}]`, 'Activated.');
  }

  public dispose(): void {
    this.focusHistoryService.dispose();
  }

  private registerListeners(): void {
    this.extensionContextProvider.register(
      vscode.window.onDidChangeTextEditorSelection(event => {
        this.focusHistoryService.handleSelectionChange(event);
      }),

      vscode.workspace.onDidCloseTextDocument(document => {
        this.focusHistoryService.removeFileHistory(document.uri.toString());
      }),
    );
  }

  private registerCommands(): void {
    this.extensionContextProvider.register(
      vscode.commands.registerCommand('quick-ops.focusBack', async () => {
        await this.focusHistoryService.navigateBack();
      }),

      vscode.commands.registerCommand('quick-ops.focusHistory.clear', () => {
        this.focusHistoryService.clear();
        vscode.window.showInformationMessage('焦点历史已清空');
      }),
    );
  }
}