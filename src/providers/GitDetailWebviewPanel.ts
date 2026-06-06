import * as vscode from 'vscode';
import * as path from 'path';
import { execFile } from 'child_process';
import { getReactWebviewHtml } from '../utils/WebviewHelper';
import GitService from '../services/GitService';

interface GitGraphLikeCommit {
  hash: string;
  parents?: string[];
  author: string;
  email?: string;
  message: string;
  timestamp?: number;
  refs?: string;
  type?: 'commit' | 'uncommitted' | 'stash';
}

interface GitGraphLikeData {
  graphCommits: GitGraphLikeCommit[];
  graphFilter: string;
  totalCommits: number;
}

interface RefreshOptions {
  silent?: boolean;
  fetchRemote?: boolean;
}

export class GitDetailWebviewPanel {
  private _panel?: vscode.WebviewPanel;
  private readonly gitService = new GitService();

  private _currentGraphFilter = '全部分支';
  private _lastGraphState = '';
  private _refreshTimer: NodeJS.Timeout | null = null;
  private _disposables: vscode.Disposable[] = [];
  private _isRefreshing = false;
  private _pendingRefresh: {
    cwd: string;
    graphFilter: string;
    silent: boolean;
    fetchRemote: boolean;
  } | null = null;

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

  public refresh(graphFilter = this._currentGraphFilter, options: RefreshOptions = {}) {
    const cwd = this.getWorkspaceRoot();

    if (!cwd) return;

    void this.postGraphData(
      cwd,
      graphFilter || this._currentGraphFilter,
      options.silent ?? true,
      options.fetchRemote ?? false,
    );
  }

  private disposeListeners() {
    this._disposables.forEach((item) => item.dispose());
    this._disposables = [];

    if (this._refreshTimer) {
      clearTimeout(this._refreshTimer);
      this._refreshTimer = null;
    }
  }

