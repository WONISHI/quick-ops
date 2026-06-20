import * as vscode from 'vscode';
import ColorLog from '../../utils/ColorLog';
import type { OnModuleInit } from '../../core/lifecycle/lifecycle.interface';
import { ExtensionContextProvider } from '../../common/providers/extension-context.provider';
import { AnchorService } from './anchor.service';
import type { AnchorDirection } from './anchor.type';

export class AnchorController implements OnModuleInit {
  public static inject = [ExtensionContextProvider, AnchorService];

  private readonly id = 'AnchorModule';

  constructor(
    private readonly extensionContextProvider: ExtensionContextProvider,
    private readonly anchorService: AnchorService,
  ) {}

  public onModuleInit(): void {
    const context = this.extensionContextProvider.getContext();

    this.anchorService.init(context);

    this.registerCodeLensProvider();
    this.registerListeners();
    this.registerCommands();

    this.anchorService.updateProjectContextKey();

    const timer = setTimeout(() => {
      this.anchorService.updateDecorations();
      clearTimeout(timer);
    }, 500);

    ColorLog.black(`[${this.id}]`, 'Activated.');
  }

  public dispose(): void {
    this.anchorService.dispose();
  }

  private registerCodeLensProvider(): void {
    this.extensionContextProvider.register(
      vscode.languages.registerCodeLensProvider(
        { scheme: 'file' },
        this.anchorService.createCodeLensProvider(),
      ),
    );
  }

  private registerListeners(): void {
    this.extensionContextProvider.register(
      this.anchorService.onDidChangeAnchors(() => {
        this.anchorService.updateDecorations();
        this.anchorService.updateProjectContextKey();
        this.anchorService.refreshMindMapPanel();
      }),

      vscode.window.onDidChangeActiveTextEditor(() => {
        this.anchorService.updateDecorationsDebounced();
      }),

      vscode.workspace.onDidSaveTextDocument(doc => {
        void this.anchorService.syncAnchorsWithContent(doc);
      }),
    );
  }

  private registerCommands(): void {
    this.extensionContextProvider.register(
      vscode.commands.registerCommand(
        'quick-ops.anchor.add',
        async (...args: any[]) => {
          await this.anchorService.handleAddAnchorCommand(...args);
        },
      ),

      vscode.commands.registerCommand('quick-ops.anchor.showMenu', async () => {
        await this.anchorService.handleShowMenuCommand();
      }),

      vscode.commands.registerCommand(
        'quick-ops.anchor.listByGroup',
        async (groupName: string, anchorId: string) => {
          await this.anchorService.showAnchorList(
            groupName,
            true,
            undefined,
            anchorId,
          );
        },
      ),

      vscode.commands.registerCommand(
        'quick-ops.anchor.navigate',
        async (currentId: string, direction: AnchorDirection) => {
          await this.anchorService.navigateAnchor(currentId, direction);
        },
      ),

      vscode.commands.registerCommand(
        'quick-ops.anchor.delete',
        async (id: string) => {
          this.anchorService.removeAnchor(id);
        },
      ),
    );
  }
}