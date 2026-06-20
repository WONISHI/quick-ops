import * as vscode from 'vscode';
import ColorLog from '../../utils/ColorLog';
import type { OnModuleInit } from '../../core/lifecycle/lifecycle.interface';
import { ExtensionContextProvider } from '../../common/providers/extension-context.provider';
import { TextCompareService } from './text-compare.service';

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

    ColorLog.black(`[${this.id}]`, 'Activated.');
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
      vscode.commands.registerCommand('quick-ops.openTextCompare', async () => {
        await this.textCompareService.openCompareWebview();
      }),
    );
  }
}