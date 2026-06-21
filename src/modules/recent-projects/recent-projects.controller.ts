import * as vscode from 'vscode';
import ColorLog from '../../utils/ColorLog';
import type { OnModuleInit } from '../../core/lifecycle/lifecycle.interface';
import { ExtensionContextProvider } from '../../common/providers/extension-context.provider';
import { RecentProjectsProvider } from './providers/recent-projects.provider';
import { ReadOnlyFileSystemProvider } from './providers/read-only-file-system.provider';
import {
  RECENT_PROJECTS_COMMANDS,
  RECENT_PROJECTS_VIEW_ID,
} from './recent-projects.constant';

export class RecentProjectsController implements OnModuleInit {
  public static inject = [
    ExtensionContextProvider,
    RecentProjectsProvider,
    ReadOnlyFileSystemProvider,
  ];

  private readonly id = 'RecentProjectsModule';

  private refreshTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly extensionContextProvider: ExtensionContextProvider,
    private readonly recentProjectsProvider: RecentProjectsProvider,
    private readonly readOnlyFileSystemProvider: ReadOnlyFileSystemProvider,
  ) {}

  public onModuleInit(): void {
    this.registerProviders();
    this.registerCommands();
    this.registerListeners();

    ColorLog.black(`[${this.id}]`, 'Activated.');
  }

  public dispose(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }

    this.recentProjectsProvider.dispose();
  }

  private registerProviders(): void {
    this.extensionContextProvider.register(
      vscode.window.registerWebviewViewProvider(
        RECENT_PROJECTS_VIEW_ID,
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
      vscode.commands.registerCommand(
        RECENT_PROJECTS_COMMANDS.addRecentProject,
        async () => {
          await this.recentProjectsProvider.showAddProjectQuickPick();
        },
      ),

      vscode.commands.registerCommand(
        RECENT_PROJECTS_COMMANDS.refreshRecentProjects,
        () => {
          this.recentProjectsProvider.refresh(true);
          this.recentProjectsProvider.requestVisibleMetadataSync();
        },
      ),

      vscode.commands.registerCommand(
        RECENT_PROJECTS_COMMANDS.clearRecentProjects,
        async () => {
          await this.recentProjectsProvider.clearAll();
        },
      ),

      vscode.commands.registerCommand(
        RECENT_PROJECTS_COMMANDS.syncBranches,
        async () => {
          await this.recentProjectsProvider.syncAllBranches();
        },
      ),

      vscode.commands.registerCommand(
        RECENT_PROJECTS_COMMANDS.revealInRecentProjects,
        () => {
          this.recentProjectsProvider.revealCurrentActive();
        },
      ),

      vscode.commands.registerCommand(
        RECENT_PROJECTS_COMMANDS.selectForCompare,
        (uri?: vscode.Uri) => {
          if (!uri) return;

          this.recentProjectsProvider.selectForCompare(uri.toString());
        },
      ),

      vscode.commands.registerCommand(
        RECENT_PROJECTS_COMMANDS.compareWithSelected,
        async (uri?: vscode.Uri) => {
          if (!uri) return;

          await this.recentProjectsProvider.compareWithSelected(uri.toString());
        },
      ),
    );
  }

  private registerListeners(): void {
    this.extensionContextProvider.register(
      vscode.workspace.onDidSaveTextDocument(() => {
        this.requestRefreshMetadata();
      }),

      vscode.workspace.onDidChangeTextDocument(() => {
        this.requestRefreshMetadata();
      }),

      vscode.workspace.onDidCreateFiles(() => {
        this.requestRefreshMetadata();
      }),

      vscode.workspace.onDidDeleteFiles(() => {
        this.requestRefreshMetadata();
      }),

      vscode.workspace.onDidRenameFiles(() => {
        this.requestRefreshMetadata();
      }),

      vscode.window.onDidChangeActiveTextEditor(() => {
        this.recentProjectsProvider.revealCurrentActive();
        this.requestRefreshMetadata();
      }),

      vscode.languages.onDidChangeDiagnostics(() => {
        this.requestRefreshMetadata();
      }),
    );
  }

  private requestRefreshMetadata(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }

    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;

      /**
       * 这里不能只 refresh(false)。
       *
       * master 的逻辑是：
       * - 目录缓存失效
       * - 更新 webview
       * - 通知前端 refreshExpandedDirs
       *
       * refactor 必须保留这个行为，否则取消修改后，
       * 前端已展开目录不会重新 readDir，M/U/D 状态会残留。
       */
      this.recentProjectsProvider.refresh(false);
      this.recentProjectsProvider.requestVisibleMetadataSync();
    }, 250);
  }
}