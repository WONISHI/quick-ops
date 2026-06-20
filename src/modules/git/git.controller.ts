import * as vscode from 'vscode';
import ColorLog from '../../utils/ColorLog';
import type { OnModuleInit } from '../../core/lifecycle/lifecycle.interface';
import { ExtensionContextProvider } from '../../common/providers/extension-context.provider';
import { GitService } from './git.service';
import { GitWebviewProvider } from './providers/git-webview.provider';
import { GitDetailWebviewProvider } from './providers/git-detail-webview.provider';
import { GitVirtualContentProvider } from './providers/git-virtual-content.provider';
import { GIT_COMMANDS, GIT_VIEW_IDS } from './git.constant';

export class GitController implements OnModuleInit {
  public static inject = [
    ExtensionContextProvider,
    GitService,
    GitWebviewProvider,
    GitDetailWebviewProvider,
    GitVirtualContentProvider,
  ];

  private readonly id = 'GitModule';

  private refreshTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly extensionContextProvider: ExtensionContextProvider,
    private readonly gitService: GitService,
    private readonly gitWebviewProvider: GitWebviewProvider,
    private readonly gitDetailWebviewProvider: GitDetailWebviewProvider,
    private readonly gitVirtualContentProvider: GitVirtualContentProvider,
  ) {}

  public async onModuleInit(): Promise<void> {
    /**
     * 关键：
     * GitVirtualContentProvider 不再通过 static inject 注入 GitService，
     * 这里手动传入已经由容器创建好的 GitService 实例。
     */
    this.gitVirtualContentProvider.setGitService(this.gitService);

    this.registerProviders();
    this.registerCommands();
    this.registerListeners();

    await this.gitService.initializeConfigSync();

    ColorLog.black(`[${this.id}]`, 'Activated.');
  }

  public dispose(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }

    this.gitWebviewProvider.dispose();
    this.gitDetailWebviewProvider.dispose();
    this.gitVirtualContentProvider.dispose();
    this.gitService.dispose();
  }

  private registerProviders(): void {
    this.extensionContextProvider.register(
      vscode.window.registerWebviewViewProvider(
        GIT_VIEW_IDS.main,
        this.gitWebviewProvider,
        {
          webviewOptions: {
            retainContextWhenHidden: true,
          },
        },
      ),

      vscode.workspace.registerTextDocumentContentProvider(
        'quickops-git',
        this.gitVirtualContentProvider,
      ),
    );
  }

  private registerCommands(): void {
    this.extensionContextProvider.register(
      vscode.commands.registerCommand(GIT_COMMANDS.openGitDetail, async () => {
        await this.gitDetailWebviewProvider.open();
      }),

      vscode.commands.registerCommand(GIT_COMMANDS.refreshGit, async () => {
        await this.gitWebviewProvider.refresh();

        await this.gitDetailWebviewProvider.refresh(undefined, {
          silent: true,
          fetchRemote: false,
        });
      }),

      vscode.commands.registerCommand(GIT_COMMANDS.cloneGitProject, async () => {
        await this.gitService.cloneGitProjectByInput();
      }),

      vscode.commands.registerCommand(GIT_COMMANDS.openProject, async () => {
        await this.gitService.openCurrentPreviewProject();
      }),

      vscode.commands.registerCommand(GIT_COMMANDS.editRemoteUrl, async () => {
        await this.gitService.editCurrentRemoteUrl();
        await this.gitWebviewProvider.refresh();

        await this.gitDetailWebviewProvider.refresh(undefined, {
          silent: true,
          fetchRemote: false,
        });
      }),

      vscode.commands.registerCommand(GIT_COMMANDS.returnToWorkspace, async () => {
        await this.gitService.returnToWorkspace();

        const currentPath = this.gitService.getCurrentWorkingDir();

        this.gitWebviewProvider.setCustomWorkspace(currentPath || null);

        await this.gitWebviewProvider.refresh();

        await this.gitDetailWebviewProvider.refresh(currentPath, {
          silent: true,
          fetchRemote: false,
        });
      }),

      vscode.commands.registerCommand(
        GIT_COMMANDS.openFile,
        async (filePath?: string, workingDir?: string) => {
          if (!filePath) return;

          await this.gitService.openFile({
            filePath,
            workingDir: workingDir || this.gitService.getCurrentWorkingDir(),
            preview: false,
          });
        },
      ),

      vscode.commands.registerCommand(
        GIT_COMMANDS.openDiff,
        async (filePath?: string, workingDir?: string) => {
          if (!filePath) return;

          await this.gitService.openFileDiff({
            filePath,
            workingDir: workingDir || this.gitService.getCurrentWorkingDir(),
          });
        },
      ),
    );
  }

  private registerListeners(): void {
    this.extensionContextProvider.register(
      vscode.workspace.onDidSaveTextDocument(() => {
        this.requestRefresh();
      }),

      vscode.workspace.onDidCreateFiles(() => {
        this.requestRefresh();
      }),

      vscode.workspace.onDidDeleteFiles(() => {
        this.requestRefresh();
      }),

      vscode.workspace.onDidRenameFiles(() => {
        this.requestRefresh();
      }),

      vscode.window.onDidChangeActiveTextEditor(() => {
        this.requestRefresh();
      }),

      vscode.workspace.onDidChangeConfiguration(event => {
        void this.gitService.handleConfigurationChange(event);
      }),
    );
  }

  private requestRefresh(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }

    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;

      void this.gitWebviewProvider.refresh();

      void this.gitDetailWebviewProvider.refresh(undefined, {
        silent: true,
        fetchRemote: false,
      });
    }, 250);
  }
}