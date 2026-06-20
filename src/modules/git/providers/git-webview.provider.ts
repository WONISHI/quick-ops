import * as vscode from 'vscode';
import { getReactWebviewHtml } from '../../../utils/WebviewHelper';
import { ExtensionContextProvider } from '../../../common/providers/extension-context.provider';
import { GitService } from '../git.service';
import { GIT_WEBVIEW_ROUTES } from '../git.constant';
import type { GitPostMessage, GitWebviewMessage } from '../git.type';

export class GitWebviewProvider implements vscode.WebviewViewProvider {
  public static inject = [ExtensionContextProvider, GitService];

  private view?: vscode.WebviewView;
  private customWorkspace: string | null = null;

  constructor(
    private readonly extensionContextProvider: ExtensionContextProvider,
    private readonly gitService: GitService,
  ) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView;

    const context = this.extensionContextProvider.getContext();

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [context.extensionUri],
    };

    webviewView.webview.html = getReactWebviewHtml(
      context.extensionUri,
      webviewView.webview,
      GIT_WEBVIEW_ROUTES.main,
    );

    webviewView.webview.onDidReceiveMessage(async message => {
      await this.handleMessage(message);
    });

    setTimeout(() => {
      void this.refresh();
    }, 100);
  }

  public setCustomWorkspace(pathValue: string | null): void {
    this.customWorkspace = pathValue;
  }

  public async refresh(): Promise<void> {
    const workingDir = this.getWorkingDir();

    const status = await this.gitService.getStatus(workingDir);

    await this.gitService.setCurrentPreviewPath(workingDir || undefined);

    this.postMessage({
      type: 'gitStatus',
      status,
      payload: {
        previewState: this.gitService.getWorkspacePreviewState(),
      },
    });
  }

  public dispose(): void {
    this.view = undefined;
    this.customWorkspace = null;
  }

  private async handleMessage(message: GitWebviewMessage): Promise<void> {
    try {
      switch (message.type || message.command) {
        case 'ready':
        case 'webviewLoaded':
        case 'refresh':
          await this.refresh();
          break;

        case 'setCustomWorkspace':
          this.customWorkspace = message.workingDir || null;
          await this.gitService.setCurrentPreviewPath(this.customWorkspace || undefined);
          await this.refresh();
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

        case 'fetch':
          await this.gitService.fetch(this.getWorkingDir());
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

        case 'openDetail':
          await vscode.commands.executeCommand('quickOps.openGitDetail');
          break;

        case 'clone':
          await this.gitService.cloneGitProjectByInput();
          await this.refresh();
          break;

        case 'returnToWorkspace':
          await this.gitService.returnToWorkspace();
          this.customWorkspace = this.gitService.getCurrentWorkingDir();
          await this.refresh();
          break;
      }
    } catch (error) {
      this.postMessage({
        type: 'gitError',
        requestId: message.requestId,
        error: this.toErrorMessage(error),
      });

      vscode.window.showErrorMessage(`Git 操作失败：${this.toErrorMessage(error)}`);
    }
  }

  private getWorkingDir(): string {
    return this.customWorkspace || this.gitService.getCurrentWorkingDir();
  }

  private postMessage(message: GitPostMessage): void {
    this.view?.webview.postMessage(message);
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