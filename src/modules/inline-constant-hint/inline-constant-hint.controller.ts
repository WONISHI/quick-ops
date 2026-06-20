import * as vscode from 'vscode';
import ColorLog from '../../utils/ColorLog';
import type { OnModuleInit } from '../../core/lifecycle/lifecycle.interface';
import { ExtensionContextProvider } from '../../common/providers/extension-context.provider';
import { InlineConstantHintService } from './inline-constant-hint.service';
import { InlineConstantHintProvider } from './providers/inline-constant-hint.provider';

export class InlineConstantHintController implements OnModuleInit {
  public static inject = [
    ExtensionContextProvider,
    InlineConstantHintService,
    InlineConstantHintProvider,
  ];

  private readonly id = 'InlineConstantHintModule';

  constructor(
    private readonly extensionContextProvider: ExtensionContextProvider,
    private readonly inlineConstantHintService: InlineConstantHintService,
    private readonly inlineConstantHintProvider: InlineConstantHintProvider,
  ) {}

  public onModuleInit(): void {
    this.registerProviders();
    this.registerCommands();
    this.registerListeners();

    ColorLog.black(`[${this.id}]`, 'Activated.');
  }

  public dispose(): void {
    this.inlineConstantHintProvider.dispose();
    this.inlineConstantHintService.dispose();
  }

  private registerProviders(): void {
    const selector: vscode.DocumentSelector = [
      'javascript',
      'typescript',
      'javascriptreact',
      'typescriptreact',
      'vue',
    ];

    this.extensionContextProvider.register(
      vscode.languages.registerInlayHintsProvider(
        selector,
        this.inlineConstantHintProvider,
      ),
    );
  }

  private registerCommands(): void {
    this.extensionContextProvider.register(
      vscode.commands.registerCommand('quick-ops.inlineConstantHint.refresh', () => {
        this.inlineConstantHintService.clearCache();
        this.inlineConstantHintProvider.refresh();
      }),

      vscode.commands.registerCommand('quick-ops.inlineConstantHint.toggle', async () => {
        await this.inlineConstantHintService.toggleEnabled();
        this.inlineConstantHintProvider.refresh();
      }),
    );
  }

  private registerListeners(): void {
    this.extensionContextProvider.register(
      vscode.workspace.onDidChangeTextDocument(event => {
        this.inlineConstantHintService.clearDocumentCache(event.document);
        this.inlineConstantHintProvider.refresh();
      }),

      vscode.window.onDidChangeActiveTextEditor(() => {
        this.inlineConstantHintProvider.refresh();
      }),

      vscode.workspace.onDidChangeConfiguration(event => {
        if (
          event.affectsConfiguration('quick-ops.inlineConstantHint') ||
          event.affectsConfiguration('quick-ops.general.inlineConstantHint')
        ) {
          this.inlineConstantHintService.clearCache();
          this.inlineConstantHintProvider.refresh();
        }
      }),
    );
  }
}   