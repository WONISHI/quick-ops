import * as vscode from 'vscode';
import * as path from 'path';
import { execFile } from 'child_process';
import simpleGit, { CheckRepoActions, SimpleGit, StatusResult } from 'simple-git';
import { ExtensionContextProvider } from '../../common/providers/extension-context.provider';
import { GIT_STATE_KEYS } from './git.constant';
import { createGitVirtualContentUri } from './git-uri.util';
import type {
  GitBranchInfo,
  GitCloneOptions,
  GitCommitItem,
  GitDetailSummary,
  GitDiffTarget,
  GitFileItem,
  GitFileStatusType,
  GitGraphCommit,
  GitGraphResult,
  GitOpenFileOptions,
  GitRemoteInfo,
  GitRepoStatus,
  GitStashItem,
  GitStatusSummary,
  GitUserInfo,
  GitWorkspacePreviewState,
  RemoteSyncState,
} from './git.type';

export class GitService {
  public static inject = [ExtensionContextProvider];

  public readonly CURRENT_BRANCH_FILTER = '当前分支';
  public readonly ALL_BRANCH_FILTER = '全部分支';

  private syncDepth = 0;
  private currentPreviewPath: string | undefined;

  constructor(private readonly extensionContextProvider: ExtensionContextProvider) {}

  public dispose(): void {
    this.currentPreviewPath = undefined;
  }

  public createGit(cwd?: string): SimpleGit {
    return cwd ? simpleGit(cwd) : simpleGit();
  }

  public getCurrentWorkingDir(): string {
    if (this.currentPreviewPath) return this.currentPreviewPath;

    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
  }

  public async setCurrentPreviewPath(newPath: string | undefined): Promise<void> {
    this.currentPreviewPath = newPath;

    const hasRemote = newPath ? await this.hasRemote(newPath) : false;
    const defaultWorkspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const isPreviewingOther = Boolean(newPath) && newPath !== defaultWorkspace;

    await vscode.commands.executeCommand('setContext', 'quickOps.hasGitRemote', hasRemote);

    await vscode.commands.executeCommand('setContext', 'quickOps.isPreviewingOther', isPreviewingOther);
  }

  public getWorkspacePreviewState(): GitWorkspacePreviewState {
    const defaultWorkspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const currentPreviewPath = this.currentPreviewPath || defaultWorkspacePath;

    return {
      currentPreviewPath,
      defaultWorkspacePath,
      isPreviewingOther: Boolean(currentPreviewPath) && Boolean(defaultWorkspacePath) && currentPreviewPath !== defaultWorkspacePath,
      hasRemote: false,
    };
  }

  public checkGitInstalled(): Promise<boolean> {
    return new Promise((resolve) => {
      execFile('git', ['--version'], (error) => {
        resolve(!error);
      });
    });
  }

  public async initializeConfigSync(): Promise<void> {
    const isInstalled = await this.checkGitInstalled();

    if (!isInstalled) return;

    await this.syncGitToExtensionConfig();
  }

  public async handleConfigurationChange(event: vscode.ConfigurationChangeEvent): Promise<void> {
    if (this.syncDepth > 0) return;

    if (!event.affectsConfiguration('quick-ops.git.userName') && !event.affectsConfiguration('quick-ops.git.userEmail')) {
      return;
    }

    const isGitReady = await this.checkGitInstalled();

    if (!isGitReady) return;

    try {
      await this.syncExtensionConfigToGit();
    } catch (error) {
      vscode.window.showErrorMessage(`同步 Git 配置失败: ${this.toErrorMessage(error)}`);
    }
  }

  public async checkIsRepo(cwd: string): Promise<boolean> {
    try {
      return await this.createGit(cwd).checkIsRepo();
    } catch {
      return false;
    }
  }

  public async getRemoteUrl(cwd: string): Promise<string> {
    return this.createGit(cwd)
      .listRemote(['--get-url'])
      .then((result) => result.trim())
      .catch(() => '');
  }

  public createEmptyRemoteSync(branch = ''): RemoteSyncState {
    return {
      hasRemote: false,
      hasUpstream: false,
      branch,
      upstream: '',
      ahead: 0,
      behind: 0,
      needsPull: false,
      needsPush: false,
      checkedAt: Date.now(),
    };
  }

  public createRemoteSync(status: any, branch: string, remoteUrl: string): RemoteSyncState {
    const ahead = Number(status?.ahead || 0);
    const behind = Number(status?.behind || 0);
    const upstream = status?.tracking || '';

    return {
      hasRemote: Boolean(remoteUrl),
      hasUpstream: Boolean(upstream),
      branch,
      upstream,
      ahead,
      behind,
      needsPull: behind > 0,
      needsPush: ahead > 0,
      checkedAt: Date.now(),
    };
  }

  public async getRemoteSync(
    cwd: string,
    options?: {
      fetch?: boolean;
    },
  ): Promise<RemoteSyncState> {
    const git = this.createGit(cwd);

    try {
      const isRepo = await git.checkIsRepo();

      if (!isRepo) return this.createEmptyRemoteSync();

      let remoteUrl = await this.getRemoteUrl(cwd);

      if (!remoteUrl) return this.createEmptyRemoteSync();

      if (options?.fetch) {
        await this.fetchPruneSafe(cwd);
      }

      const branch = await git
        .branchLocal()
        .then((branchSummary) => branchSummary.current)
        .catch(() => 'HEAD');

      remoteUrl = await this.getRemoteUrl(cwd);

      const status = await git.status();

      return this.createRemoteSync(status, branch, remoteUrl);
    } catch (error: any) {
      return {
        hasRemote: true,
        hasUpstream: false,
        branch: '',
        upstream: '',
        ahead: 0,
        behind: 0,
        needsPull: false,
        needsPush: false,
        checkedAt: Date.now(),
        error: error?.message || String(error),
      };
    }
  }

