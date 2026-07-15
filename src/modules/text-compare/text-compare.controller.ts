import * as vscode from 'vscode';

import type { OnModuleInit } from '@core/lifecycle/lifecycle.interface';
import { ExtensionContextProvider } from '@common/providers/extension-context.provider';
import { TextCompareService } from '@modules/text-compare/text-compare.service';

export class TextCompareController implements OnModuleInit {
  public static inject = [ExtensionContextProvider, TextCompareService];

  private readonly id = 'TextCompareModule';

  constructor(
    private readonly extensionContextProvider: ExtensionContextProvider,
    private readonly textCompareService: TextCompareService,
  ) {}

  public onModuleInit(): void {
    this.registerProviders();
    this.registerCommands();

  }

  public dispose(): void {
    this.textCompareService.dispose();
  }

  private registerProviders(): void {
    this.extensionContextProvider.register(
      vscode.workspace.registerTextDocumentContentProvider(
        'quickops-diff',
        this.textCompareService.getContentProvider(),
      ),
    );
  }

  private registerCommands(): void {
    this.extensionContextProvider.register(
      vscode.commands.registerCommand('quickOps.openTextCompare', async () => {
        await this.textCompareService.openCompareWebview();
      }),
    );
  }
}