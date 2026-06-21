import * as vscode from 'vscode';
import { getReactWebviewHtml } from '../../../utils/WebviewHelper';
import { ExtensionContextProvider } from '../../../common/providers/extension-context.provider';
import { GitService } from '../git.service';
import { GIT_COMMANDS, GIT_WEBVIEW_ROUTES } from '../git.constant';
import type { GitFileItem, GitGraphCommit, GitWebviewMessage } from '../git.type';

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
      console.log('[GitWebviewProvider] receive message:', message);

      try {
        await this.handleMessage(message);
      } catch (error) {
        console.error('[GitWebviewProvider] handleMessage failed:', error);

        this.postMessage({
          type: 'error',
          requestId: message?.requestId,
          error: this.toErrorMessage(error),
        });

        vscode.window.showErrorMessage(
          `Git 操作失败：${this.toErrorMessage(error)}`,
        );
      }
    });

    webviewView.onDidDispose(() => {
      if (this.view === webviewView) {
        this.view = undefined;
      }
    });

    /**
     * 主动推送一次，避免前端 ready / webviewLoaded 消息丢失。
     */
    setTimeout(() => {
      void this.refresh();
    }, 100);

    /**
     * 再补一次，避免 Webview 前端 listener 还没挂载完成。
     */
    setTimeout(() => {
      void this.refresh();
    }, 500);
  }

  public setCustomWorkspace(pathValue: string | null): void {
    this.customWorkspace = pathValue;
  }

  public async refresh(): Promise<void> {
    const workingDir = this.getWorkingDir();

    this.postMessage({
      type: 'startLoading',
    });

    if (!workingDir) {
      this.postMessage({
        type: 'noWorkspace',
      });

      this.postMessage({
        type: 'stopGraphLoading',
      });

      return;
    }

    try {
      await this.gitService.setCurrentPreviewPath(workingDir || undefined);

      const status = await this.gitService.getRepoStatus(workingDir);

      if (!status.isRepo) {
        this.postMessage({
          type: 'notRepo',
        });

        this.postMessage({
          type: 'stopGraphLoading',
        });

        return;
      }

      /**
       * GitApp 前端监听 statusData。
       * 不要只发 gitStatus，否则 UI 不会更新。
       */
      this.postMessage({
        type: 'statusData',
        isRepo: status.isRepo,
        branch: status.branch,
        remoteUrl: status.remoteUrl,
        folderName: status.folderName,
        stagedFiles: status.stagedFiles,
        unstagedFiles: status.unstagedFiles,
        conflictedFiles: status.conflictedFiles,
        stashes: status.stashes,
        remoteSync: status.remoteSync,
        payload: {
          previewState: this.gitService.getWorkspacePreviewState(),
        },
      });

      /**
       * 兼容重构后的新协议。
       */
      this.postMessage({
        type: 'gitStatus',
        status,
        payload: {
          previewState: this.gitService.getWorkspacePreviewState(),
        },
      });

      await this.refreshGraph(workingDir);
    } catch (error) {
      const message = this.toErrorMessage(error);

      this.postMessage({
        type: 'error',
        error: message,
      });

      this.postMessage({
        type: 'stopGraphLoading',
      });

      vscode.window.showErrorMessage(`刷新 Git 状态失败：${message}`);
    }
  }

  public dispose(): void {
    this.view = undefined;
    this.customWorkspace = null;
  }

  private async refreshGraph(
    workingDir = this.getWorkingDir(),
    graphFilter?: string,
  ): Promise<void> {
    if (!workingDir) {
      this.postMessage({
        type: 'stopGraphLoading',
      });

      return;
    }

    try {
      const graph = await this.gitService.getGraph(workingDir, graphFilter);

      this.postMessage({
        type: 'graphData',
        graphCommits: graph.graphCommits,
        graphFilter: graph.graphFilter,
        totalCommits: graph.totalCommits,
      });
    } catch (error) {
      console.error('[GitWebviewProvider] refreshGraph failed:', error);

      this.postMessage({
        type: 'graphData',
        graphCommits: [],
        graphFilter,
        totalCommits: 0,
      });

      this.postMessage({
        type: 'stopGraphLoading',
      });
    }
  }

  private async handleMessage(message: GitWebviewMessage & Record<string, any>): Promise<void> {
    const command = message.type || message.command;

    switch (command) {
      case 'ready':
      case 'webviewLoaded':
      case 'refresh':
        await this.refresh();
        break;

      case 'refreshStatusOnly':
        await this.refresh();
        break;

      case 'setCustomWorkspace':
        this.customWorkspace = message.workingDir || null;

        await this.gitService.setCurrentPreviewPath(
          this.customWorkspace || undefined,
        );

        await this.refresh();
        break;

      case 'stageFile':
        await this.stageFile(message);
        break;

      case 'stageAll':
        await this.gitService.stageAll(this.getWorkingDir());
        await this.refresh();
        break;

      case 'unstageFile':
        await this.unstageFile(message);
        break;

      case 'unstageAll':
        await this.gitService.unstageAll(this.getWorkingDir());
        await this.refresh();
        break;

      case 'discardFile':
      case 'discard':
        await this.discardFile(message);
        break;

      case 'discardAll':
        await this.gitService.discardAll(this.getWorkingDir());
        await this.refresh();
        break;

      case 'commit':
        await this.commit(message);
        break;

      case 'undoLastCommit':
        await this.undoLastCommit();
        break;

      case 'push':
        await this.push();
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
        await this.checkoutBranch(message.branch);
        break;

      case 'createBranch':
        await this.createBranch();
        break;

      case 'mergeBranch':
        await this.mergeBranch();
        break;

      case 'changeGraphFilter':
        await this.changeGraphFilter(message.current);
        break;

      case 'getCommitFiles':
        await this.getCommitFiles(message);
        break;

      case 'getStashFiles':
        await this.getStashFiles(message);
        break;

      case 'stash':
        await this.stash();
        break;

      case 'stashApply':
        await this.stashApply(message);
        break;

      case 'stashPop':
        await this.stashPop(message);
        break;

      case 'stashDrop':
        await this.stashDrop(message);
        break;

      case 'openFile':
        await this.openFile(message);
        break;

      case 'openDiff':
        await this.openDiff(message);
        break;

      case 'diffCommitFile':
        await this.diffCommitFile(message);
        break;

      case 'diffBranchFile':
        await this.diffBranchFile(message);
        break;

      case 'viewFileHistory':
        await this.viewFileHistory(message);
        break;

      case 'compareFileAcrossBranches':
        await this.compareFileAcrossBranches(message);
        break;

      case 'openDetail':
        await vscode.commands.executeCommand(GIT_COMMANDS.openGitDetail);
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

      case 'openStagedChanges':
      case 'openWorkingTreeChanges':
      case 'openCommitMultiDiff':
      case 'toggleCommitTypeEnabled':
      case 'toggleSkipVerify':
        /**
         * 这些命令当前先不阻塞 UI。
         * 后续如果需要完整能力，再单独接入对应 service 方法。
         */
        break;

      case 'error':
        if (message.message) {
          vscode.window.showErrorMessage(message.message);
        }
        break;

      default:
        console.warn('[GitWebviewProvider] unknown message:', message);
        break;
    }
  }

  private async stageFile(message: Record<string, any>): Promise<void> {
    const filePath = message.filePath || message.file;

    if (!filePath) return;

    await this.gitService.stageFile(filePath, this.getWorkingDir(), message.status);

    await this.refresh();
  }

  private async unstageFile(message: Record<string, any>): Promise<void> {
    const filePath = message.filePath || message.file;

    if (!filePath) return;

    await this.gitService.unstageFile(filePath, this.getWorkingDir());

    await this.refresh();
  }

  private async discardFile(message: Record<string, any>): Promise<void> {
    const filePath = message.filePath || message.file;

    if (!filePath) return;

    await this.gitService.discardFile(
      filePath,
      this.getWorkingDir(),
      message.status,
    );

    await this.refresh();
  }

  private async commit(message: Record<string, any>): Promise<void> {
    const commitMessage = message.commitMessage || message.message || '';

    await this.gitService.commit(
      commitMessage,
      this.getWorkingDir(),
      Boolean(message.skipVerify),
    );

    this.postMessage({
      type: 'commitSuccess',
      message: commitMessage,
    });

    await this.refresh();
  }

  private async undoLastCommit(): Promise<void> {
    const workingDir = this.getWorkingDir();

    await this.gitService.undoLastCommit(workingDir);

    this.postMessage({
      type: 'undoLastCommitSuccess',
    });

    await this.refresh();
  }

  private async push(): Promise<void> {
    const workingDir = this.getWorkingDir();
    const pushInfo = await this.gitService.getPushInfo(workingDir);

    await this.gitService.push(workingDir, {
      createUpstream: !pushInfo.hasUpstream,
      branch: pushInfo.currentBranch,
    });

    await this.refresh();
  }

  private async checkoutBranch(branch?: string): Promise<void> {
    const workingDir = this.getWorkingDir();

    if (!workingDir) return;

    let targetBranch = branch;

    if (!targetBranch) {
      const branches = await this.gitService.getAllBranches(workingDir);

      targetBranch = await vscode.window.showQuickPick(branches, {
        placeHolder: '请选择要切换的分支',
      });
    }

    if (!targetBranch) return;

    await this.gitService.checkoutBranch(targetBranch, workingDir);

    await this.refresh();
  }

  private async createBranch(): Promise<void> {
    const workingDir = this.getWorkingDir();

    if (!workingDir) return;

    const branchName = await vscode.window.showInputBox({
      title: '创建分支',
      prompt: '请输入新分支名称',
      ignoreFocusOut: true,
      validateInput: value => {
        return value.trim() ? null : '分支名称不能为空';
      },
    });

    if (!branchName) return;

    await this.gitService.createBranch(workingDir, branchName.trim());

    await this.refresh();
  }

  private async mergeBranch(): Promise<void> {
    const workingDir = this.getWorkingDir();

    if (!workingDir) return;

    const branches = await this.gitService.getAllBranches(workingDir);
    const branchName = await vscode.window.showQuickPick(branches, {
      placeHolder: '请选择要合并到当前分支的分支',
    });

    if (!branchName) return;

    await this.gitService.mergeBranch(workingDir, branchName);

    await this.refresh();
  }

  private async changeGraphFilter(current?: string): Promise<void> {
    const workingDir = this.getWorkingDir();

    if (!workingDir) return;

    const branches = await this.gitService.getAllBranches(workingDir);
    const options = [
      this.gitService.ALL_BRANCH_FILTER,
      this.gitService.CURRENT_BRANCH_FILTER,
      ...branches,
    ];

    const picked = await vscode.window.showQuickPick(options, {
      placeHolder: '请选择图形展示范围',
      ignoreFocusOut: true,
    });

    if (!picked) {
      await this.refreshGraph(workingDir, current);
      return;
    }

    this.postMessage({
      type: 'startLoading',
    });

    await this.refreshGraph(workingDir, picked);
  }

  private async getCommitFiles(message: Record<string, any>): Promise<void> {
    if (!message.hash) return;

    const result = await this.gitService.getCommitFiles(
      this.getWorkingDir(),
      message.hash,
    );

    this.postMessage({
      type: 'commitFilesData',
      hash: result.hash,
      parentHash: result.parentHash,
      files: result.files,
    });
  }

  private async getStashFiles(message: Record<string, any>): Promise<void> {
    if (message.index === undefined || message.index === null) return;

    const result = await this.gitService.getStashFiles(
      this.getWorkingDir(),
      Number(message.index),
    );

    this.postMessage({
      type: 'stashFilesData',
      index: result.index,
      files: result.files,
    });
  }

  private async stash(): Promise<void> {
    const message = await vscode.window.showInputBox({
      title: 'Git Stash',
      prompt: '请输入 stash 描述，可留空',
      ignoreFocusOut: true,
    });

    await this.gitService.stashPush(this.getWorkingDir(), message);

    await this.refresh();
  }

  private async stashApply(message: Record<string, any>): Promise<void> {
    if (message.index === undefined || message.index === null) return;

    await this.gitService.stashApply(this.getWorkingDir(), Number(message.index));

    await this.refresh();
  }

  private async stashPop(message: Record<string, any>): Promise<void> {
    if (message.index === undefined || message.index === null) return;

    await this.gitService.stashPop(this.getWorkingDir(), Number(message.index));

    await this.refresh();
  }

  private async stashDrop(message: Record<string, any>): Promise<void> {
    if (message.index === undefined || message.index === null) return;

    await this.gitService.stashDrop(this.getWorkingDir(), Number(message.index));

    await this.refresh();
  }

  private async openFile(message: Record<string, any>): Promise<void> {
    const filePath = message.filePath || message.file;

    if (!filePath) return;

    await this.gitService.openFile({
      filePath,
      workingDir: this.getWorkingDir(),
      preview: false,
    });
  }

  private async openDiff(message: Record<string, any>): Promise<void> {
    const filePath = message.filePath || message.file;

    if (!filePath) return;

    await this.gitService.openFileDiff({
      filePath,
      workingDir: this.getWorkingDir(),
      baseRef: message.baseRef,
    });
  }

  private async diffCommitFile(message: Record<string, any>): Promise<void> {
    const filePath = message.filePath || message.file;

    if (!filePath || !message.hash) return;

    await this.gitService.openFileDiff({
      filePath,
      workingDir: this.getWorkingDir(),
      baseRef: message.parentHash || `${message.hash}^`,
      title: `${filePath} ↔ ${message.hash}`,
    });
  }

  private async diffBranchFile(message: Record<string, any>): Promise<void> {
    const filePath = message.filePath || message.file;

    if (!filePath || !message.baseBranch) return;

    await this.gitService.openFileDiff({
      filePath,
      workingDir: this.getWorkingDir(),
      baseRef: message.baseBranch,
      title: `${filePath} ↔ ${message.baseBranch}`,
    });
  }

  private async viewFileHistory(message: Record<string, any>): Promise<void> {
    const file = message.file || message.filePath;

    if (!file) return;

    const commits = await this.gitService.getFileHistory(this.getWorkingDir(), file);

    this.postMessage({
      type: 'compareData',
      targetBranch: file,
      baseBranch: '文件历史',
      commits,
    });
  }

  private async compareFileAcrossBranches(message: Record<string, any>): Promise<void> {
    const workingDir = this.getWorkingDir();

    if (!workingDir) return;

    const branches = await this.gitService.getAllBranches(workingDir);

    const baseBranch =
      message.baseBranch ||
      (await vscode.window.showQuickPick(branches, {
        placeHolder: '请选择对比基准分支',
        ignoreFocusOut: true,
      }));

    if (!baseBranch) return;

    const targetBranch =
      message.targetBranch ||
      (await vscode.window.showQuickPick(branches, {
        placeHolder: '请选择目标分支',
        ignoreFocusOut: true,
      }));

    if (!targetBranch) return;

    const commits = await this.gitService.getCompareCommits(
      workingDir,
      baseBranch,
      targetBranch,
    );

    this.postMessage({
      type: 'compareData',
      baseBranch,
      targetBranch,
      commits,
    });
  }

  private getWorkingDir(): string {
    return this.customWorkspace || this.gitService.getCurrentWorkingDir();
  }

  private postMessage(message: Record<string, any>): void {
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