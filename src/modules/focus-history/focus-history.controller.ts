import * as vscode from 'vscode';

import type { OnModuleInit } from '@core/lifecycle/lifecycle.interface';
import { ExtensionContextProvider } from '@common/providers/extension-context.provider';
import { FocusHistoryService } from '@modules/focus-history/focus-history.service';

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
      vscode.commands.registerCommand('quickOps.focusBack', async () => {
        await this.focusHistoryService.navigateBack();
      }),

      vscode.commands.registerCommand('quick-ops.focusHistory.clear', () => {
        this.focusHistoryService.clear();
        vscode.window.showInformationMessage('焦点历史已清空');
      }),
    );
  }
}