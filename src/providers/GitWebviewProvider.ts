import * as vscode from 'vscode';
import * as path from 'path';
import { getReactWebviewHtml } from '../utils/WebviewHelper';
import GitService, { type GitFileItem } from '../services/GitService';
import { BranchHandler } from './handlers/BranchHandler';
import { StashHandler } from './handlers/StashHandler';
import { CommitHandler } from './handlers/CommitHandler';
import { CompareHandler } from './handlers/CompareHandler';
import { DiffBuilder } from './utils/DiffBuilder';
import { GitCommandWrapper } from './utils/GitCommandWrapper';
import { GitStateManager } from './utils/GitStateManager';

export class GitWebviewProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private _customCwd: string | null = null;

  private readonly VIEW_ID = 'quickOps.gitView';
  private readonly gitService = new GitService();

  private readonly stateManager = new GitStateManager();
  private readonly commandWrapper: GitCommandWrapper;
  private readonly diffBuilder: DiffBuilder;

  private readonly branchHandler: BranchHandler;
  private readonly stashHandler: StashHandler;
  private readonly commitHandler: CommitHandler;
  private readonly compareHandler: CompareHandler;

  private _gitWatchers: vscode.Disposable[] = [];

  constructor(private readonly _extensionUri: vscode.Uri) {
    const gitService = this.gitService;

    const gitDiffProvider = new (class implements vscode.TextDocumentContentProvider {
      async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
        try {
          const params = JSON.parse(decodeURIComponent(uri.query));
          const cwd = params.cwd;
          const ref = params.ref || 'HEAD';
          const filepath = uri.path.substring(1);

          return await gitService.getFileContent(cwd, ref, filepath);
        } catch {
          return '';
        }
      }
    })();

    vscode.workspace.registerTextDocumentContentProvider('quickops-git', gitDiffProvider);

    this.commandWrapper = new GitCommandWrapper(gitService, this._view);
    this.diffBuilder = new DiffBuilder(this.createGitContentUri.bind(this));

    this.branchHandler = new BranchHandler(
      gitService,
      this._view,
      this.withViewProgress.bind(this),
      this.commandWrapper.executeGitOperation.bind(this.commandWrapper),
      this.refreshStatus.bind(this),
      this.commandWrapper.handleGitErrorWithConflictCheck.bind(this.commandWrapper),
    );

    this.stashHandler = new StashHandler(
      gitService,
      this._view,
      this.withViewProgress.bind(this),
      this.commandWrapper.executeGitOperation.bind(this.commandWrapper),
      this.refreshStatus.bind(this),
      this.commandWrapper.handleGitErrorWithConflictCheck.bind(this.commandWrapper),
    );

    this.commitHandler = new CommitHandler(
      gitService,
      this._view,
      this.commandWrapper.executeGitOperation.bind(this.commandWrapper),
      this.refreshStatus.bind(this),
      this.commandWrapper.handleGitErrorWithConflictCheck.bind(this.commandWrapper),
      this.createGitContentUri.bind(this),
    );

    this.compareHandler = new CompareHandler(
      gitService,
      this._view,
      this.withViewProgress.bind(this),
      this.commandWrapper.executeGitOperation.bind(this.commandWrapper),
      this.createGitContentUri.bind(this),
      this.openChangesEditor.bind(this),
    );
  }

  public async setCustomWorkspace(cwd: string | null) {
    this._customCwd = cwd;

    const targetCwd = this.getWorkspaceRoot();

    if (targetCwd) {
      await this.refreshStatus(targetCwd, true);
    } else {
      this._view?.webview.postMessage({
        type: 'noWorkspace',
      });
    }
  }

  public getWorkspaceRoot(): string | undefined {
    if (this._customCwd) return this._customCwd;
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  private async withViewProgress<T>(task: () => Promise<T>): Promise<T> {
    return vscode.window.withProgress(
      {
        location: {
          viewId: this.VIEW_ID,
        },
      },
      async () => {
        return await task();
      },
    );
  }

  private createGitContentUri(cwd: string, ref: string, file: string): vscode.Uri {
    const query = encodeURIComponent(JSON.stringify({ cwd, ref }));
    return vscode.Uri.parse(`quickops-git:///${file}?${query}`);
  }

  private async openChangesEditor(cwd: string, title: string, files: GitFileItem[], mode: 'working' | 'staged'): Promise<void> {
    if (files.length === 0) {
      vscode.window.showInformationMessage(`${title} 中没有可打开的文件。`);
      return;
    }

    const changesArgs = this.diffBuilder.buildChangesArgs(cwd, files, mode, {
      isCurrentWorkspace: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath === cwd,
    });

    await vscode.commands.executeCommand('vscode.changes', title, changesArgs);
  }

  private async checkRemoteSyncInBackground(cwd: string): Promise<void> {
    if (!this._view) return;
    if (this.stateManager.isRemoteSyncChecking()) return;

    this.stateManager.setRemoteSyncChecking(true);

    this._view.webview.postMessage({
      type: 'remoteSyncChecking',
      checking: true,
    });

    try {
      const remoteSync = await this.gitService.getRemoteSync(cwd, {
        fetch: true,
      });

      this._view.webview.postMessage({
        type: 'remoteSyncData',
        remoteSync,
      });
    } finally {
      this.stateManager.setRemoteSyncChecking(false);

      this._view?.webview.postMessage({
        type: 'remoteSyncChecking',
        checking: false,
      });
    }
  }

  private async setupGitWatcher() {
    const gitExtension = vscode.extensions.getExtension('vscode.git');

    if (!gitExtension) return;

    try {
      if (!gitExtension.isActive) {
        await gitExtension.activate();
      }
    } catch {
      return;
    }

    const gitApi = gitExtension.exports?.getAPI(1);

    if (!gitApi) return;

    const onStateChange = () => {
      if (this.commandWrapper.isInternalOp()) return;

      this.stateManager.clearDebounceTimer();

      this.stateManager.setDebounceTimer(
        setTimeout(async () => {
          if (this.commandWrapper.isInternalOp()) return;
          if (this.stateManager.isRefreshing()) return;

          const cwd = this.getWorkspaceRoot();

          if (!cwd) return;

          let currentState = '';

          try {
            currentState = await this.gitService.getGraphState(cwd);
          } catch {
            currentState = '';
          }

          const graphChanged = currentState !== this.stateManager.getLastGraphState();

          if (graphChanged) {
            this.stateManager.setLastGraphState(currentState);
          }

          void this.refreshStatus(cwd, graphChanged);
        }, 1500),
      );
    };

    const openRepoDisposable = gitApi.onDidOpenRepository((repo: any) => {
      const stateDisposable = repo.state.onDidChange(onStateChange);
      this._gitWatchers.push(stateDisposable);
    });

    this._gitWatchers.push(openRepoDisposable);

    if (gitApi.repositories && gitApi.repositories.length > 0) {
      gitApi.repositories.forEach((repo: any) => {
        const stateDisposable = repo.state.onDidChange(onStateChange);
        this._gitWatchers.push(stateDisposable);
      });
    }
  }

  public resolveWebviewView(webviewView: vscode.WebviewView, _context: vscode.WebviewViewResolveContext, _token: vscode.CancellationToken) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = getReactWebviewHtml(this._extensionUri, webviewView.webview, '/git');

    void this.setupGitWatcher();

    const editorListener = vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor && this._view && editor.document.uri.scheme === 'file') {
        const cwd = this.getWorkspaceRoot();

        if (cwd) {
          const relativePath = path.relative(cwd, editor.document.uri.fsPath).replace(/\\/g, '/');

          this._view.webview.postMessage({
            type: 'activeEditorChanged',
            file: relativePath,
          });
        }
      }
    });

    const configListener = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('quick-ops.git.defaultSkipVerify')) {
        const config = vscode.workspace.getConfiguration('quick-ops.git');
        const defaultSkipVerify = config.get<boolean>('defaultSkipVerify') || false;

        this._view?.webview.postMessage({
          type: 'gitConfigChanged',
          defaultSkipVerify,
        });
      }
    });

    webviewView.onDidDispose(() => {
      editorListener.dispose();
      configListener.dispose();

      this._gitWatchers.forEach((d) => d.dispose());
      this._gitWatchers = [];

      this.stateManager.destroy();
      this.commandWrapper.destroy();
    });

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      try {
        if (msg.command === 'openExternal') {
          vscode.env.openExternal(vscode.Uri.parse(msg.url));
          return;
        }

        if (msg.command === 'clone') {
          vscode.commands.executeCommand('git.clone');
          return;
        }

        if (msg.command === 'error') {
          vscode.window.showErrorMessage(msg.message || '操作失败');
          return;
        }

        if (msg.command === 'webviewLoaded' || msg.command === 'refresh') {
          const isInstalled = await this.gitService.checkGitInstalled();

          const config = vscode.workspace.getConfiguration('quick-ops.git');
          const defaultSkipVerify = config.get<boolean>('defaultSkipVerify') || false;

          this._view?.webview.postMessage({
            type: 'gitInstallationStatus',
            isInstalled,
            defaultSkipVerify,
            isInit: msg.command === 'webviewLoaded',
          });

          if (!isInstalled) return;
        }

        const cwd = this.getWorkspaceRoot();

        if (!cwd) {
          if (msg.command === 'webviewLoaded' || msg.command === 'refresh') {
            this._view?.webview.postMessage({
              type: 'noWorkspace',
            });
          }

          return;
        }

        switch (msg.command) {
          case 'webviewLoaded':
          case 'refresh': {
            await this.refreshStatus(cwd, true);

            if (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri.scheme === 'file') {
              const relativePath = path.relative(cwd, vscode.window.activeTextEditor.document.uri.fsPath).replace(/\\/g, '/');

              this._view?.webview.postMessage({
                type: 'activeEditorChanged',
                file: relativePath,
              });
            }

            break;
          }

          case 'refreshStatusOnly': {
            await this.refreshStatus(cwd, false);
            break;
          }

          case 'checkRemoteSync': {
            await this.checkRemoteSyncInBackground(cwd);
            break;
          }

          case 'openStagedChanges': {
            await this.compareHandler.handleOpenStagedChanges(cwd);
            break;
          }

          case 'openWorkingTreeChanges': {
            await this.compareHandler.handleOpenWorkingTreeChanges(cwd);
            break;
          }

          case 'stash': {
            await this.stashHandler.handleStash(cwd);
            break;
          }

          case 'getStashFiles': {
            await this.stashHandler.handleGetStashFiles(cwd, msg.index);
            break;
          }

          case 'stashApply': {
            await this.stashHandler.handleStashApply(cwd, msg.index);
            break;
          }

          case 'stashPop': {
            await this.stashHandler.handleStashPop(cwd, msg.index);
            break;
          }

          case 'stashDrop': {
            await this.stashHandler.handleStashDrop(cwd, msg.index);
            break;
          }

          case 'undoLastCommit': {
            await this.commitHandler.handleUndoLastCommit(cwd);
            break;
          }

          case 'createBranch': {
            await this.branchHandler.handleCreateBranch(cwd);
            break;
          }

          case 'checkoutBranch': {
            await this.branchHandler.handleCheckoutBranch(cwd);
            break;
          }

          case 'mergeBranch': {
            await this.branchHandler.handleMergeBranch(cwd);
            break;
          }

          case 'changeGraphFilter': {
            await this.branchHandler.handleChangeGraphFilter(cwd, msg.current, msg);
            break;
          }

          case 'viewFileHistory': {
            await this.compareHandler.handleViewFileHistory(cwd, msg.file);
            break;
          }

          case 'requestCompare': {
            await this.compareHandler.handleRequestCompare(cwd);
            break;
          }

          case 'compareFileAcrossBranches': {
            await this.compareHandler.handleCompareFileAcrossBranches(cwd, msg.baseBranch, msg.targetBranch);
            break;
          }

          case 'openCommitMultiDiff': {
            await this.compareHandler.handleOpenCommitMultiDiff(cwd, msg.hash);
            break;
          }

          case 'diff': {
            await this.compareHandler.handleDiff(cwd, msg.file, msg.status);
            break;
          }

          case 'commit': {
            await this.commitHandler.handleCommit(cwd, msg.message, msg.skipVerify);
            break;
          }

          case 'pull': {
            await this.commitHandler.handlePull(cwd);
            break;
          }

          case 'push': {
            await this.commitHandler.handlePush(cwd);
            break;
          }

          case 'open': {
            const fileUri = vscode.Uri.file(path.join(cwd, msg.file));
            vscode.commands.executeCommand('vscode.open', fileUri);
            break;
          }

          case 'stageAll': {
            await this.commitHandler.handleStageAll(cwd);
            break;
          }

          case 'stage': {
            await this.commitHandler.handleStage(cwd, msg.file, msg.status);
            break;
          }

          case 'unstageAll': {
            await this.commitHandler.handleUnstageAll(cwd);
            break;
          }

          case 'discardAll': {
            await this.commitHandler.handleDiscardAll(cwd, msg.count);
            break;
          }

          case 'discard': {
            await this.commitHandler.handleDiscard(cwd, msg.file, msg.status);
            break;
          }

          case 'unstage': {
            await this.commitHandler.handleUnstage(cwd, msg.file);
            break;
          }

          case 'getCommitFiles': {
            await this.compareHandler.handleGetCommitFiles(cwd, msg.hash);
            break;
          }

          case 'diffBranchFile': {
            await this.compareHandler.handleDiffBranchFile(cwd, msg.baseBranch, msg.targetBranch, msg.file, msg.status);
            break;
          }

          case 'diffCommitFile': {
            await this.compareHandler.handleDiffCommitFile(cwd, msg.hash, msg.parentHash, msg.file, msg.status);
            break;
          }

          case 'copy': {
            vscode.env.clipboard.writeText(msg.text);
            vscode.window.showInformationMessage(`已复制: ${msg.text}`);
            break;
          }

          case 'ignore': {
            await this.commitHandler.handleIgnore(cwd, msg.file);
            break;
          }

          case 'toggleSkipVerify': {
            try {
              const config = vscode.workspace.getConfiguration('quick-ops.git');
              await config.update('defaultSkipVerify', msg.value, vscode.ConfigurationTarget.Global);
            } catch (error: any) {
              console.error('Failed to update defaultSkipVerify setting:', error);
            }

            break;
          }

          case 'reveal': {
            const fileUri = vscode.Uri.file(path.join(cwd, msg.file));
            vscode.commands.executeCommand('revealFileInOS', fileUri);
            break;
          }
        }
      } catch (error: any) {
        vscode.window.showErrorMessage(`Git 错误: ${error.message}`);

        this._view?.webview.postMessage({
          type: 'error',
          message: error.message,
        });
      }
    });
  }

  private async refreshStatus(cwd: string, fullRefresh: boolean = true) {
    if (!this._view) return;

    if (this.stateManager.isRefreshing()) {
      const oldPending = this.stateManager.getPendingRefresh();

      this.stateManager.setPendingRefresh({
        cwd,
        fullRefresh: fullRefresh || !!oldPending?.fullRefresh,
      });

      return;
    }

    this.stateManager.setRefreshing(true);

    if (fullRefresh) {
      this._view.webview.postMessage({
        type: 'startLoading',
      });
    }

    const postEmptyGraphData = () => {
      this._view?.webview.postMessage({
        type: 'graphData',
        graphCommits: [],
        graphFilter: this.gitService.CURRENT_BRANCH_FILTER,
        totalCommits: 0,
      });
    };

    try {
      const repoStatus = await this.gitService.getRepoStatus(cwd);

      if (!repoStatus.isRepo) {
        this._view.webview.postMessage({
          type: 'notRepo',
        });

        if (fullRefresh) {
          postEmptyGraphData();
        }

        return;
      }

      this._view.webview.postMessage({
        type: 'statusData',
        stagedFiles: repoStatus.stagedFiles,
        unstagedFiles: repoStatus.unstagedFiles,
        conflictedFiles: repoStatus.conflictedFiles,
        branch: repoStatus.branch,
        remoteUrl: repoStatus.remoteUrl,
        folderName: repoStatus.folderName,
        stashes: repoStatus.stashes,
        remoteSync: repoStatus.remoteSync,
      });

      if (repoStatus.remoteUrl) {
        void this.checkRemoteSyncInBackground(cwd);
      }

      if (fullRefresh) {
        try {
          const graphState = await this.gitService.getGraphState(cwd);
          this.stateManager.setLastGraphState(graphState);

          const graphData = await this.gitService.getGraph(cwd, this.gitService.CURRENT_BRANCH_FILTER);

          this._view.webview.postMessage({
            type: 'graphData',
            graphCommits: graphData.graphCommits,
            graphFilter: graphData.graphFilter,
            totalCommits: graphData.totalCommits,
          });
        } catch {
          postEmptyGraphData();
        }
      }
    } catch {
      this._view.webview.postMessage({
        type: 'notRepo',
      });

      if (fullRefresh) {
        postEmptyGraphData();
      }
    } finally {
      this.stateManager.setRefreshing(false);

      const pending = this.stateManager.getPendingRefresh();
      this.stateManager.setPendingRefresh(null);

      if (pending) {
        setTimeout(() => {
          void this.refreshStatus(pending.cwd, pending.fullRefresh);
        }, 0);
      }
    }
  }
}
