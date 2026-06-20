import * as vscode from 'vscode';
import ColorLog from '../../utils/ColorLog';
import type { OnModuleInit } from '../../core/lifecycle/lifecycle.interface';
import { ExtensionContextProvider } from '../../common/providers/extension-context.provider';
import { FileNavigationService } from './file-navigation.service';

export class FileNavigationController implements OnModuleInit {
  public static inject = [ExtensionContextProvider, FileNavigationService];

  private readonly id = 'FileNavigationModule';

  constructor(
    private readonly extensionContextProvider: ExtensionContextProvider,
    private readonly fileNavigationService: FileNavigationService,
  ) {}

  public onModuleInit(): void {
    this.registerCommands();

    ColorLog.black(`[${this.id}]`, 'Activated.');
  }

  private registerCommands(): void {
    this.extensionContextProvider.register(
      vscode.commands.registerCommand('quick-ops.revealInExplorer', async () => {
        await this.fileNavigationService.revealActiveFileInExplorer();
      }),

      vscode.commands.registerCommand('quick-ops.openInNewTab', async (uri?: vscode.Uri) => {
        await this.fileNavigationService.openInNewTab(uri);
      }),

      vscode.commands.registerCommand(
        'quick-ops.openExternalPreview',
        async (uri?: vscode.Uri) => {
          await this.fileNavigationService.openExternalPreview(uri);
        },
      ),
    );
  }
}