  public async getRepoStatus(cwd: string): Promise<GitRepoStatus> {
    const git = this.createGit(cwd);
    const isRepo = await git.checkIsRepo().catch(() => false);

    if (!isRepo) {
      return {
        isRepo: false,
        branch: '',
        remoteUrl: '',
        folderName: path.basename(cwd),
        stagedFiles: [],
        unstagedFiles: [],
        conflictedFiles: [],
        stashes: [],
        remoteSync: this.createEmptyRemoteSync(),
      };
    }

    const branchPromise = git
      .branchLocal()
      .then((branchSummary) => branchSummary.current)
      .catch(() => 'HEAD');

    const remoteUrlPromise = this.getRemoteUrl(cwd);
    const statusPromise = git.status();
    const stashPromise = git.stashList().catch(() => ({ all: [] }));

    const branch = await branchPromise;
    const remoteUrl = await remoteUrlPromise;
    const status = await statusPromise;
    const stashRaw = await stashPromise;

    const conflictedFiles: GitFileItem[] = [];
    const stagedFiles: GitFileItem[] = [];
    const unstagedFiles: GitFileItem[] = [];

    status.files.forEach((file) => {
      if (status.conflicted.includes(file.path)) {
        conflictedFiles.push({
          status: 'conflicted',
          path: file.path,
          file: file.path,
          absolutePath: path.join(cwd, file.path),
          workingDir: cwd,
        });

        return;
      }

      if (file.index !== ' ' && file.index !== '?') {
        stagedFiles.push({
          status: this.resolveFileStatus(file.index, ' '),
          path: file.path,
          file: file.path,
          absolutePath: path.join(cwd, file.path),
          workingDir: cwd,
          indexStatus: file.index,
        });
      }

      if (file.working_dir !== ' ') {
        const workingStatus = file.working_dir === '?' ? 'U' : file.working_dir;

        unstagedFiles.push({
          status: this.resolveFileStatus(' ', workingStatus),
          path: file.path,
          file: file.path,
          absolutePath: path.join(cwd, file.path),
          workingDir: cwd,
          workingTreeStatus: workingStatus,
          baseRef: file.index !== ' ' && file.index !== '?' ? 'index' : undefined,
        });
      }
    });

    const stashes: GitStashItem[] = stashRaw.all.map((stash: any, index: number) => ({
      index,
      message: stash.message,
    }));

    const remoteSync = remoteUrl ? this.createRemoteSync(status, branch, remoteUrl) : this.createEmptyRemoteSync(branch);

    return {
      isRepo: true,
      branch,
      remoteUrl,
      folderName: path.basename(cwd),
      stagedFiles,
      unstagedFiles,
      conflictedFiles,
      stashes,
      remoteSync,
    };
  }

  public async getStatus(workingDir = this.getCurrentWorkingDir()): Promise<GitStatusSummary> {
    if (!workingDir) {
      return this.createEmptyStatus('');
    }

    const git = this.createGit(workingDir);

    let isRepo = false;

    try {
      isRepo = await git.checkIsRepo(CheckRepoActions.IS_REPO_ROOT);
    } catch {
      isRepo = false;
    }

    if (!isRepo) {
      try {
        isRepo = await git.checkIsRepo();
      } catch {
        isRepo = false;
      }
    }

    if (!isRepo) {
      return this.createEmptyStatus(workingDir);
    }

    let status: StatusResult;

    try {
      status = await git.status();
    } catch {
      return this.createEmptyStatus(workingDir);
    }

    const remotes = await this.getRemotes(workingDir);
    const files = this.normalizeStatusFiles(status, workingDir);

    return {
      isRepo: true,
      workingDir,
      currentBranch: status.current || '',
      tracking: status.tracking || '',
      ahead: status.ahead || 0,
      behind: status.behind || 0,
      files,
      staged: files.filter((file) => this.isStaged(file)),
      unstaged: files.filter((file) => !this.isStaged(file)),
      conflicted: files.filter((file) => file.status === 'conflicted'),
      remotes,
      hasRemote: remotes.length > 0,
    };
  }

  public async getBranches(workingDir = this.getCurrentWorkingDir()): Promise<GitBranchInfo> {
    if (!workingDir) {
      return {
        current: '',
        all: [],
        local: [],
        remote: [],
      };
    }

    try {
      const branchSummary = await this.createGit(workingDir).branch(['-a']);
      const all = branchSummary.all || [];

      return {
        current: branchSummary.current || '',
        all,
        local: all.filter((item) => !item.startsWith('remotes/')),
        remote: all.filter((item) => item.startsWith('remotes/')),
      };
    } catch {
      return {
        current: '',
        all: [],
        local: [],
        remote: [],
      };
    }
  }

  public async getLogs(workingDir = this.getCurrentWorkingDir(), maxCount = 50): Promise<GitCommitItem[]> {
    if (!workingDir) return [];

    try {
      const log = await this.createGit(workingDir).log({
        maxCount,
      });

      return log.all.map((item: any) => this.normalizeLogItem(item));
    } catch {
      return [];
    }
  }

  public async getDetailSummary(workingDir = this.getCurrentWorkingDir()): Promise<GitDetailSummary> {
    const [status, branches, logs] = await Promise.all([this.getStatus(workingDir), this.getBranches(workingDir), this.getLogs(workingDir)]);

    return {
      status,
      branches,
      logs,
    };
  }

  public async getRemotes(workingDir = this.getCurrentWorkingDir()): Promise<GitRemoteInfo[]> {
    if (!workingDir) return [];

    try {
      const remotes = await this.createGit(workingDir).getRemotes(true);

      return remotes.map((remote) => ({
        name: remote.name,
        refs: {
          fetch: remote.refs.fetch,
          push: remote.refs.push,
        },
      }));
    } catch {
      return [];
    }
  }

  public async hasRemote(workingDir = this.getCurrentWorkingDir()): Promise<boolean> {
    const remotes = await this.getRemotes(workingDir);

    return remotes.length > 0;
  }

