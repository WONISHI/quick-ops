import * as vscode from 'vscode';
import * as path from 'path';
import { getReactWebviewHtml } from '../utils/WebviewHelper';
import GitService from '../services/GitService';

export class GitDetailWebviewPanel {
  private _panel?: vscode.WebviewPanel;
  private readonly gitService = new GitService();

  private _currentGraphFilter = '全部分支';
  private _lastGraphState = '';

  private _isRefreshing = false;
  private _pendingRefresh: {
    cwd: string;
    graphFilter: string;
    silent: boolean;
    fetchRemote: boolean;
  } | null = null;

  private _isRemoteChecking = false;
  private _refreshTimer: NodeJS.Timeout | null = null;
  private _remoteCheckTimer: NodeJS.Timeout | null = null;
  private _disposables: vscode.Disposable[] = [];

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly getWorkspaceRoot: () => string | undefined,
  ) {}

  public open() {
    if (this._panel) {
      this._panel.reveal(vscode.ViewColumn.Active);

      const cwd = this.getWorkspaceRoot();

      if (cwd) {
        void this.postGraphData(cwd, this._currentGraphFilter, false, true);
      }

      return;
    }

    this._panel = vscode.window.createWebviewPanel(
      'quickOps.gitDetail',
      'Git 提交详情',
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this._extensionUri],
      },
    );

    this._panel.onDidDispose(() => {
      this.disposeListeners();
      this._panel = undefined;
      this._lastGraphState = '';
      this._currentGraphFilter = '全部分支';
    });

    this._panel.webview.onDidReceiveMessage(async (msg) => {
      try {
        if (msg.command === 'openExternal') {
          vscode.env.openExternal(vscode.Uri.parse(msg.url));
          return;
        }

        const cwd = this.getWorkspaceRoot();

        if (!cwd) {
          this._panel?.webview.postMessage({
            type: 'gitDetailNoWorkspace',
          });
          return;
        }

        switch (msg.command) {
          case 'gitDetailLoaded':
          case 'refreshGitDetail': {
            await this.postGraphData(cwd, msg.graphFilter || this._currentGraphFilter, false, true);
            break;
          }

          case 'changeGitDetailFilter': {
            await this.changeGraphFilter(cwd, msg.current || this._currentGraphFilter);
            break;
          }

          case 'openCommitMultiDiff': {
            await this.openCommitMultiDiff(cwd, msg.hash);
            break;
          }

          case 'getGitDetailCommitFiles': {
            await this.postCommitFiles(cwd, msg.hash);
            break;
          }

          case 'openGitDetailCommitFileDiff': {
            await this.openCommitFileDiff(cwd, msg.hash, msg.parentHash, msg.file, msg.status);
            break;
          }

          case 'copy': {
            vscode.env.clipboard.writeText(msg.text || '');
            vscode.window.showInformationMessage(`已复制: ${msg.text}`);
            break;
          }
        }
      } catch (error: any) {
        vscode.window.showErrorMessage(`Git 详情错误: ${error?.message ?? String(error)}`);

        this._panel?.webview.postMessage({
          type: 'gitDetailError',
          message: error?.message ?? String(error),
        });
      }
    });

    this._panel.webview.html = getReactWebviewHtml(this._extensionUri, this._panel.webview, '/git-detail');

    this._panel.iconPath = vscode.Uri.joinPath(this._extensionUri, 'resources', 'icons', 'git.png');

    void this.setupGitWatcher();

    const cwd = this.getWorkspaceRoot();

    if (cwd) {
      this.startRemoteCheckTimer();

      setTimeout(() => {
        void this.postGraphData(cwd, this._currentGraphFilter, false, true);
      }, 300);
    } else {
      setTimeout(() => {
        this._panel?.webview.postMessage({
          type: 'gitDetailNoWorkspace',
        });
      }, 300);
    }
  }

  public refresh(graphFilter = this._currentGraphFilter, options?: { silent?: boolean; fetchRemote?: boolean }) {
    const cwd = this.getWorkspaceRoot();

    if (!cwd) return;

    void this.postGraphData(
      cwd,
      graphFilter || this._currentGraphFilter,
      options?.silent ?? true,
      options?.fetchRemote ?? true,
    );
  }

  private disposeListeners() {
    this._disposables.forEach((item) => item.dispose());
    this._disposables = [];

    if (this._refreshTimer) {
      clearTimeout(this._refreshTimer);
      this._refreshTimer = null;
    }

    if (this._remoteCheckTimer) {
      clearInterval(this._remoteCheckTimer);
      this._remoteCheckTimer = null;
    }
  }

  private scheduleRefresh(cwd: string, silent = true, fetchRemote = false) {
    if (!this._panel) return;

    if (this._refreshTimer) {
      clearTimeout(this._refreshTimer);
    }

    this._refreshTimer = setTimeout(() => {
      this._refreshTimer = null;
      void this.postGraphData(cwd, this._currentGraphFilter, silent, fetchRemote);
    }, 500);
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

    const gitApi = gitExtension.exports?.getAPI?.(1);

    if (!gitApi) return;

    const handleGitStateChange = () => {
      const cwd = this.getWorkspaceRoot();

      if (!cwd) return;

      this.scheduleRefresh(cwd, true, false);
    };

    const openRepoDisposable = gitApi.onDidOpenRepository((repo: any) => {
      const stateDisposable = repo.state.onDidChange(handleGitStateChange);
      this._disposables.push(stateDisposable);
    });

    this._disposables.push(openRepoDisposable);

    if (gitApi.repositories && gitApi.repositories.length > 0) {
      gitApi.repositories.forEach((repo: any) => {
        const stateDisposable = repo.state.onDidChange(handleGitStateChange);
        this._disposables.push(stateDisposable);
      });
    }

    const focusDisposable = vscode.window.onDidChangeWindowState((state) => {
      if (!state.focused) return;

      const cwd = this.getWorkspaceRoot();

      if (!cwd) return;

      void this.checkRemoteAndRefresh(cwd);
    });

    this._disposables.push(focusDisposable);
  }

  private startRemoteCheckTimer() {
    if (this._remoteCheckTimer) return;

    this._remoteCheckTimer = setInterval(() => {
      const cwd = this.getWorkspaceRoot();

      if (!cwd) return;

      void this.checkRemoteAndRefresh(cwd);
    }, 60 * 1000);
  }

  private async checkRemoteAndRefresh(cwd: string) {
    if (!this._panel) return;
    if (this._isRemoteChecking) return;

    this._isRemoteChecking = true;

    try {
      const beforeGraphState = this._lastGraphState || await this.getGraphState(cwd);

      try {
        await this.gitService.fetchAllPrune(cwd);
      } catch {
        return;
      }

      const afterGraphState = await this.getGraphState(cwd);

      if (!afterGraphState) return;

      if (!beforeGraphState) {
        this._lastGraphState = afterGraphState;
        return;
      }

      if (beforeGraphState !== afterGraphState) {
        this._lastGraphState = afterGraphState;
        await this.postGraphData(cwd, this._currentGraphFilter, true, false);
      }
    } finally {
      this._isRemoteChecking = false;
    }
  }

  private async getGraphState(cwd: string) {
    try {
      return await this.gitService.getGraphState(cwd);
    } catch {
      return '';
    }
  }

  private async postGraphData(cwd: string, graphFilter: string, silent = false, fetchRemote = false) {
    if (!this._panel) return;

    if (this._isRefreshing) {
      const oldPending = this._pendingRefresh;

      this._pendingRefresh = {
        cwd,
        graphFilter,
        silent: silent && !!oldPending?.silent,
        fetchRemote: fetchRemote || !!oldPending?.fetchRemote,
      };

      return;
    }

    this._isRefreshing = true;
    this._currentGraphFilter = graphFilter || this._currentGraphFilter;

    if (!silent) {
      this._panel.webview.postMessage({
        type: 'gitDetailLoading',
      });
    }

    try {
      const repoStatus = await this.gitService.getRepoStatus(cwd);

      if (!repoStatus.isRepo) {
        this._panel?.webview.postMessage({
          type: 'gitDetailNotRepo',
        });
        return;
      }

      if (fetchRemote && repoStatus.remoteUrl) {
        try {
          await this.gitService.fetchAllPrune(cwd);
        } catch {
          // 远程拉取失败不阻塞本地记录显示
        }
      }

      const graphData = await this.gitService.getGraph(cwd, this._currentGraphFilter);
      const graphState = await this.getGraphState(cwd);

      if (graphState) {
        this._lastGraphState = graphState;
      }

      this._panel?.webview.postMessage({
        type: 'gitDetailGraphData',
        graphCommits: graphData.graphCommits,
        graphFilter: graphData.graphFilter,
        totalCommits: graphData.totalCommits,
        folderName: path.basename(cwd),
        branch: repoStatus.branch,
        remoteUrl: repoStatus.remoteUrl,
      });
    } finally {
      this._isRefreshing = false;

      const pending = this._pendingRefresh;
      this._pendingRefresh = null;

      if (pending) {
        setTimeout(() => {
          void this.postGraphData(
            pending.cwd,
            pending.graphFilter,
            pending.silent,
            pending.fetchRemote,
          );
        }, 0);
      }
    }
  }

  private async changeGraphFilter(cwd: string, current: string) {
    const allOption = '全部分支';

    const quickPick = vscode.window.createQuickPick<vscode.QuickPickItem & { branchName: string }>();

    quickPick.placeholder = '选择要查看的分支记录 (支持搜索)';
    quickPick.matchOnDescription = true;

    const updateQuickPickItems = async () => {
      const branchNames = await this.gitService.getAllBranches(cwd);

      const items = [allOption, ...branchNames].map((b) => ({
        label: b === current ? `$(check) ${b}` : b,
        description: b === current ? '当前选择' : undefined,
        branchName: b,
      }));

      quickPick.items = items;

      const currentItem = items.find((i) => i.branchName === current);

      if (currentItem) {
        quickPick.activeItems = [currentItem];
      }
    };

    await updateQuickPickItems();
    quickPick.show();

    quickPick.busy = true;

    this.gitService
      .fetchAllPrune(cwd)
      .then(updateQuickPickItems)
      .catch(() => {})
      .finally(() => {
        quickPick.busy = false;
      });

    const selectedBranch = await new Promise<string | undefined>((resolve) => {
      quickPick.onDidAccept(() => {
        const selection = quickPick.selectedItems[0];
        resolve(selection ? selection.branchName : undefined);
        quickPick.hide();
      });

      quickPick.onDidHide(() => {
        quickPick.dispose();
        resolve(undefined);
      });
    });

    if (!selectedBranch) return;

    await this.postGraphData(cwd, selectedBranch, false, false);
  }

  private createGitContentUri(cwd: string, ref: string, file: string): vscode.Uri {
    const query = encodeURIComponent(JSON.stringify({ cwd, ref }));
    return vscode.Uri.parse(`quickops-git:///${file}?${query}`);
  }

  private async postCommitFiles(cwd: string, hash: string) {
    if (!hash) return;

    const result = await this.gitService.getCommitFiles(cwd, hash);

    this._panel?.webview.postMessage({
      type: 'gitDetailCommitFilesData',
      hash: result.hash || hash,
      parentHash: result.parentHash,
      files: result.files || [],
    });
  }

  private async openCommitFileDiff(
    cwd: string,
    hash: string,
    parentHash: string | undefined,
    file: string,
    status: string,
  ) {
    if (!hash || !file) return;

    let leftRef = parentHash || 'empty';
    let rightRef = hash;

    if (status === 'A') {
      leftRef = 'empty';
    }

    if (status === 'D') {
      rightRef = 'empty';
    }

    const leftUri = this.createGitContentUri(cwd, leftRef, file);
    const rightUri = this.createGitContentUri(cwd, rightRef, file);
    const title = `${path.basename(file)} (${hash.substring(0, 7)})`;

    await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title);
  }

  private async openCommitMultiDiff(cwd: string, hash: string) {
    if (!hash) return;

    const result = await this.gitService.getCommitFiles(cwd, hash);
    const parentHash = result.parentHash;

    if (result.files.length === 0) return;

    const changesArgs = result.files.map((f) => {
      let leftRef = parentHash || 'empty';
      let rightRef = hash;

      if (f.status === 'A') leftRef = 'empty';
      if (f.status === 'D') rightRef = 'empty';

      const leftUri = this.createGitContentUri(cwd, leftRef, f.file);
      const rightUri = this.createGitContentUri(cwd, rightRef, f.file);
      const fileUri = vscode.Uri.file(path.join(cwd, f.file));

      return [fileUri, leftUri, rightUri];
    });

    const title = `Commit: ${hash.substring(0, 7)}`;

    await vscode.commands.executeCommand('vscode.changes', title, changesArgs);
  }
}

export default GitDetailWebviewPanel;