import * as vscode from 'vscode';
import ColorLog from '../../utils/ColorLog';
import type { OnModuleInit } from '../../core/lifecycle/lifecycle.interface';
import { ExtensionContextProvider } from '../../common/providers/extension-context.provider';
import { WorkspaceContextService } from '../../common/services/workspace-context.service';
import { ComponentIntellisenseService } from './component-intellisense.service';
import { ComponentCompletionProvider } from './providers/component-completion.provider';

export class ComponentIntellisenseController implements OnModuleInit {
  public static inject = [
    ExtensionContextProvider,
    WorkspaceContextService,
    ComponentIntellisenseService,
    ComponentCompletionProvider,
  ];

  private readonly id = 'ComponentIntellisenseModule';

  constructor(
    private readonly extensionContextProvider: ExtensionContextProvider,
    private readonly workspaceContextService: WorkspaceContextService,
    private readonly componentIntellisenseService: ComponentIntellisenseService,
    private readonly componentCompletionProvider: ComponentCompletionProvider,
  ) {}

  public async onModuleInit(): Promise<void> {
    await this.componentIntellisenseService.init();

    this.registerProviders();
    this.registerCommands();
    this.registerListeners();

    ColorLog.black(`[${this.id}]`, 'Activated.');
  }

  public dispose(): void {
    this.componentCompletionProvider.dispose();
    this.componentIntellisenseService.dispose();
  }

  private registerProviders(): void {
    const selector: vscode.DocumentSelector = [
      'vue',
      'html',
      'javascriptreact',
      'typescriptreact',
    ];

    this.extensionContextProvider.register(
      vscode.languages.registerCompletionItemProvider(
        selector,
        this.componentCompletionProvider,
        '<',
        ' ',
        '@',
        ':',
        '-',
        '#',
      ),

      vscode.languages.registerHoverProvider(
        selector,
        this.componentCompletionProvider,
      ),
    );
  }

  private registerCommands(): void {
    this.extensionContextProvider.register(
      vscode.commands.registerCommand('quick-ops.exportSnippets', async () => {
        await this.componentIntellisenseService.exportSnippetsToWorkspace();
      }),
    );
  }

  private registerListeners(): void {
    this.extensionContextProvider.register(
      this.workspaceContextService.onDidChangeContext(async () => {
        await this.componentIntellisenseService.reload();
      }),
    );
  }
}