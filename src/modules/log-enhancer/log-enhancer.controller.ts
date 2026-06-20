import * as vscode from 'vscode';
import ColorLog from '../../utils/ColorLog';
import type { OnModuleInit } from '../../core/lifecycle/lifecycle.interface';
import { ExtensionContextProvider } from '../../common/providers/extension-context.provider';
import { LogEnhancerService } from './log-enhancer.service';

export class LogEnhancerController implements OnModuleInit {
  public static inject = [ExtensionContextProvider, LogEnhancerService];

  private readonly id = 'LogEnhancerModule';
  private triggerTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly extensionContextProvider: ExtensionContextProvider,
    private readonly logEnhancerService: LogEnhancerService,
  ) {}

  public onModuleInit(): void {
    this.registerCompletionProvider();
    this.registerTextChangeTrigger();

    ColorLog.black(`[${this.id}]`, 'Activated.');
  }

  public dispose(): void {
    if (this.triggerTimer) {
      clearTimeout(this.triggerTimer);
      this.triggerTimer = undefined;
    }
  }

  private registerCompletionProvider(): void {
    const selector: vscode.DocumentSelector = [
      'javascript',
      'typescript',
      'vue',
      'javascriptreact',
      'typescriptreact',
    ];

    const provider = vscode.languages.registerCompletionItemProvider(
      selector,
      {
        provideCompletionItems: (document, position) => {
          return this.logEnhancerService.provideLogs(document, position);
        },
      },
      '>',
      '?',
      '.',
    );

    this.extensionContextProvider.register(provider);
  }

  private registerTextChangeTrigger(): void {
    const disposable = vscode.workspace.onDidChangeTextDocument(event => {
      if (event.contentChanges.length === 0) return;

      const editor = vscode.window.activeTextEditor;

      if (!editor || editor.document !== event.document) return;

      const change = event.contentChanges[0];
      const lineText = editor.document.lineAt(change.range.start.line).text;

      if (!this.logEnhancerService.shouldTriggerSuggest(lineText)) return;

      const text = change.text;
      const isTriggerChar = ['>', '?', '.', '(', ')', ';', ' ', '\n'].includes(text);

      if ((text.length === 1 && !isTriggerChar) || text.length > 1) {
        if (this.triggerTimer) {
          clearTimeout(this.triggerTimer);
        }

        this.triggerTimer = setTimeout(() => {
          void vscode.commands.executeCommand('editor.action.triggerSuggest');
        }, 20);
      }
    });

    this.extensionContextProvider.register(disposable);
  }
}