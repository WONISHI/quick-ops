import * as vscode from 'vscode';
import ColorLog from '../../utils/ColorLog';
import type { OnModuleInit } from '../../core/lifecycle/lifecycle.interface';
import { ExtensionContextProvider } from '../../common/providers/extension-context.provider';
import { RecentProjectsProvider } from './providers/recent-projects.provider';
import { ReadOnlyFileSystemProvider } from './providers/read-only-file-system.provider';
import {
  RECENT_PROJECTS_COMMANDS,
  RECENT_PROJECTS_CONTEXT_KEYS,
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

    /**
     * 初始化一次按钮上下文。
     *
     * master 的 package.json 使用：
     * view == quickOps.recentProjectsView && quickOps.canRevealInRecent
     */
    this.updateRevealContext();

    ColorLog.black(`[${this.id}]`, 'Activated.');
  }

  public dispose(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }

    this.recentProjectsProvider.dispose();

    void vscode.commands.executeCommand(
      'setContext',
      RECENT_PROJECTS_CONTEXT_KEYS.canRevealInRecent,
      false,
    );
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
          this.updateRevealContext();

          /**
           * 关键：
           * master 点击按钮后不是发 updateProjects，
           * 而是 Provider 内部发送 revealPath。
           */
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

      vscode.workspace.onDidOpenTextDocument(() => {
        this.updateRevealContext();
      }),

      vscode.workspace.onDidCloseTextDocument(() => {
        this.updateRevealContext();
      }),

      vscode.window.onDidChangeActiveTextEditor(() => {
        this.updateRevealContext();

        /**
         * master 切换编辑器时只同步 activeEditorChanged，
         * 不主动 revealPath。
         */
        this.recentProjectsProvider.syncActiveEditor();

        this.requestRefreshMetadata();
      }),

      vscode.languages.onDidChangeDiagnostics(() => {
        this.requestRefreshMetadata();
      }),
    );
  }

  private updateRevealContext(): void {
    const editor = vscode.window.activeTextEditor;
    const activePath =
      editor && editor.document.uri.scheme === 'file'
        ? editor.document.uri.toString()
        : '';

    this.recentProjectsProvider.updateRevealContext(activePath);
  }

  private requestRefreshMetadata(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }

    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;

      this.recentProjectsProvider.refresh(false);
      this.recentProjectsProvider.requestVisibleMetadataSync();
    }, 250);
  }
}