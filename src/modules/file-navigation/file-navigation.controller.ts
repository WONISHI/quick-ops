import * as vscode from 'vscode';
import { ExtensionContextProvider } from '@common/providers/extension-context.provider';
import { FileNavigationService } from '@modules/file-navigation/file-navigation.service';
import type { OnModuleInit } from '@core/lifecycle/lifecycle.interface';

export class FileNavigationController implements OnModuleInit {
  public static inject = [ExtensionContextProvider, FileNavigationService];

  private readonly id = 'FileNavigationModule';

  constructor(
    private readonly extensionContextProvider: ExtensionContextProvider,
    private readonly fileNavigationService: FileNavigationService,
  ) {}

  public onModuleInit(): void {
    this.registerCommands();

  }

  private registerCommands(): void {
    this.extensionContextProvider.register(
      vscode.commands.registerCommand('quickOps.revealInExplorer', async () => {
        await this.fileNavigationService.revealActiveFileInExplorer();
      }),

      vscode.commands.registerCommand('quickOps.openInNewTab', async (uri?: vscode.Uri) => {
        await this.fileNavigationService.openInNewTab(uri);
      }),

      vscode.commands.registerCommand(
        'quickOps.openExternalPreview',
        async (uri?: vscode.Uri) => {
          await this.fileNavigationService.openExternalPreview(uri);
        },
      ),
    );
  }
}