  private scheduleRefresh(cwd: string, fetchRemote = false) {
    if (!this._panel) return;

    if (this._refreshTimer) {
      clearTimeout(this._refreshTimer);
    }

    this._refreshTimer = setTimeout(() => {
      this._refreshTimer = null;
      void this.refreshIfGraphChanged(cwd, true, fetchRemote);
    }, 600);
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

      this.scheduleRefresh(cwd, false);
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

      this.scheduleRefresh(cwd, false);
    });

    this._disposables.push(focusDisposable);
  }

  private runGit(cwd: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(
        'git',
        ['-C', cwd, ...args],
        {
          encoding: 'utf8',
          maxBuffer: 1024 * 1024 * 30,
        },
        (error, stdout, stderr) => {
          if (error) {
            reject(new Error(String(stderr || error.message || error)));
            return;
          }

          resolve(String(stdout || ''));
        },
      );
    });
  }

  private async runGitSafe(cwd: string, args: string[]) {
    try {
      return await this.runGit(cwd, args);
    } catch {
      return '';
    }
  }

  private normalizeRefName(ref: string) {
    return ref
      .replace(/^refs\/heads\//, '')
      .replace(/^refs\/remotes\//, '')
      .replace(/^refs\/tags\//, '')
      .trim();
  }

  private cleanDecorateRef(ref: string) {
    return ref
      .replace(/^tag:\s*/i, '')
      .replace(/^HEAD\s*->\s*/i, 'HEAD -> ')
      .trim();
  }

  private normalizeDecorateRefs(refsText: string) {
    if (!refsText) return '';

    return refsText
      .split(',')
      .map((item) => this.cleanDecorateRef(item.trim()))
      .filter(Boolean)
      .filter((item) => item !== 'refs/stash')
      .filter((item) => item !== 'stash')
      .map((item) => {
        if (item.startsWith('HEAD -> ')) {
          const branch = item.replace(/^HEAD\s*->\s*/, '').trim();

          return `HEAD -> ${this.normalizeRefName(branch)}`;
        }

        return this.normalizeRefName(item);
      })
      .filter(Boolean)
      .join(', ');
  }

  private parseLogLine(line: string): GitGraphLikeCommit | null {
    const parts = line.split('\x1f');

    if (parts.length < 7) return null;

    const hash = parts[0];
    const parentsText = parts[1] || '';
    const timestampText = parts[2] || '';
    const author = parts[3] || '';
    const email = parts[4] || '';
    const refsText = parts[5] || '';
    const message = parts.slice(6).join('\x1f') || '';

    if (!hash) return null;

    return {
      type: 'commit',
      hash,
      parents: parentsText
        .split(' ')
        .map((item) => item.trim())
        .filter(Boolean),
      author,
      email,
      timestamp: Number(timestampText) * 1000,
      refs: this.normalizeDecorateRefs(refsText),
      message,
    };
  }

  private async getHeadHash(cwd: string) {
    return (await this.runGitSafe(cwd, ['rev-parse', 'HEAD'])).trim();
  }

  private async getWorkingTreeChangeCount(cwd: string) {
    const output = await this.runGitSafe(cwd, ['status', '--porcelain=v1']);

    return output
      .split(/\r?\n/)
      .filter((line) => line.trim()).length;
  }

  private async getStashRows(cwd: string): Promise<GitGraphLikeCommit[]> {
    const stashListOutput = await this.runGitSafe(cwd, [
      'stash',
      'list',
      '--format=%gd%x1f%H%x1f%ct%x1f%gs',
    ]);

    const stashLines = stashListOutput
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const rows: GitGraphLikeCommit[] = [];

    for (const line of stashLines) {
      const [stashName, stashHash, timestampText, ...messageParts] = line.split('\x1f');

      if (!stashName || !stashHash) continue;

      const parentsOutput = await this.runGitSafe(cwd, ['show', '-s', '--format=%P', stashHash]);

      /**
       * Git stash commit usually has multiple parents:
       * 1. base commit
       * 2. index commit
       * 3. optional untracked commit
       *
       * Git Graph only uses the base commit to connect the visible stash row.
       * If all stash parents are used here, the index/untracked parent creates the long extra
       * vertical lines seen in the graph.
       */
      const baseParent = parentsOutput
        .split(/\s+/)
        .map((item) => item.trim())
        .filter(Boolean)[0];

      const message = messageParts.join('\x1f') || stashName;

      rows.push({
        type: 'stash',
        hash: stashHash,
        parents: baseParent ? [baseParent] : [],
        author: '',
        email: '',
        timestamp: Number(timestampText) * 1000,
        refs: stashName,
        message,
      });
    }

    return rows;
  }

  private getStashBaseParentHashes(stashRows: GitGraphLikeCommit[]) {
    return Array.from(
      new Set(
        stashRows
          .map((stashRow) => stashRow.parents?.[0])
          .filter(Boolean) as string[],
      ),
    );
  }

  private async getUncommittedRow(cwd: string): Promise<GitGraphLikeCommit | null> {
    const changeCount = await this.getWorkingTreeChangeCount(cwd);

    if (changeCount <= 0) return null;

    const headHash = await this.getHeadHash(cwd);

    if (!headHash) return null;

    return {
      type: 'uncommitted',
      hash: '__WORKING_TREE__',
      parents: [headHash],
      author: '*',
      email: '',
      timestamp: Date.now(),
      refs: '',
      message: `Uncommitted Changes (${changeCount})`,
    };
  }

  private getGraphArgs(graphFilter: string, extraRefs: string[] = []) {
    const pretty = '%H%x1f%P%x1f%ct%x1f%an%x1f%ae%x1f%D%x1f%s';

    const commonArgs = [
      'log',
      '--date-order',
      '--decorate=full',
      '--parents',
      `--pretty=${pretty}`,
    ];

    if (graphFilter === '全部分支') {
      return [
        ...commonArgs,
        '--branches',
        '--remotes',
        '--tags',
        ...extraRefs,
      ];
    }

    if (!graphFilter || graphFilter === '当前分支') {
      return [
        ...commonArgs,
        'HEAD',
        ...extraRefs,
      ];
    }

    return [
      ...commonArgs,
      graphFilter,
      ...extraRefs,
    ];
  }

  private insertSpecialRows(
    commits: GitGraphLikeCommit[],
    stashRows: GitGraphLikeCommit[],
    uncommittedRow: GitGraphLikeCommit | null,
  ) {
    const result: GitGraphLikeCommit[] = [];
    const insertedStashIndexes = new Set<number>();

    if (uncommittedRow) {
      result.push(uncommittedRow);
    }

    commits.forEach((commit) => {
      stashRows.forEach((stashRow, stashIndex) => {
        if (insertedStashIndexes.has(stashIndex)) return;

        const stashBaseParent = stashRow.parents?.[0];

        if (stashBaseParent && stashBaseParent === commit.hash) {
          result.push(stashRow);
          insertedStashIndexes.add(stashIndex);
        }
      });

      result.push(commit);
    });

    stashRows.forEach((stashRow, stashIndex) => {
      if (insertedStashIndexes.has(stashIndex)) return;

      result.splice(uncommittedRow ? 1 : 0, 0, stashRow);
      insertedStashIndexes.add(stashIndex);
    });

    return result;
  }

  private async getGitGraphLikeData(cwd: string, graphFilter: string): Promise<GitGraphLikeData> {
    const normalizedGraphFilter = graphFilter || '全部分支';

    const stashRows = await this.getStashRows(cwd);
    const stashBaseParentHashes = this.getStashBaseParentHashes(stashRows);

    const output = await this.runGit(
      cwd,
      this.getGraphArgs(normalizedGraphFilter, stashBaseParentHashes),
    );

    const commits = output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => this.parseLogLine(line))
      .filter(Boolean) as GitGraphLikeCommit[];

    const uncommittedRow = await this.getUncommittedRow(cwd);

    const rows = this.insertSpecialRows(commits, stashRows, uncommittedRow);

    const uniqueRows: GitGraphLikeCommit[] = [];
    const seenKey = new Set<string>();

    rows.forEach((row) => {
      const uniqueKey =
        row.type === 'uncommitted'
          ? row.hash
          : `${row.type || 'commit'}:${row.hash}`;

      if (seenKey.has(uniqueKey)) return;

      seenKey.add(uniqueKey);
      uniqueRows.push(row);
    });

    return {
      graphCommits: uniqueRows,
      graphFilter: normalizedGraphFilter,
      totalCommits: uniqueRows.length,
    };
  }

  private async getGraphState(cwd: string) {
    try {
      const stateOutput = await this.runGitSafe(cwd, [
        'show-ref',
        '--head',
        '--dereference',
      ]);

      const statusOutput = await this.runGitSafe(cwd, [
        'status',
        '--porcelain=v1',
      ]);

      const stashOutput = await this.runGitSafe(cwd, [
        'stash',
        'list',
        '--format=%gd %H',
      ]);

      return `${stateOutput}\n---STATUS---\n${statusOutput}\n---STASH---\n${stashOutput}`;
    } catch {
      return '';
    }
  }

  private async refreshIfGraphChanged(cwd: string, silent = true, fetchRemote = false) {
    if (!this._panel) return;

    if (fetchRemote) {
      try {
        await this.gitService.fetchAllPrune(cwd);
      } catch {
        // fetch 失败不阻塞本地刷新判断
      }
    }

    const nextGraphState = await this.getGraphState(cwd);

    if (!nextGraphState) return;

    if (this._lastGraphState && nextGraphState === this._lastGraphState) {
      return;
    }

    this._lastGraphState = nextGraphState;

    await this.postGraphData(cwd, this._currentGraphFilter, silent, false);
  }

  private async postGraphData(cwd: string, graphFilter: string, silent = false, fetchRemote = false) {
    if (!this._panel) return;

    if (this._isRefreshing) {
      this._pendingRefresh = {
        cwd,
        graphFilter,
        silent,
        fetchRemote,
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
      const isRepo = await this.gitService.checkIsRepo(cwd);

      if (!isRepo) {
        this._panel?.webview.postMessage({
          type: 'gitDetailNotRepo',
        });
        return;
      }

      if (fetchRemote) {
        try {
          await this.gitService.fetchAllPrune(cwd);
        } catch {
          // 远程拉取失败不影响本地记录显示
        }
      }

      const repoStatus = await this.gitService.getRepoStatus(cwd);
      const graphData = await this.getGitGraphLikeData(cwd, this._currentGraphFilter);
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

    if (hash === '__WORKING_TREE__') {
      this._panel?.webview.postMessage({
        type: 'gitDetailCommitFilesData',
        hash,
        parentHash: 'HEAD',
        files: [],
      });
      return;
    }

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

    if (hash === '__WORKING_TREE__') {
      const leftUri = this.createGitContentUri(cwd, parentHash || 'HEAD', file);
      const rightUri = vscode.Uri.file(path.join(cwd, file));
      const title = `${path.basename(file)} (Working Tree)`;

      await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title);
      return;
    }

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

    if (hash === '__WORKING_TREE__') {
      vscode.window.showInformationMessage('未提交更改请在 Git 管理器的“更改”区域打开。');
      return;
    }

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