  public async getGlobalGitUser(): Promise<GitUserInfo> {
    const git = this.createGit();

    let name = '';
    let email = '';

    try {
      name = (await git.raw(['config', '--global', 'user.name'])).trim();
    } catch {}

    try {
      email = (await git.raw(['config', '--global', 'user.email'])).trim();
    } catch {}

    return {
      name,
      email,
    };
  }

  public async getGraphState(cwd: string): Promise<string> {
    const git = this.createGit(cwd);

    const refs = await git.raw(['for-each-ref', '--format=%(refname) %(objectname)', 'HEAD', 'refs/heads', 'refs/tags', 'refs/stash']).catch(() => '');

    const status = await git.raw(['status', '--porcelain=v1', '-uall']).catch(() => '');

    const stash = await git.raw(['stash', 'list', '--format=%gd %H']).catch(() => '');

    return `${refs}\n---STATUS---\n${status}\n---STASH---\n${stash}`;
  }

  public async getGraph(cwd: string, graphFilter = this.CURRENT_BRANCH_FILTER): Promise<GitGraphResult> {
    const git = this.createGit(cwd);
    const isCurrentBranch = graphFilter === this.CURRENT_BRANCH_FILTER;
    const isAllBranches = graphFilter === this.ALL_BRANCH_FILTER;
    const targetRef = isCurrentBranch ? 'HEAD' : graphFilter;

    const logOptions: any = {
      '--topo-order': null,
      format: {
        hash: '%H',
        parents: '%P',
        author: '%an',
        email: '%ae',
        message: '%s',
        timestamp: '%ct',
        refs: '%D',
      },
      maxCount: 5000,
    };

    if (isAllBranches) {
      logOptions['--all'] = null;
    } else {
      logOptions[targetRef] = null;
    }

    const logRaw = await git.log(logOptions);

    const graphCommits: GitGraphCommit[] = logRaw.all.map((commit: any) => ({
      hash: commit.hash,
      parents: commit.parents ? String(commit.parents).split(' ').filter(Boolean) : [],
      author: commit.author,
      email: commit.email,
      message: commit.message,
      refs: commit.refs || '',
      timestamp: parseInt(String(commit.timestamp), 10) * 1000,
    }));

    let totalCommits = graphCommits.length;

    try {
      const countArgs = ['rev-list', '--count'];

      if (isAllBranches) {
        countArgs.push('--all');
      } else {
        countArgs.push(targetRef);
      }

      const countStr = await git.raw(countArgs);

      totalCommits = parseInt(countStr.trim(), 10) || graphCommits.length;
    } catch {}

    return {
      graphCommits,
      graphFilter,
      totalCommits,
    };
  }

  public async getLocalBranches(cwd: string): Promise<{
    branches: string[];
    current: string;
  }> {
    const summary = await this.createGit(cwd).branchLocal();

    return {
      branches: summary.all,
      current: summary.current,
    };
  }

