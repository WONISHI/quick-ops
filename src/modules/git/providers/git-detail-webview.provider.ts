import * as vscode from 'vscode';
import * as path from 'path';
import { execFile } from 'child_process';
import WebviewWorkflow from '@/workflow/webview';
import ReactWebviewHtmlWorkflow from '@/workflow/react-webview-html';
import { ExtensionContextProvider } from '@common/providers/extension-context.provider';
import { GitService } from '@modules/git/git.service';
import { GIT_WEBVIEW_ROUTES } from '@/modules/git/constants/git.constant';
import type { WebviewEnhancerOptions } from '@plugins/webview-enhancer/type';
import type { GitGraphLikeCommit, GitGraphLikeData, RefreshOptions } from '@modules/git/git.type';

export class GitDetailWebviewProvider {
  public static inject = [ExtensionContextProvider, GitService];
  private _panel?: vscode.WebviewPanel;

  private readonly _extensionUri: vscode.Uri;
  private readonly webviewWorkflow = new WebviewWorkflow();
  private readonly reactWebviewHtmlWorkflow = new ReactWebviewHtmlWorkflow();

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

  private readonly projectFaviconFileNames = ['favicon.ico', 'favicon.icon', 'favicon.png', 'favicon.svg', 'favicon.jpeg', 'favicon.jpg'];

  constructor(
    extensionContextProvider: ExtensionContextProvider,
    private readonly gitService: GitService,
  ) {
    this._extensionUri = extensionContextProvider.getContext().extensionUri;
  }

  private getWorkspaceRoot(): string | undefined {
    return this.gitService.getCurrentWorkingDir() || undefined;
  }

  private async getProjectFaviconUri(cwd: string): Promise<string> {
    if (!this._panel) return '';

    for (const fileName of this.projectFaviconFileNames) {
      const faviconUri = vscode.Uri.file(path.join(cwd, 'public', fileName));

      try {
        const stat = await vscode.workspace.fs.stat(faviconUri);

        if (stat.type === vscode.FileType.File) {
          return this._panel.webview.asWebviewUri(faviconUri).toString();
        }
      } catch {
        // 当前项目没有这个 favicon 文件时继续查找其他后缀。
      }
    }

    return '';
  }

