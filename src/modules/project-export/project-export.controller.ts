import * as vscode from 'vscode';
import ColorLog from '../../utils/ColorLog';
import type { OnModuleInit } from '../../core/lifecycle/lifecycle.interface';
import { ExtensionContextProvider } from '../../common/providers/extension-context.provider';
import { ProjectExportService } from './project-export.service';

export class ProjectExportController implements OnModuleInit {
  public static inject = [ExtensionContextProvider, ProjectExportService];

  private readonly id = 'ProjectExportModule';

  constructor(
    private readonly extensionContextProvider: ExtensionContextProvider,
    private readonly projectExportService: ProjectExportService,
  ) {}

  public onModuleInit(): void {
    this.registerCompletionProviders();
    this.registerCommands();

    ColorLog.black(`[${this.id}]`, 'Activated.');
  }

  private registerCompletionProviders(): void {
    const selector: vscode.DocumentSelector = [
      'javascript',
      'typescript',
      'vue',
      'javascriptreact',
      'typescriptreact',
    ];

    const pathTriggers = ['/', '.', '"', "'", '@', '~'];

    const pathProvider = vscode.languages.registerCompletionItemProvider(
      selector,
      {
        provideCompletionItems: (document, position) => {
          return this.projectExportService.providePathCompletion(document, position);
        },
      },
      ...pathTriggers,
    );

    const exportProvider = vscode.languages.registerCompletionItemProvider(
      selector,
      {
        provideCompletionItems: (document, position) => {
          return this.projectExportService.provideExportCompletion(document, position);
        },

        resolveCompletionItem: item => {
          return this.projectExportService.resolveExportCompletion(item);
        },
      },
      '{',
      ',',
      ' ',
    );

    this.extensionContextProvider.register(pathProvider, exportProvider);
  }

  private registerCommands(): void {
    this.extensionContextProvider.register(
      vscode.commands.registerCommand(
        'quick-ops.onPathSelected',
        async (args: {
          fileName: string;
          parentPathUri: string;
          importBase: string;
          isDirectory: boolean;
        }) => {
          await this.projectExportService.handlePathSelected(args);
        },
      ),

      vscode.commands.registerCommand('quick-ops.onFuncSelected', (name: string) => {
        this.projectExportService.handleFuncSelected(name);
      }),
    );
  }
}