  public normalizeRemoteBranchName(branchName: string): string {
    return branchName.trim().replace(/^remotes\//, '');
  }

  public getLocalNameFromRemoteBranch(remoteBranchName: string): string {
    const normalized = this.normalizeRemoteBranchName(remoteBranchName);

    return normalized.replace(/^[^/]+\//, '');
  }

  public async getRemoteBranches(
    cwd: string,
    options?: {
      fetch?: boolean;
    },
  ): Promise<string[]> {
    const git = this.createGit(cwd);

    if (options?.fetch) {
      await this.fetchAllPrune(cwd);
    }

    const summary = await git.branch(['-r']);

    return summary.all
      .map((branchName) => this.normalizeRemoteBranchName(branchName))
      .filter((branchName) => {
        return Boolean(branchName) && !/\/HEAD\s*->/i.test(branchName) && !branchName.includes('HEAD ->');
      })
      .sort((a, b) => a.localeCompare(b));
  }

  public async checkoutRemoteBranch(cwd: string, remoteBranchName: string): Promise<string> {
    const git = this.createGit(cwd);
    const normalizedRemoteBranch = this.normalizeRemoteBranchName(remoteBranchName);
    const localBranchName = this.getLocalNameFromRemoteBranch(normalizedRemoteBranch);
    const localBranches = await this.getLocalBranches(cwd);

    if (localBranches.branches.includes(localBranchName)) {
      await this.checkoutBranch(localBranchName, cwd);
      return localBranchName;
    }

    await git.checkout(['--track', normalizedRemoteBranch]);

    return localBranchName;
  }

  public async getAllBranches(cwd: string): Promise<string[]> {
    const branches = await this.createGit(cwd).branch(['-a']);

    return branches.all.filter((branch) => !branch.includes('->'));
  }

  public async fetchAllPrune(cwd: string): Promise<void> {
    await this.createGit(cwd).fetch(['--all', '--prune']);
  }

  public async fetchPrune(cwd: string): Promise<void> {
    await this.createGit(cwd).fetch(['--prune']);
  }

  public async createBranch(cwd: string, branchName: string): Promise<void> {
    await this.createGit(cwd).checkoutLocalBranch(branchName);
  }

  public async checkoutBranch(branchOrCwd: string, workingDirOrBranch?: string): Promise<void> {
    const { cwd, value: branchName } = this.resolveCwdValueArgs(branchOrCwd, workingDirOrBranch);

    if (!branchName) return;

    await this.createGit(cwd).checkout(branchName.replace(/^remotes\//, ''));
  }

  public async mergeBranch(cwd: string, branchName: string): Promise<void> {
    await this.createGit(cwd).merge([branchName]);
  }

  public async pushBranchToOrigin(cwd: string, branchName: string): Promise<void> {
    await this.createGit(cwd).push(['-u', 'origin', branchName]);
  }

  public async deleteRemoteBranch(cwd: string, branchName: string): Promise<void> {
    await this.createGit(cwd).push(['origin', '--delete', branchName]);
  }

  public async getStagedChangeFiles(cwd: string): Promise<GitFileItem[]> {
    const status = await this.createGit(cwd).status();

    return status.files.filter((file) => file.index !== ' ' && file.index !== '?').map((file) => this.createFileItem(cwd, file.path, file.index, file.index, ' '));
  }

  public async getWorkingTreeChangeFiles(cwd: string): Promise<GitFileItem[]> {
    const status = await this.createGit(cwd).status();

    return status.files
      .filter((file) => file.working_dir !== ' ')
      .filter((file) => !status.conflicted.includes(file.path))
      .map((file) => {
        const workingStatus = file.working_dir === '?' ? 'U' : file.working_dir;
        const hasIndexVersion = file.index !== ' ' && file.index !== '?';

        return this.createFileItem(cwd, file.path, workingStatus, file.index, workingStatus, hasIndexVersion ? 'index' : undefined);
      });
  }

  public async stashPush(cwd: string, message?: string): Promise<void> {
    const git = this.createGit(cwd);

    if (message) {
      await git.stash(['push', '-m', message]);
    } else {
      await git.stash(['push']);
    }
  }

  public async getStashFiles(
    cwd: string,
    index: number,
  ): Promise<{
    index: number;
    hash: string;
    parentHash: string;
    files: GitFileItem[];
  }> {
    const git = this.createGit(cwd);
    const stashHash = `stash@{${index}}`;
    const parentHash = `${stashHash}^1`;
    const diffRaw = await git.raw(['-c', 'core.quotepath=false', 'diff', '--name-status', parentHash, stashHash]);

    const files = this.parseNameStatus(cwd, diffRaw);

    return {
      index,
      hash: stashHash,
      parentHash,
      files,
    };
  }

  public async stashApply(cwd: string, index: number): Promise<void> {
    await this.createGit(cwd).stash(['apply', `stash@{${index}}`]);
  }

  public async stashPop(cwd: string, index: number): Promise<void> {
    await this.createGit(cwd).stash(['pop', `stash@{${index}}`]);
  }

  public async stashDrop(cwd: string, index: number): Promise<void> {
    await this.createGit(cwd).stash(['drop', `stash@{${index}}`]);
  }

  public async undoLastCommit(cwd: string): Promise<void> {
    await this.createGit(cwd).reset(['--mixed', 'HEAD~1']);
  }

  public async getFileHistory(cwd: string, file: string): Promise<GitGraphCommit[]> {
    const logRaw = await this.createGit(cwd).log({
      '--topo-order': null,
      format: {
        hash: '%H',
        author: '%an',
        message: '%s',
        timestamp: '%ct',
      },
      maxCount: 5000,
      file,
    } as any);

    return logRaw.all.map((commit: any) => ({
      hash: commit.hash,
      parents: [],
      author: commit.author,
      message: commit.message,
      timestamp: parseInt(String(commit.timestamp), 10) * 1000,
    }));
  }

  public async getCompareCommits(cwd: string, baseBranch: string, targetBranch: string): Promise<GitGraphCommit[]> {
    const logResult = await this.createGit(cwd).log({
      from: baseBranch,
      to: targetBranch,
      format: {
        hash: '%H',
        author: '%an',
        message: '%s',
        timestamp: '%ct',
      },
    });

    return logResult.all.map((commit: any) => ({
      hash: commit.hash,
      parents: [],
      author: commit.author,
      message: commit.message,
      timestamp: parseInt(String(commit.timestamp), 10) * 1000,
    }));
  }

  public async getDiffFilesBetweenBranches(cwd: string, baseBranch: string, targetBranch: string): Promise<GitFileItem[]> {
    const diffRaw = await this.createGit(cwd).raw(['-c', 'core.quotepath=false', 'diff', '--name-status', baseBranch, targetBranch]);

    return this.parseNameStatus(cwd, diffRaw);
  }

  public async getCommitFiles(
    cwd: string,
    hash: string,
  ): Promise<{
    hash: string;
    parentHash?: string;
    files: GitFileItem[];
  }> {
    const git = this.createGit(cwd);

    if (hash === '__WORKING_TREE__') {
      const status = await git.status();

      const files = status.files
        .filter((file) => !status.conflicted.includes(file.path))
        .map((file) => {
          let fileStatus = file.working_dir !== ' ' ? file.working_dir : file.index;

          if (fileStatus === '?') {
            fileStatus = 'U';
          }

          return this.createFileItem(cwd, file.path, fileStatus, file.index, file.working_dir, file.index !== ' ' && file.index !== '?' ? 'index' : 'HEAD');
        })
        .filter((file) => file.status && file.status !== 'unknown');

      return {
        hash,
        parentHash: 'HEAD',
        files,
      };
    }

    let parentHash: string | undefined;

    try {
      parentHash = (await git.raw(['rev-parse', `${hash}^1`])).trim();
    } catch {
      parentHash = undefined;
    }

    const diffArgs = parentHash
      ? ['-c', 'core.quotepath=false', 'diff', '--name-status', '--find-renames', parentHash, hash]
      : ['-c', 'core.quotepath=false', 'diff-tree', '--no-commit-id', '--name-status', '-r', '--root', hash];

    const diffRaw = await git.raw(diffArgs);
    const files = this.parseNameStatus(cwd, diffRaw);

    return {
      hash,
      parentHash,
      files,
    };
  }

  public async stageAll(cwd: string): Promise<void> {
    const git = this.createGit(cwd);
    const status = await git.status();
    const filesToAdd: string[] = [];
    const filesToDelete: string[] = [];

    for (const file of status.files) {
      const workingStatus = file.working_dir;

      if (workingStatus === ' ' || workingStatus === '') continue;

      if (workingStatus === 'D') {
        filesToDelete.push(file.path);
      } else if (workingStatus === '?' || workingStatus === 'U') {
        filesToAdd.push(file.path);
      } else {
        const diff = await git.diff(['--', file.path]);

        if (!diff.trim()) {
          await git.checkout(['--', file.path]);
        } else {
          filesToAdd.push(file.path);
        }
      }
    }

    if (filesToAdd.length > 0) {
      await git.add(filesToAdd);
    }

    if (filesToDelete.length > 0) {
      await git.rm(filesToDelete);
    }
  }

  public async stageFile(fileOrCwd: string, workingDirOrFile?: string, status?: string): Promise<'staged' | 'discarded-empty-change' | void> {
    const { cwd, file } = this.resolveCwdFileArgs(fileOrCwd, workingDirOrFile);
    const git = this.createGit(cwd);
    const finalStatus = status || '';

    if (finalStatus === 'D') {
      await git.rm([file]);
      return 'staged';
    }

    if (finalStatus === '?' || finalStatus === 'U' || finalStatus === 'C') {
      await git.add([file]);
      return 'staged';
    }

    if (finalStatus) {
      const diff = await git.diff(['--', file]);

      if (!diff.trim()) {
        await git.checkout(['--', file]);
        return 'discarded-empty-change';
      }
    }

    await git.add([file]);

    return 'staged';
  }

  public async unstageAll(cwd: string): Promise<void> {
    const git = this.createGit(cwd);

    try {
      await git.reset(['HEAD']);
    } catch {
      await git.raw(['rm', '--cached', '-r', '.']);
    }
  }

  public async unstageFile(fileOrCwd: string, workingDirOrFile?: string): Promise<void> {
    const { cwd, file } = this.resolveCwdFileArgs(fileOrCwd, workingDirOrFile);
    const git = this.createGit(cwd);

    try {
      await git.reset(['HEAD', '--', file]);
    } catch {
      await git.raw(['rm', '--cached', '--', file]);
    }
  }

  public async discardAll(cwd: string): Promise<void> {
    const git = this.createGit(cwd);

    await git.checkout(['--', '.']);
    await git.clean('f', ['-d']);
  }

  public async discardFile(fileOrCwd: string, workingDirOrFile?: string, status?: string): Promise<void> {
    const { cwd, file } = this.resolveCwdFileArgs(fileOrCwd, workingDirOrFile);
    const finalStatus = status || '';

    const answer = await vscode.window.showWarningMessage(
      `确认放弃文件变更吗？\n${file}`,
      {
        modal: true,
      },
      '放弃变更',
    );

    if (answer !== '放弃变更') return;

    if (finalStatus === 'U' || finalStatus === '?' || finalStatus === 'A') {
      try {
        await vscode.workspace.fs.delete(vscode.Uri.file(path.join(cwd, file)), {
          recursive: true,
          useTrash: false,
        });
      } catch {}

      return;
    }

    await this.createGit(cwd).checkout(['--', file]);
  }

  public async discardRecentProjectFile(cwd: string, file: string, status: string): Promise<void> {
    const git = this.createGit(cwd);
    const cleanStatus = String(status || '')
      .replace(/[\[\]]/g, '')
      .trim();
    const statusKey = (cleanStatus[0] || '').toUpperCase();
    const fileUri = vscode.Uri.file(path.join(cwd, file));
    const isNewFile = statusKey === 'U' || statusKey === '?' || statusKey === 'A';

    if (isNewFile) {
      await git.raw(['restore', '--staged', '--', file]).catch(() => undefined);
      await git.raw(['reset', '--', file]).catch(() => undefined);

      try {
        await vscode.workspace.fs.delete(fileUri, {
          recursive: true,
          useTrash: true,
        });
      } catch {
        await git.clean('f', ['-d', '--', file]).catch(() => undefined);
      }

      return;
    }

    try {
      await git.raw(['restore', '--staged', '--worktree', '--', file]);
      return;
    } catch {}

    await git.reset(['HEAD', '--', file]).catch(() => undefined);
    await git.checkout(['--', file]);
  }

  public async commit(messageOrCwd: string, workingDirOrMessage?: string, skipVerify = false): Promise<void> {
    const { cwd, value: message } = this.resolveCwdValueArgs(messageOrCwd, workingDirOrMessage);

    const commitMessage = message.trim();

    if (!commitMessage) {
      vscode.window.showWarningMessage('提交信息不能为空');
      return;
    }

    const git = this.createGit(cwd);
    const status = await git.status();
    const hasStaged = status.files.some((file) => file.index !== ' ' && file.index !== '?');

    if (!hasStaged) {
      await git.add(['-A']);
    }

    const options: any = {};

    if (skipVerify) {
      options['--no-verify'] = null;
    }

    await git.commit(commitMessage, options);
  }

  public async pull(cwd = this.getCurrentWorkingDir()): Promise<void> {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Git Pull 中...',
        cancellable: false,
      },
      async () => {
        await this.createGit(cwd).pull();
      },
    );
  }

  public async getPushInfo(cwd: string): Promise<{
    currentBranch: string;
    hasUpstream: boolean;
  }> {
    const git = this.createGit(cwd);
    const status = await git.status();
    const branchSummary = await git.branchLocal();

    return {
      currentBranch: branchSummary.current,
      hasUpstream: Boolean(status.tracking),
    };
  }

  public async push(
    cwd = this.getCurrentWorkingDir(),
    options?: {
      createUpstream?: boolean;
      branch?: string;
    },
  ): Promise<void> {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Git Push 中...',
        cancellable: false,
      },
      async () => {
        const git = this.createGit(cwd);

        if (options?.createUpstream && options.branch) {
          await git.push(['-u', 'origin', options.branch]);
          return;
        }

        await git.push();
      },
    );
  }

