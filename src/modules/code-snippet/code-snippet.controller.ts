import * as vscode from 'vscode';
import ColorLog from '../../utils/ColorLog';
import type { OnModuleInit } from '../../core/lifecycle/lifecycle.interface';
import { ExtensionContextProvider } from '../../common/providers/extension-context.provider';
import { ConfigurationService } from '../../common/services/configuration.service';
import { CodeSnippetService } from './code-snippet.service';

export class CodeSnippetController implements OnModuleInit {
  public static inject = [
    ExtensionContextProvider,
    ConfigurationService,
    CodeSnippetService,
  ];

  private readonly id = 'CodeSnippetModule';

  constructor(
    private readonly extensionContextProvider: ExtensionContextProvider,
    private readonly configurationService: ConfigurationService,
    private readonly codeSnippetService: CodeSnippetService,
  ) {}

  public async onModuleInit(): Promise<void> {
    await this.codeSnippetService.loadAllSnippets();

    this.registerCompletionProvider();
    this.registerCommands();
    this.registerListeners();

    ColorLog.black(`[${this.id}]`, 'Activated.');
  }

  private registerCompletionProvider(): void {
    const selector: vscode.DocumentSelector = [
      'javascript',
      'typescript',
      'vue',
      'javascriptreact',
      'typescriptreact',
      'html',
      'css',
      'scss',
      'less',
    ];

    const provider = vscode.languages.registerCompletionItemProvider(selector, {
      provideCompletionItems: (document, position) => {
        return this.codeSnippetService.provideSnippets(document, position);
      },
    });

    this.extensionContextProvider.register(provider);
  }

  private registerCommands(): void {
    this.extensionContextProvider.register(
      vscode.commands.registerCommand('quick-ops.reloadCodeSnippets', async () => {
        await this.codeSnippetService.loadAllSnippets();
        vscode.window.showInformationMessage('QuickOps 代码片段已重新加载');
      }),
    );
  }

  private registerListeners(): void {
    this.configurationService.on('configChanged', () => {
      void this.codeSnippetService.loadAllSnippets();
    });

    this.configurationService.on('snippetsChanged', () => {
      void this.codeSnippetService.loadAllSnippets();
    });
  }
}