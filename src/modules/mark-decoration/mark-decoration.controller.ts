import * as vscode from 'vscode';
import ColorLog from '../../utils/ColorLog';
import type { OnModuleInit } from '../../core/lifecycle/lifecycle.interface';
import { ExtensionContextProvider } from '../../common/providers/extension-context.provider';
import { ConfigurationService } from '../../common/services/configuration.service';
import { MarkDecorationService } from './mark-decoration.service';

export class MarkDecorationController implements OnModuleInit {
  public static inject = [
    ExtensionContextProvider,
    ConfigurationService,
    MarkDecorationService,
  ];

  private readonly id = 'MarkDecorationModule';

  constructor(
    private readonly extensionContextProvider: ExtensionContextProvider,
    private readonly configurationService: ConfigurationService,
    private readonly markDecorationService: MarkDecorationService,
  ) {}

  public onModuleInit(): void {
    void this.markDecorationService.reloadDecorations();

    this.registerEditorListeners();
    this.registerConfigListener();
    this.registerCompletionProvider();

    ColorLog.black(`[${this.id}]`, 'Activated.');
  }

  public dispose(): void {
    this.markDecorationService.dispose();
  }

  private registerEditorListeners(): void {
    this.extensionContextProvider.register(
      vscode.window.onDidChangeActiveTextEditor(editor => {
        if (!editor) return;

        this.markDecorationService.updateDecorationsDebounced();
      }),

      vscode.workspace.onDidChangeTextDocument(event => {
        const editor = vscode.window.activeTextEditor;

        if (editor && event.document === editor.document) {
          this.markDecorationService.updateDecorationsDebounced();
        }
      }),
    );
  }

  private registerConfigListener(): void {
    this.configurationService.on('configChanged', () => {
      void this.markDecorationService.reloadDecorations();
      this.markDecorationService.updateDecorationsDebounced();
    });
  }

  private registerCompletionProvider(): void {
    const selector: vscode.DocumentSelector = [
      'javascript',
      'typescript',
      'vue',
      'javascriptreact',
      'typescriptreact',
      'java',
      'c',
      'cpp',
      'go',
      'python',
      'html',
      'xml',
      'blade',
      'php',
      'jsx',
      'tsx',
      'markdown',
      'mdx',
      'shellscript',
      'yaml',
    ];

    const provider = vscode.languages.registerCompletionItemProvider(
      selector,
      {
        provideCompletionItems: (document, position) => {
          return this.markDecorationService.provideMarkCompletions(
            document,
            position,
          );
        },
      },
      '@',
    );

    this.extensionContextProvider.register(provider);
  }
}