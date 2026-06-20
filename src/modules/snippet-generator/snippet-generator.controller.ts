import * as vscode from 'vscode';
import ColorLog from '../../utils/ColorLog';
import type { OnModuleInit } from '../../core/lifecycle/lifecycle.interface';
import { ExtensionContextProvider } from '../../common/providers/extension-context.provider';
import { SnippetGeneratorService } from './snippet-generator.service';

export class SnippetGeneratorController implements OnModuleInit {
  public static inject = [ExtensionContextProvider, SnippetGeneratorService];

  private readonly id = 'SnippetGeneratorModule';

  constructor(
    private readonly extensionContextProvider: ExtensionContextProvider,
    private readonly snippetGeneratorService: SnippetGeneratorService,
  ) {}

  public onModuleInit(): void {
    this.registerCommands();

    ColorLog.black(`[${this.id}]`, 'Activated.');
  }

  private registerCommands(): void {
    this.extensionContextProvider.register(
      vscode.commands.registerTextEditorCommand(
        'quick-ops.addToSnippets',
        async textEditor => {
          await this.snippetGeneratorService.generateAndSaveSnippet(textEditor);
        },
      ),
    );
  }
}