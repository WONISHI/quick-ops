import * as vscode from 'vscode';
import { getReactWebviewHtml } from '../../../utils/WebviewHelper';
import { ExtensionContextProvider } from '../../../common/providers/extension-context.provider';
import { GitService } from '../git.service';
import { GIT_WEBVIEW_ROUTES } from '../git.constant';
import type { GitPostMessage, GitWebviewMessage } from '../git.type';

export class GitDetailWebviewProvider {
  public static inject = [ExtensionContextProvider, GitService];

  private panel?: vscode.WebviewPanel;
  private currentWorkingDir: string | undefined;

  constructor(
    private readonly extensionContextProvider: ExtensionContextProvider,
    private readonly gitService: GitService,
  ) {}

  public async open(workingDir?: string): Promise<void> {
    const context = this.extensionContextProvider.getContext();

    this.currentWorkingDir = workingDir || this.gitService.getCurrentWorkingDir();

    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
      await this.refresh(this.currentWorkingDir, {
        silent: true,
        fetchRemote: false,
      });
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'quickOpsGitDetail',
      'Git 详情',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [context.extensionUri],
      },
    );

    this.panel.iconPath = vscode.Uri.joinPath(
      context.extensionUri,
      'resources',
      'icons',
      'git.svg',
    );

    this.panel.webview.html = getReactWebviewHtml(
      context.extensionUri,
      this.panel.webview,
      GIT_WEBVIEW_ROUTES.detail,
    );

    this.panel.webview.onDidReceiveMessage(async message => {
      await this.handleMessage(message);
    });

    this.panel.onDidDispose(() => {
      this.panel = undefined;
      this.currentWorkingDir = undefined;
    });

    setTimeout(() => {
      void this.refresh(this.currentWorkingDir, {
        silent: true,
        fetchRemote: false,
      });
    }, 100);
  }

  public async refresh(
    workingDir?: string,
    options: {
      silent?: boolean;
      fetchRemote?: boolean;
    } = {},
  ): Promise<void> {
    if (!this.panel) return;

    const finalWorkingDir =
      workingDir || this.currentWorkingDir || this.gitService.getCurrentWorkingDir();

    this.currentWorkingDir = finalWorkingDir;

    try {
      if (options.fetchRemote) {
        await this.gitService.fetch(finalWorkingDir);
      }

      const detail = await this.gitService.getDetailSummary(finalWorkingDir);

      this.postMessage({
        type: 'gitDetail',
        detail,
        payload: {
          previewState: this.gitService.getWorkspacePreviewState(),
        },
      });
    } catch (error) {
      if (!options.silent) {
        vscode.window.showErrorMessage(`刷新 Git 详情失败：${this.toErrorMessage(error)}`);
      }

      this.postMessage({
        type: 'gitDetailError',
        error: this.toErrorMessage(error),
      });
    }
  }

  public dispose(): void {
    this.panel?.dispose();
    this.panel = undefined;
    this.currentWorkingDir = undefined;
  }

  private async handleMessage(message: GitWebviewMessage): Promise<void> {
    try {
      switch (message.type || message.command) {
        case 'ready':
        case 'webviewLoaded':
        case 'refresh':
          await this.refresh(message.workingDir, {
            silent: true,
            fetchRemote: false,
          });
          break;

        case 'fetch':
          await this.refresh(this.getWorkingDir(), {
            silent: false,
            fetchRemote: true,
          });
          break;

        case 'stageFile':
          if (message.filePath) {
            await this.gitService.stageFile(message.filePath, this.getWorkingDir());
            await this.refresh();
          }
          break;

        case 'unstageFile':
          if (message.filePath) {
            await this.gitService.unstageFile(message.filePath, this.getWorkingDir());
            await this.refresh();
          }
          break;

        case 'discardFile':
          if (message.filePath) {
            await this.gitService.discardFile(message.filePath, this.getWorkingDir());
            await this.refresh();
          }
          break;

        case 'commit':
          await this.gitService.commit(
            message.commitMessage || message.message || '',
            this.getWorkingDir(),
          );
          await this.refresh();
          break;

        case 'push':
          await this.gitService.push(this.getWorkingDir());
          await this.refresh();
          break;

        case 'pull':
          await this.gitService.pull(this.getWorkingDir());
          await this.refresh();
          break;

        case 'checkoutBranch':
          if (message.branch) {
            await this.gitService.checkoutBranch(message.branch, this.getWorkingDir());
            await this.refresh();
          }
          break;

        case 'openFile':
          if (message.filePath) {
            await this.gitService.openFile({
              filePath: message.filePath,
              workingDir: this.getWorkingDir(),
              preview: false,
            });
          }
          break;

        case 'openDiff':
          if (message.filePath) {
            await this.gitService.openFileDiff({
              filePath: message.filePath,
              workingDir: this.getWorkingDir(),
            });
          }
          break;

        case 'openExternalRemote':
          await vscode.commands.executeCommand('quickOps.editRemoteUrl');
          await this.refresh();
          break;
      }
    } catch (error) {
      const messageText = this.toErrorMessage(error);

      this.postMessage({
        type: 'gitDetailError',
        requestId: message.requestId,
        error: messageText,
      });

      vscode.window.showErrorMessage(`Git 详情操作失败：${messageText}`);
    }
  }

  private getWorkingDir(): string {
    return this.currentWorkingDir || this.gitService.getCurrentWorkingDir();
  }

  private postMessage(message: GitPostMessage): void {
    this.panel?.webview.postMessage(message);
  }

  private toErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;

    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
}