  public async fetch(cwd = this.getCurrentWorkingDir()): Promise<void> {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Git Fetch 中...',
        cancellable: false,
      },
      async () => {
        await this.createGit(cwd).fetch();
      },
    );
  }

  public async addToGitignore(cwd: string, file: string): Promise<void> {
    const gitignoreUri = vscode.Uri.file(path.join(cwd, '.gitignore'));

    let existingContent = '';

    try {
      const contentBytes = await vscode.workspace.fs.readFile(gitignoreUri);
      existingContent = Buffer.from(contentBytes).toString('utf8');
    } catch {
      existingContent = '';
    }

    const appendStr = existingContent.length > 0 ? `\n${file}` : file;

    await vscode.workspace.fs.writeFile(gitignoreUri, Buffer.from(existingContent + appendStr, 'utf8'));
  }

  public async getFileContent(cwd: string, ref: string, file: string): Promise<string> {
    try {
      if (ref === 'empty') return '';

      if (ref === 'working') {
        const contentBytes = await vscode.workspace.fs.readFile(vscode.Uri.file(path.join(cwd, file)));

        return Buffer.from(contentBytes).toString('utf8');
      }

      const git = this.createGit(cwd);

      if (ref === 'index') {
        return await git.show([`:${file}`]);
      }

      return await git.show([`${ref}:${file}`]);
    } catch {
      return '';
    }
  }

  public async openFile(options: GitOpenFileOptions): Promise<void> {
    const uri = vscode.Uri.file(path.isAbsolute(options.filePath) ? options.filePath : path.join(options.workingDir, options.filePath));

    const document = await vscode.workspace.openTextDocument(uri);

    await vscode.window.showTextDocument(document, {
      preview: options.preview ?? false,
      viewColumn: options.viewColumn,
    });
  }

  public async openFileDiff(target: GitDiffTarget): Promise<void> {
    const workingDir = target.workingDir || this.getCurrentWorkingDir();
    const relativePath = this.toGitRelativePath(target.filePath, workingDir);
    const currentUri = vscode.Uri.file(path.join(workingDir, relativePath));
    const baseUri = createGitVirtualContentUri({
      cwd: workingDir,
      ref: target.baseRef || 'HEAD',
      file: relativePath,
    });

    await vscode.commands.executeCommand('vscode.diff', baseUri, currentUri, target.title || `${relativePath} ↔ ${target.baseRef || 'HEAD'}`);
  }

  public async openCurrentPreviewProject(): Promise<void> {
    const currentPath = this.currentPreviewPath;

    if (!currentPath) return;

    const projectName = path.basename(currentPath);

    const choice = await vscode.window.showInformationMessage(
      `是否要在编辑器中打开预览的项目 [ ${projectName} ]？`,
      {
        modal: true,
      },
      '在当前窗口打开',
      '在新窗口打开',
    );

    if (choice === '在当前窗口打开') {
      const confirm = await vscode.window.showWarningMessage(
        '确定要在当前窗口打开吗？\n这将会关闭您当前正在工作的工作区！',
        {
          modal: true,
        },
        '确认替换打开',
      );

      if (confirm === '确认替换打开') {
        await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(currentPath), false);
      }

      return;
    }

    if (choice === '在新窗口打开') {
      await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(currentPath), true);
    }
  }

  public async editCurrentRemoteUrl(): Promise<void> {
    const currentPath = this.currentPreviewPath || this.getCurrentWorkingDir();

    if (!currentPath) return;

    const git = this.createGit(currentPath);

    let remotes: GitRemoteInfo[] = [];

    try {
      const isRepo = await git.checkIsRepo();

      if (!isRepo) return;

      remotes = await this.getRemotes(currentPath);
    } catch {
      vscode.window.showErrorMessage('无法读取 Git 配置');
      return;
    }

    if (remotes.length === 0) {
      vscode.window.showInformationMessage('当前项目没有配置任何远程仓库');
      return;
    }

    const targetRemote = remotes.find((remote) => remote.name === 'origin') || remotes[0];
    const currentUrl = targetRemote.refs.push || targetRemote.refs.fetch || '';

    const newUrl = await vscode.window.showInputBox({
      prompt: `修改底层远程仓库 [${targetRemote.name}] 地址`,
      value: currentUrl,
      validateInput: (text) => {
        const value = text.trim();

        if (!value) return '地址不能为空';

        const isValid = /^(https?:\/\/|ssh:\/\/|git@[^:]+:.+)/i.test(value);

        return isValid ? null : '地址格式不正确，必须是有效的 HTTP 或 SSH 格式';
      },
    });

    if (newUrl === undefined) return;

    const trimmedUrl = newUrl.trim();

    if (trimmedUrl === currentUrl) return;

    await git.remote(['set-url', targetRemote.name, trimmedUrl]);

    vscode.window.showInformationMessage(`✅ 已成功将 ${targetRemote.name} 地址修改为: ${trimmedUrl}`);
  }

  public async returnToWorkspace(): Promise<void> {
    const defaultWorkspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    if (!defaultWorkspace) {
      vscode.window.showInformationMessage('当前没有打开任何工作区');
      return;
    }

    const currentFsPath = this.currentPreviewPath || '';

    if (currentFsPath === defaultWorkspace) {
      vscode.window.showInformationMessage('当前已经在默认工作区的 Git 视图中');
      return;
    }

    await this.setCurrentPreviewPath(defaultWorkspace);

    vscode.window.showInformationMessage('已返回当前工作区');
  }

  public async cloneGitProjectByInput(): Promise<void> {
    const isGitReady = await this.checkGitInstalled();

    if (!isGitReady) {
      vscode.window.showErrorMessage('当前环境未检测到 Git，请先安装 Git 后再克隆仓库');
      return;
    }

    const inputUrl = await vscode.window.showInputBox({
      title: '克隆 Git 仓库',
      prompt: '请输入 Git 仓库地址，支持 HTTPS 或 SSH',
      placeHolder: '例如：https://github.com/user/repo.git 或 git@github.com:user/repo.git',
      ignoreFocusOut: true,
      validateInput: (value) => {
        const url = value
          .trim()
          .replace(/^git\s+clone\s+/i, '')
          .trim();

        if (!url) return '仓库地址不能为空';

        const isValid = /^(https?:\/\/|ssh:\/\/|git@[^:]+:.+)/i.test(url);

        return isValid ? null : '请输入有效的 Git HTTPS 或 SSH 地址';
      },
    });

    if (!inputUrl) return;

    const repoUrl = inputUrl
      .trim()
      .replace(/^git\s+clone\s+/i, '')
      .trim();
    const parentPath = await this.pickCloneParentPath();

    if (!parentPath) return;

    const repoName = this.getRepoFolderName(repoUrl);
    const targetPath = path.join(parentPath, repoName);
    const targetExists = await this.pathExists(targetPath);

    let overwrite = false;

    if (targetExists) {
      const confirmOverwrite = await vscode.window.showWarningMessage(
        `当前目录下已存在名为 [ ${repoName} ] 的文件夹。\n是否要删除原有文件夹并覆盖克隆？`,
        {
          modal: true,
        },
        '覆盖克隆',
      );

      if (confirmOverwrite !== '覆盖克隆') return;

      overwrite = true;
    }

    const targetBranch = await this.pickRemoteBranch(repoUrl, repoName);

    await this.cloneGitProject({
      repoUrl,
      parentPath,
      targetBranch,
      overwrite,
    });
  }

  public async cloneGitProject(options: GitCloneOptions): Promise<void> {
    const repoName = this.getRepoFolderName(options.repoUrl);
    const targetPath = path.join(options.parentPath, repoName);

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: options.targetBranch ? `正在克隆 ${repoName} (分支: ${options.targetBranch})...` : `正在克隆 ${repoName}...`,
        cancellable: false,
      },
      async () => {
        if (options.overwrite) {
          await vscode.workspace.fs.delete(vscode.Uri.file(targetPath), {
            recursive: true,
            useTrash: true,
          });
        }

        const cloneOptions = options.targetBranch ? ['-b', options.targetBranch] : [];

        await this.createGit().clone(options.repoUrl, targetPath, cloneOptions);
      },
    );

    const action = await vscode.window.showInformationMessage(`✅ 仓库已成功克隆到：${targetPath}`, '在当前窗口打开', '在新窗口打开');

    if (action === '在新窗口打开') {
      await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(targetPath), true);
      return;
    }

    if (action === '在当前窗口打开') {
      await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(targetPath), false);
    }
  }

  private async pickCloneParentPath(): Promise<string | undefined> {
    const context = this.extensionContextProvider.getContext();
    const lastClonePath = context.globalState.get<string>(GIT_STATE_KEYS.lastClonePath);

    if (lastClonePath) {
      const choice = await vscode.window.showQuickPick(
        [
          {
            label: '$(folder) 存放在上一次目录',
            description: lastClonePath,
            targetPath: lastClonePath,
          },
          {
            label: '$(folder-opened) 选择新的存放目录...',
            description: '',
            targetPath: 'NEW',
          },
        ],
        {
          placeHolder: '请选择克隆存放的目录',
          ignoreFocusOut: true,
        },
      );

      if (!choice) return undefined;

      if (choice.targetPath !== 'NEW') {
        return choice.targetPath;
      }
    }

    const folderUris = await vscode.window.showOpenDialog({
      title: '选择仓库存放文件夹',
      openLabel: '克隆到此文件夹',
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
    });

    if (!folderUris?.[0]) return undefined;

    const parentPath = folderUris[0].fsPath;

    await context.globalState.update(GIT_STATE_KEYS.lastClonePath, parentPath);

    return parentPath;
  }

  private async pickRemoteBranch(repoUrl: string, repoName: string): Promise<string | undefined> {
    let remoteBranches: string[] = [];
    let defaultBranch: string | undefined;

    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: '正在解析远程分支...',
          cancellable: false,
        },
        async () => {
          const output = await this.createGit().listRemote(['--symref', repoUrl]);

          const defaultMatch = output.match(/ref:\s+refs\/heads\/(.+?)\s+HEAD/);

          if (defaultMatch) {
            defaultBranch = defaultMatch[1];
          }

          remoteBranches = output
            .split('\n')
            .map((line) => {
              const match = line.match(/^[0-9a-fA-F]+\s+refs\/heads\/(.+)$/);
              return match ? match[1] : null;
            })
            .filter(Boolean) as string[];

          remoteBranches = [...new Set(remoteBranches)];
        },
      );
    } catch {
      return undefined;
    }

    if (remoteBranches.length === 0) return undefined;
    if (remoteBranches.length === 1) return remoteBranches[0];

    return new Promise((resolve) => {
      const quickPick = vscode.window.createQuickPick();

      quickPick.title = `选择克隆分支 - ${repoName}`;
      quickPick.placeholder = '请选择要克隆的远程分支，取消则使用默认 clone';
      quickPick.ignoreFocusOut = true;

      quickPick.items = remoteBranches.map((branch) => ({
        label: branch,
        description: branch === defaultBranch ? '默认分支' : '',
      }));

      if (defaultBranch) {
        const active = quickPick.items.find((item) => item.label === defaultBranch);

        if (active) {
          quickPick.activeItems = [active];
        }
      }

      quickPick.onDidAccept(() => {
        resolve(quickPick.selectedItems[0]?.label);
        quickPick.hide();
      });

      quickPick.onDidHide(() => {
        quickPick.dispose();
        resolve(undefined);
      });

      quickPick.show();
    });
  }

  private async syncGitToExtensionConfig(): Promise<void> {
    const { name, email } = await this.getGlobalGitUser();
    const config = vscode.workspace.getConfiguration('quick-ops.git');

    await this.runWithSyncLock(async () => {
      const updates: Thenable<void>[] = [];

      if (config.get('userName') !== name) {
        updates.push(config.update('userName', name, vscode.ConfigurationTarget.Global));
      }

      if (config.get('userEmail') !== email) {
        updates.push(config.update('userEmail', email, vscode.ConfigurationTarget.Global));
      }

      await Promise.all(updates);
    });
  }

  private async syncExtensionConfigToGit(): Promise<void> {
    const config = vscode.workspace.getConfiguration('quick-ops.git');
    const newName = config.get<string>('userName') || '';
    const newEmail = config.get<string>('userEmail') || '';
    const { name: oldName, email: oldEmail } = await this.getGlobalGitUser();

    if (newName === oldName && newEmail === oldEmail) return;

    const action = await vscode.window.showInformationMessage(
      `检测到 Git 账号信息更改，是否同步为 Git 全局配置？\n\n[用户名] ${oldName || '未设置'} ➜ ${newName || '未设置'}\n[邮箱] ${oldEmail || '未设置'} ➜ ${newEmail || '未设置'}`,
      {
        modal: true,
      },
      '确认设置为全局',
    );

    if (action !== '确认设置为全局') {
      await this.runWithSyncLock(async () => {
        await config.update('userName', oldName, vscode.ConfigurationTarget.Global);

        await config.update('userEmail', oldEmail, vscode.ConfigurationTarget.Global);
      });

      return;
    }

    const git = this.createGit();

    if (newName !== oldName) {
      if (!newName) {
        await git.raw(['config', '--global', '--unset', 'user.name']).catch(() => {});
      } else {
        await git.raw(['config', '--global', 'user.name', newName]);
      }
    }

    if (newEmail !== oldEmail) {
      if (!newEmail) {
        await git.raw(['config', '--global', '--unset', 'user.email']).catch(() => {});
      } else {
        await git.raw(['config', '--global', 'user.email', newEmail]);
      }
    }

    vscode.window.showInformationMessage('✅ Git 全局用户信息已成功更新！');
  }

  private async runWithSyncLock(task: () => Promise<void>): Promise<void> {
    this.syncDepth++;

    try {
      await task();
    } finally {
      this.syncDepth--;
    }
  }

  private async fetchPruneSafe(cwd: string, timeout = 8000): Promise<void> {
    const git = this.createGit(cwd);

    await Promise.race([
      git.fetch(['--prune']),
      new Promise<void>((resolve) => {
        setTimeout(() => resolve(), timeout);
      }),
    ]);
  }

  private normalizeStatusFiles(status: StatusResult, workingDir: string): GitFileItem[] {
    return status.files.map((file) => {
      return {
        path: file.path,
        file: file.path,
        absolutePath: path.join(workingDir, file.path),
        workingDir,
        status: this.resolveFileStatus(file.index, file.working_dir),
        indexStatus: file.index,
        workingTreeStatus: file.working_dir,
        from: file.from,
      };
    });
  }

  private createFileItem(cwd: string, file: string, rawStatus: string, indexStatus?: string, workingTreeStatus?: string, baseRef?: string): GitFileItem {
    return {
      status: this.resolveFileStatus(indexStatus || rawStatus, workingTreeStatus),
      path: file,
      file,
      absolutePath: path.join(cwd, file),
      workingDir: cwd,
      indexStatus,
      workingTreeStatus,
      baseRef,
    };
  }

  private resolveFileStatus(indexStatus?: string, workingTreeStatus?: string): GitFileStatusType {
    const value = `${indexStatus || ''}${workingTreeStatus || ''}`;

    if (value.includes('U')) return 'conflicted';
    if (value.includes('A')) return 'added';
    if (value.includes('D')) return 'deleted';
    if (value.includes('R')) return 'renamed';
    if (value.includes('C')) return 'copied';
    if (value.includes('?')) return 'untracked';
    if (value.includes('M')) return 'modified';

    return 'unknown';
  }

  private isStaged(file: GitFileItem): boolean {
    return Boolean(file.indexStatus && file.indexStatus !== '?' && file.indexStatus !== ' ');
  }

  private normalizeLogItem(item: any): GitCommitItem {
    return {
      hash: item.hash,
      date: item.date,
      message: item.message,
      authorName: item.author_name || item.author,
      authorEmail: item.author_email || item.email || '',
      refs: item.refs,
    };
  }

  private createEmptyStatus(workingDir: string): GitStatusSummary {
    return {
      isRepo: false,
      workingDir,
      currentBranch: '',
      tracking: '',
      ahead: 0,
      behind: 0,
      files: [],
      staged: [],
      unstaged: [],
      conflicted: [],
      remotes: [],
      hasRemote: false,
    };
  }

  private parseNameStatus(cwd: string, diffRaw: string): GitFileItem[] {
    return diffRaw
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => {
        const parts = line.split('\t');
        const rawStatus = parts[0].charAt(0);
        const file = parts[parts.length - 1];

        return this.createFileItem(cwd, file, rawStatus, rawStatus, ' ');
      });
  }

  private toGitRelativePath(filePath: string, workingDir: string): string {
    if (!filePath) return '';

    if (!path.isAbsolute(filePath)) {
      return filePath.replace(/\\/g, '/');
    }

    return path.relative(workingDir, filePath).replace(/\\/g, '/');
  }

  private resolveCwdFileArgs(
    first: string,
    second?: string,
  ): {
    cwd: string;
    file: string;
  } {
    if (second && path.isAbsolute(first) && !path.isAbsolute(second)) {
      return {
        cwd: first,
        file: second.replace(/\\/g, '/'),
      };
    }

    const cwd = second || this.getCurrentWorkingDir();
    const file = this.toGitRelativePath(first, cwd);

    return {
      cwd,
      file,
    };
  }

  private resolveCwdValueArgs(
    first: string,
    second?: string,
  ): {
    cwd: string;
    value: string;
  } {
    if (second && path.isAbsolute(first) && !path.isAbsolute(second)) {
      return {
        cwd: first,
        value: second,
      };
    }

    if (second && path.isAbsolute(second)) {
      return {
        cwd: second,
        value: first,
      };
    }

    return {
      cwd: this.getCurrentWorkingDir(),
      value: first,
    };
  }

  private getRepoFolderName(repoUrl: string): string {
    const cleanedUrl = repoUrl
      .trim()
      .replace(/\/+$/, '')
      .replace(/\.git$/i, '');

    let rawName = '';

    if (/^git@[^:]+:.+/i.test(cleanedUrl)) {
      rawName = cleanedUrl.substring(cleanedUrl.lastIndexOf(':') + 1);
    } else {
      rawName = cleanedUrl.substring(cleanedUrl.lastIndexOf('/') + 1);
    }

    const folderName = path
      .basename(rawName)
      .replace(/[\\/:*?"<>|]/g, '-')
      .trim();

    return folderName || 'repository';
  }

  private async pathExists(fsPath: string): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(fsPath));
      return true;
    } catch {
      return false;
    }
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
