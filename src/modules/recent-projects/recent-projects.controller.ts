import * as vscode from 'vscode';
import ColorLog from '../../utils/ColorLog';
import type { OnModuleInit } from '../../core/lifecycle/lifecycle.interface';
import { ExtensionContextProvider } from '../../common/providers/extension-context.provider';
import { RecentProjectsProvider } from './providers/recent-projects.provider';
import { ReadOnlyFileSystemProvider } from './providers/read-only-file-system.provider';

export class RecentProjectsController implements OnModuleInit {
  public static inject = [
    ExtensionContextProvider,
    RecentProjectsProvider,
    ReadOnlyFileSystemProvider,
  ];

  private readonly id = 'RecentProjectsModule';

  private refreshTimer: NodeJS.Timeout | undefined;
  private metadataTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly extensionContextProvider: ExtensionContextProvider,
    private readonly recentProjectsProvider: RecentProjectsProvider,
    private readonly readOnlyFileSystemProvider: ReadOnlyFileSystemProvider,
  ) {}

  public onModuleInit(): void {
    this.registerProviders();
    this.registerCommands();
    this.registerWatchers();

    ColorLog.black(`[${this.id}]`, 'Activated.');
  }

  public dispose(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }

    if (this.metadataTimer) {
      clearTimeout(this.metadataTimer);
      this.metadataTimer = undefined;
    }

    this.recentProjectsProvider.dispose();
    this.readOnlyFileSystemProvider.dispose();
  }

  private registerProviders(): void {
    this.extensionContextProvider.register(
      vscode.window.registerWebviewViewProvider(
        'quickOps.recentProjectsView',
        this.recentProjectsProvider,
        {
          webviewOptions: {
            retainContextWhenHidden: true,
          },
        },
      ),

      vscode.workspace.registerFileSystemProvider(
        'quickops-ro',
        this.readOnlyFileSystemProvider,
        {
          isReadonly: true,
        },
      ),
    );
  }

  private registerCommands(): void {
    this.extensionContextProvider.register(
      vscode.commands.registerCommand('quickOps.revealInRecentProjects', () => {
        this.recentProjectsProvider.revealCurrentActive();
      }),

      vscode.commands.registerCommand('quickOps.addRecentProject', async () => {
        await this.recentProjectsProvider.showAddProjectQuickPick();
      }),

      vscode.commands.registerCommand('quickOps.refreshRecentProjects', async () => {
        this.recentProjectsProvider.refresh(true);
        this.readOnlyFileSystemProvider.refreshAllWatched();

        await this.recentProjectsProvider.syncAllBranches();

        this.requestMetadataSync();
      }),

      vscode.commands.registerCommand('quickOps.clearRecentProjects', async () => {
        await this.recentProjectsProvider.clearAll();
      }),

      vscode.commands.registerCommand('quickOps.syncBranches', async () => {
        await this.recentProjectsProvider.syncAllBranches();
        this.requestMetadataSync();
      }),

      vscode.commands.registerCommand(
        'quickOps.selectForCompare',
        (uri: vscode.Uri) => {
          if (uri) {
            this.recentProjectsProvider.selectForCompare(uri.toString());
          }
        },
      ),

      vscode.commands.registerCommand(
        'quickOps.compareWithSelected',
        (uri: vscode.Uri) => {
          if (uri) {
            void this.recentProjectsProvider.compareWithSelected(uri.toString());
          }
        },
      ),
    );
  }

  private registerWatchers(): void {
    this.extensionContextProvider.register(
      this.readOnlyFileSystemProvider.onDidRefreshReadonlyTarget(() => {
        this.recentProjectsProvider.refresh(true);
        this.requestMetadataSync();
      }),

      vscode.workspace.onDidSaveTextDocument(document => {
        if (document.uri.scheme !== 'file') return;

        this.requestRefresh(true);
      }),

      vscode.workspace.onDidCreateFiles(() => {
        this.requestRefresh(true);
      }),

      vscode.workspace.onDidDeleteFiles(() => {
        this.requestRefresh(true);
      }),

      vscode.workspace.onDidRenameFiles(() => {
        this.requestRefresh(true);
      }),

      vscode.languages.onDidChangeDiagnostics(() => {
        this.requestMetadataSync();
      }),

      vscode.window.onDidChangeWindowState(event => {
        if (event.focused) {
          this.requestRefresh(true);
        }
      }),
    );
  }

  private requestRefresh(refreshExpandedTree = true): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }

    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;

      this.recentProjectsProvider.refresh(refreshExpandedTree);
      this.readOnlyFileSystemProvider.refreshAllWatched();

      const currentActivePath = this.recentProjectsProvider.currentActivePath;

      if (currentActivePath) {
        this.recentProjectsProvider.setActivePath(currentActivePath);
      }

      this.requestMetadataSync();
    }, 200);
  }

  private requestMetadataSync(): void {
    if (this.metadataTimer) {
      clearTimeout(this.metadataTimer);
    }

    this.metadataTimer = setTimeout(() => {
      this.metadataTimer = undefined;
      this.recentProjectsProvider.requestVisibleMetadataSync();
    }, 120);
  }
}