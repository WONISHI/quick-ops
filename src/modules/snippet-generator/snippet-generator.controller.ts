import * as vscode from 'vscode';
import { ExtensionContextProvider } from '@common/providers/extension-context.provider';
import { SnippetGeneratorService } from '@modules/snippet-generator/snippet-generator.service';
import type { OnModuleInit } from '@core/lifecycle/lifecycle.interface';

export class SnippetGeneratorController implements OnModuleInit {
  public static inject = [ExtensionContextProvider, SnippetGeneratorService];

  private readonly id = 'SnippetGeneratorModule';

  constructor(
    private readonly extensionContextProvider: ExtensionContextProvider,
    private readonly snippetGeneratorService: SnippetGeneratorService,
  ) {}

  public onModuleInit(): void {
    this.registerCommands();

  }

  private registerCommands(): void {
    this.extensionContextProvider.register(
      vscode.commands.registerTextEditorCommand(
        'quickOps.addToSnippets',
        async textEditor => {
          await this.snippetGeneratorService.generateAndSaveSnippet(textEditor);
        },
      ),
    );
  }
}