  public async open(_workingDir?: string): Promise<void> {
    if (this._panel) {
      this._panel.reveal(vscode.ViewColumn.Active);

      const cwd = this.getWorkspaceRoot();

      if (cwd) {
        void this.postGraphData(cwd, this._currentGraphFilter, false, false);
      }

      return;
    }

    const currentCwdForResources = this.getWorkspaceRoot();
    const workspaceResourceRoots = vscode.workspace.workspaceFolders?.map((folder) => folder.uri) || [];

    this._panel = await this.webviewWorkflow.createWebview<any, WebviewEnhancerOptions>({
      key: 'quickOps.gitDetail',
      viewType: 'quickOps.gitDetail',
      title: 'Git 提交详情',
      column: vscode.ViewColumn.Active,
      extensionUri: this._extensionUri,
      icon: 'resources/icons/git.svg',
      options: {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [...workspaceResourceRoots, ...(currentCwdForResources ? [vscode.Uri.file(currentCwdForResources)] : []), this._extensionUri],
      },
      htmlFactory: async (webview) => {
        return this.reactWebviewHtmlWorkflow.createReactWebviewHtml({
          extensionUri: this._extensionUri,
          webview,
          routeName: GIT_WEBVIEW_ROUTES.detail,
        });
      },
      onDidReceiveMessage: async (msg) => {
        try {
          const command = msg.command || msg.type;

          if (command === 'openExternal') {
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

          switch (command) {
            case 'gitDetailLoaded':
            case 'refreshGitDetail': {
              await this.postGraphData(cwd, msg.graphFilter || this._currentGraphFilter, false, false);
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
      },
      onDidDispose: () => {
        this.disposeListeners();
        this._panel = undefined;
        this._lastGraphState = '';
        this._currentGraphFilter = '全部分支';
      },
    });

    void this.setupGitWatcher();

    const cwd = this.getWorkspaceRoot();

    if (cwd) {
      setTimeout(() => {
        void this.postGraphData(cwd, this._currentGraphFilter, false, false);
      }, 300);
    } else {
      setTimeout(() => {
        this._panel?.webview.postMessage({
          type: 'gitDetailNoWorkspace',
        });
      }, 300);
    }
  }

  public refresh(graphFilter = this._currentGraphFilter, options: RefreshOptions = {}): void {
    const cwd = this.getWorkspaceRoot();

    if (!cwd) return;

    void this.postGraphData(cwd, graphFilter || this._currentGraphFilter, options.silent ?? true, options.fetchRemote ?? false);
  }

  public dispose(): void {
    this.disposeListeners();
    this._panel?.dispose();
    this._panel = undefined;
    this._lastGraphState = '';
    this._currentGraphFilter = '全部分支';
    this._pendingRefresh = null;
    this._isRefreshing = false;
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

  private async getCommitChangeStats(cwd: string, hash: string): Promise<{ filesChanged: number; insertions: number; deletions: number }> {
    if (!hash || hash === '__WORKING_TREE__') {
      return {
        filesChanged: 0,
        insertions: 0,
        deletions: 0,
      };
    }

    const output = await this.runGitSafe(cwd, ['show', '--numstat', '--format=', '--find-renames', hash]);
    let filesChanged = 0;
    let insertions = 0;
    let deletions = 0;

    output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line) => {
        const parts = line.split(/\s+/);

        if (parts.length < 3) return;

        filesChanged += 1;

        const added = Number(parts[0]);
        const removed = Number(parts[1]);

        if (Number.isFinite(added)) {
          insertions += added;
        }

        if (Number.isFinite(removed)) {
          deletions += removed;
        }
      });

    return {
      filesChanged,
      insertions,
      deletions,
    };
  }

  private normalizeRefName(ref: string) {
    return ref
      .replace(/^refs\/heads\//, '')
      .replace(/^refs\/remotes\//, '')
      .replace(/^remotes\//, '')
      .replace(/^refs\/tags\//, '')
      .trim();
  }

  private normalizeGraphFilterName(graphFilter: string) {
    const value = (graphFilter || this.gitService.CURRENT_BRANCH_FILTER).trim();

    if (!value || value === '全部分支') {
      return '全部分支';
    }

    if (value === this.gitService.CURRENT_BRANCH_FILTER || value === '当前分支') {
      return this.gitService.CURRENT_BRANCH_FILTER;
    }

    return this.normalizeRefName(value);
  }

  private normalizeBranchOptionName(branchName: string) {
    return this.normalizeRefName(branchName);
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
    const output = await this.runGitSafe(cwd, ['status', '--porcelain=v1', '-uall']);

    return output.split(/\r?\n/).filter((line) => line.trim()).length;
  }

  private async getStashRows(cwd: string): Promise<GitGraphLikeCommit[]> {
    const stashListOutput = await this.runGitSafe(cwd, ['stash', 'list', '--format=%gd%x1f%H%x1f%ct%x1f%gs']);

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
    return Array.from(new Set(stashRows.map((stashRow) => stashRow.parents?.[0]).filter(Boolean) as string[]));
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

    const commonArgs = ['log', '--date-order', '--decorate=full', '--parents', `--pretty=${pretty}`];

    const normalizedGraphFilter = this.normalizeGraphFilterName(graphFilter);

    if (normalizedGraphFilter === '全部分支') {
      return [...commonArgs, '--branches', '--remotes', '--tags', ...extraRefs];
    }

    if (!normalizedGraphFilter || normalizedGraphFilter === '当前分支') {
      return [...commonArgs, 'HEAD', ...extraRefs];
    }

    return [...commonArgs, normalizedGraphFilter, ...extraRefs];
  }

  private insertSpecialRows(commits: GitGraphLikeCommit[], stashRows: GitGraphLikeCommit[], uncommittedRow: GitGraphLikeCommit | null) {
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
    const normalizedGraphFilter = this.normalizeGraphFilterName(graphFilter);
    const allStashRows = await this.getStashRows(cwd);

    const extraRefs = normalizedGraphFilter === '全部分支' ? this.getStashBaseParentHashes(allStashRows) : [];

    const output = await this.runGit(cwd, this.getGraphArgs(normalizedGraphFilter, extraRefs));

    const commits = output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => this.parseLogLine(line))
      .filter(Boolean) as GitGraphLikeCommit[];

    const commitHashSet = new Set(commits.map((commit) => commit.hash));

    const visibleStashRows =
      normalizedGraphFilter === '全部分支'
        ? allStashRows
        : allStashRows.filter((stashRow) => {
            const stashBaseParent = stashRow.parents?.[0];

            return !!stashBaseParent && commitHashSet.has(stashBaseParent);
          });

    const uncommittedRow = await this.getUncommittedRow(cwd);
    const rows = this.insertSpecialRows(commits, visibleStashRows, uncommittedRow);

    const uniqueRows: GitGraphLikeCommit[] = [];
    const seenKey = new Set<string>();

    rows.forEach((row) => {
      const uniqueKey = row.type === 'uncommitted' ? row.hash : `${row.type || 'commit'}:${row.hash}`;

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
      const stateOutput = await this.runGitSafe(cwd, ['show-ref', '--head', '--dereference']);

      const statusOutput = await this.runGitSafe(cwd, ['status', '--porcelain=v1']);

      const stashOutput = await this.runGitSafe(cwd, ['stash', 'list', '--format=%gd %H']);

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
        silent: silent || this._isRefreshing,
        fetchRemote,
      };

      return;
    }

    this._isRefreshing = true;
    this._currentGraphFilter = this.normalizeGraphFilterName(graphFilter || this._currentGraphFilter);

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
      const projectFaviconUri = await this.getProjectFaviconUri(cwd);

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
        projectFaviconUri,
      });
    } catch (error: any) {
      this._panel?.webview.postMessage({
        type: 'gitDetailError',
        message: error?.message ?? String(error),
      });
    } finally {
      this._isRefreshing = false;

      const pending = this._pendingRefresh;
      this._pendingRefresh = null;

      if (pending) {
        setTimeout(() => {
          void this.postGraphData(pending.cwd, pending.graphFilter, pending.silent, pending.fetchRemote);
        }, 0);
      }
    }
  }

  private async changeGraphFilter(cwd: string, current: string) {
    type GraphFilterQuickPickItem = vscode.QuickPickItem & {
      branchName?: string;
      branchType?: 'local' | 'remote';
    };

    interface BranchPickerMeta {
      author: string;
      shortHash: string;
      subject: string;
      timestamp: number;
      relativeTime: string;
    }

    const formatBranchRelativeTime = (timestamp: number) => {
      if (!timestamp) return '';

      const diffSeconds = Math.max(0, Math.floor((Date.now() - timestamp * 1000) / 1000));
      const minute = 60;
      const hour = minute * 60;
      const day = hour * 24;
      const month = day * 30;
      const year = day * 365;

      if (diffSeconds >= year) return `${Math.floor(diffSeconds / year)} 年前`;
      if (diffSeconds >= month) return `${Math.floor(diffSeconds / month)} 个月前`;
      if (diffSeconds >= day) return `${Math.floor(diffSeconds / day)} 天前`;
      if (diffSeconds >= hour) return `${Math.floor(diffSeconds / hour)} 小时前`;
      if (diffSeconds >= minute) return `${Math.floor(diffSeconds / minute)} 分钟前`;

      return '刚刚';
    };

    const getBranchPickerMetaMap = async () => {
      const metaMap = new Map<string, BranchPickerMeta>();
      const output = await this.runGitSafe(cwd, [
        'for-each-ref',
        '--format=%(refname:short)%x1f%(objectname:short)%x1f%(committerdate:unix)%x1f%(authorname)%x1f%(contents:subject)',
        'refs/heads',
        'refs/remotes',
      ]);

      output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .forEach((line) => {
          const [rawRefName, shortHash, timestampText, author, ...subjectParts] = line.split('\x1f');
          const branchName = this.normalizeBranchOptionName(rawRefName || '');

          if (!branchName || branchName.includes('HEAD ->') || /\/HEAD$/i.test(branchName)) {
            return;
          }

          const timestamp = Number(timestampText) || 0;

          metaMap.set(branchName, {
            author: author || '未知作者',
            shortHash: shortHash || '',
            subject: subjectParts.join('\x1f') || '',
            timestamp,
            relativeTime: formatBranchRelativeTime(timestamp),
          });
        });

      return metaMap;
    };

    const createBranchQuickPickItem = (
      branchName: string,
      branchType: 'local' | 'remote',
      options: {
        currentFilter: string;
        currentBranch: string;
        localBranchSet: Set<string>;
        metaMap: Map<string, BranchPickerMeta>;
      },
    ): GraphFilterQuickPickItem => {
      const isCurrentBranch = branchType === 'local' && branchName === options.currentBranch;
      const isCurrentFilter =
        options.currentFilter === this.gitService.CURRENT_BRANCH_FILTER ? isCurrentBranch : this.normalizeBranchOptionName(branchName) === options.currentFilter;

      const meta = options.metaMap.get(branchName);
      const localName = branchType === 'remote' ? this.gitService.getLocalNameFromRemoteBranch(branchName) : '';
      const remoteDescription = branchType === 'remote' && options.localBranchSet.has(localName) ? `本地已存在：${localName}` : undefined;

      return {
        iconPath: new vscode.ThemeIcon(branchType === 'remote' ? 'cloud' : 'git-branch'),
        label: branchName,
        description: meta?.relativeTime || (isCurrentBranch ? '当前分支' : remoteDescription),
        detail: meta ? `${meta.author} • ${meta.shortHash} • ${meta.subject || '无提交信息'}` : remoteDescription,
        branchName,
        branchType,
      };
    };

    const quickPick = vscode.window.createQuickPick<GraphFilterQuickPickItem>();

    quickPick.title = '筛选分支';
    quickPick.placeholder = '选择要查看的分支记录 (支持搜索)';
    quickPick.matchOnDescription = true;
    quickPick.matchOnDetail = true;
    quickPick.ignoreFocusOut = true;

    const currentFilter = this.normalizeGraphFilterName(String(current || this._currentGraphFilter || ''));

    const createItems = async (options: { fetchRemote?: boolean } = {}) => {
      const localResult = await this.gitService.getLocalBranches(cwd);
      const remoteBranches = await this.gitService.getRemoteBranches(cwd, {
        fetch: !!options.fetchRemote,
      });

      const currentBranch = localResult.current;
      const localBranchSet = new Set(localResult.branches);
      const metaMap = await getBranchPickerMetaMap();

      const itemOptions = {
        currentFilter,
        currentBranch,
        localBranchSet,
        metaMap,
      };

      const localItems: GraphFilterQuickPickItem[] = localResult.branches.map((branchName) => {
        return createBranchQuickPickItem(branchName, 'local', itemOptions);
      });

      const remoteItems: GraphFilterQuickPickItem[] = remoteBranches.map((branchName) => {
        return createBranchQuickPickItem(branchName, 'remote', itemOptions);
      });

      const items: GraphFilterQuickPickItem[] = [
        {
          iconPath: new vscode.ThemeIcon('list-tree'),
          label: '全部分支',
          description: '显示所有分支记录',
          branchName: '全部分支',
        },
        {
          label: '分支',
          kind: vscode.QuickPickItemKind.Separator,
        },
        ...localItems,
        {
          label: '远程分支',
          kind: vscode.QuickPickItemKind.Separator,
        },
        ...remoteItems,
      ];

      return {
        items,
        localItems,
        remoteItems,
        currentBranch,
      };
    };

    const updateQuickPickItems = async (options: { fetchRemote?: boolean } = {}) => {
      const prevActiveBranchName = quickPick.activeItems.find((item) => item.branchName)?.branchName;
      const result = await createItems(options);

      quickPick.items = result.items;

      if (prevActiveBranchName) {
        const newActive = result.items.find((item) => item.branchName === prevActiveBranchName);

        if (newActive) {
          quickPick.activeItems = [newActive];
          return;
        }
      }

      if (currentFilter === '全部分支') {
        const allItem = result.items.find((item) => item.branchName === '全部分支');
        if (allItem) {
          quickPick.activeItems = [allItem];
          return;
        }
      }

      const currentLocalItem = result.localItems.find((item) => item.branchName === result.currentBranch);

      if (currentLocalItem) {
        quickPick.activeItems = [currentLocalItem];
        return;
      }

      const firstBranchItem = result.localItems[0] || result.remoteItems[0];

      if (firstBranchItem) {
        quickPick.activeItems = [firstBranchItem];
      }
    };

    await updateQuickPickItems();
    quickPick.show();

    quickPick.busy = true;

    this.gitService
      .fetchAllPrune(cwd)
      .then(() => updateQuickPickItems({ fetchRemote: true }))
      .catch(() => {})
      .finally(() => {
        quickPick.busy = false;
      });

    const selectedBranch = await new Promise<string | undefined>((resolve) => {
      let accepted = false;

      quickPick.onDidAccept(() => {
        const selection = quickPick.selectedItems.find((item) => item.branchName);

        if (!selection?.branchName) {
          return;
        }

        accepted = true;
        resolve(selection.branchName);
        quickPick.hide();
      });

      quickPick.onDidHide(() => {
        if (!accepted) {
          resolve(undefined);
        }

        quickPick.dispose();
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
        filesChanged: 0,
        insertions: 0,
        deletions: 0,
      });
      return;
    }

    const result = await this.gitService.getCommitFiles(cwd, hash);
    const stats = await this.getCommitChangeStats(cwd, hash);

    this._panel?.webview.postMessage({
      type: 'gitDetailCommitFilesData',
      hash: result.hash || hash,
      parentHash: result.parentHash,
      files: result.files || [],
      ...stats,
    });
  }

  private async openCommitFileDiff(cwd: string, hash: string, parentHash: string | undefined, file: string, status: string) {
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
