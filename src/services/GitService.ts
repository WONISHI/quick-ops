import * as vscode from 'vscode';
import simpleGit, { SimpleGit } from 'simple-git';
import { execFile } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

export interface GitFileItem {
  status: string;
  file: string;
  baseRef?: string;
}

export interface GitStashItem {
  index: number;
  message: string;
}

export interface RemoteSyncState {
  hasRemote: boolean;
  hasUpstream: boolean;
  branch: string;
  upstream: string;
  ahead: number;
  behind: number;
  needsPull: boolean;
  needsPush: boolean;
  checkedAt: number;
  error?: string;
}

export interface GitRepoStatus {
  isRepo: boolean;
  branch: string;
  remoteUrl: string;
  folderName: string;
  stagedFiles: GitFileItem[];
  unstagedFiles: GitFileItem[];
  conflictedFiles: GitFileItem[];
  stashes: GitStashItem[];
  remoteSync: RemoteSyncState;
}

export interface GitGraphCommit {
  hash: string;
  parents: string[];
  author: string;
  email?: string;
  message: string;
  refs?: string;
  timestamp: number;
}

export interface GitGraphResult {
  graphCommits: GitGraphCommit[];
  graphFilter: string;
  totalCommits: number;
}

export interface CommitFilesResult {
  hash: string;
  parentHash?: string;
  files: GitFileItem[];
}

export interface StashFilesResult {
  index: number;
  hash: string;
  parentHash: string;
  files: GitFileItem[];
}

export interface PushInfo {
  currentBranch: string;
  hasUpstream: boolean;
}

export class GitService {
  public readonly CURRENT_BRANCH_FILTER = '当前分支';
  public readonly ALL_BRANCH_FILTER = '全部分支';

  private createGit(cwd?: string): SimpleGit {
    return cwd ? simpleGit(cwd) : simpleGit();
  }

  /**
   * @description 判断当前目录本身是否存在 Git 元数据
   *
   * 说明：
   * - 这里只检查 cwd/.git。
   * - 不向父级目录查找 .git。
   * - 用来避免工作区目录没有初始化 Git，但父级目录是 Git 仓库时，被误识别为 Git 仓库。
   */
  public hasLocalGitMetadata(cwd: string): boolean {
    if (!cwd) return false;

    const gitMetadataPath = path.join(cwd, '.git');

    try {
      const stat = fs.statSync(gitMetadataPath);

      return stat.isDirectory() || stat.isFile();
    } catch {
      return false;
    }
  }

  public checkGitInstalled(): Promise<boolean> {
    return new Promise((resolve) => {
      execFile('git', ['--version'], (error) => {
        resolve(!error);
      });
    });
  }

  /**
   * @description 判断当前目录是否是 Git 仓库
   *
   * 注意：
   * - simple-git / git 默认会向父级目录查找 .git。
   * - 这里先要求当前 cwd 自己必须存在 .git。
   * - 如果当前目录没有 .git，即使父级目录是 Git 仓库，也返回 false。
   */
  public async checkIsRepo(cwd: string): Promise<boolean> {
    if (!this.hasLocalGitMetadata(cwd)) {
      return false;
    }

    try {
      return await this.createGit(cwd).checkIsRepo();
    } catch {
      return false;
    }
  }

  public async getRemoteUrl(cwd: string): Promise<string> {
    return this.createGit(cwd)
      .listRemote(['--get-url'])
      .then((r) => r.trim())
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
      hasRemote: !!remoteUrl,
      hasUpstream: !!upstream,
      branch,
      upstream,
      ahead,
      behind,
      needsPull: behind > 0,
      needsPush: ahead > 0,
      checkedAt: Date.now(),
    };
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

  public async getRemoteSync(cwd: string, options?: { fetch?: boolean }): Promise<RemoteSyncState> {
    const git = this.createGit(cwd);

    try {
      const isRepo = await this.checkIsRepo(cwd);

      if (!isRepo) {
        return this.createEmptyRemoteSync();
      }

      let remoteUrl = await this.getRemoteUrl(cwd);

      if (!remoteUrl) {
        return this.createEmptyRemoteSync();
      }

      if (options?.fetch) {
        await this.fetchPruneSafe(cwd);
      }

      const branch = await git
        .branchLocal()
        .then((b) => b.current)
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

    const isRepo = await this.checkIsRepo(cwd);

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
      .then((b) => b.current)
      .catch(() => 'HEAD');

    const remoteUrlPromise = this.getRemoteUrl(cwd);
    const statusPromise = git.status();

    const stashPromise = git.stashList().catch(() => ({
      all: [],
    }));

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
          status: 'C',
          file: file.path,
        });
        return;
      }

      if (file.index !== ' ' && file.index !== '?') {
        stagedFiles.push({
          status: file.index,
          file: file.path,
        });
      }

      if (file.working_dir !== ' ') {
        let s = file.working_dir;

        if (s === '?') {
          s = 'U';
        }

        unstagedFiles.push({
          status: s,
          file: file.path,
        });
      }
    });

    const stashes = stashRaw.all.map((s: any, idx: number) => ({
      index: idx,
      message: s.message,
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

  public async getGraphState(cwd: string): Promise<string> {
    const git = this.createGit(cwd);

    /**
     * 不要把 refs/remotes/* 放进图谱状态。
     * push / fetch 会更新远程引用，但不会改变本地提交图谱。
     * 如果这里使用 show-ref 全量输出，push 后会误触发完整 graph 刷新。
     */
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

    const graphCommits: GitGraphCommit[] = logRaw.all.map((c: any) => ({
      hash: c.hash,
      parents: c.parents ? String(c.parents).split(' ').filter(Boolean) : [],
      author: c.author,
      email: c.email,
      message: c.message,
      refs: c.refs || '',
      timestamp: parseInt(String(c.timestamp), 10) * 1000,
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
    } catch {
      // ignore
    }

    return {
      graphCommits,
      graphFilter,
      totalCommits,
    };
  }

  public async getLocalBranches(cwd: string): Promise<{ branches: string[]; current: string }> {
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

    /**
     * origin/feature/a => feature/a
     * upstream/main => main
     */
    return normalized.replace(/^[^/]+\//, '');
  }

  public async getRemoteBranches(cwd: string, options?: { fetch?: boolean }): Promise<string[]> {
    const git = this.createGit(cwd);

    if (options?.fetch) {
      await this.fetchAllPrune(cwd);
    }

    const summary = await git.branch(['-r']);

    return summary.all
      .map((branchName) => this.normalizeRemoteBranchName(branchName))
      .filter((branchName) => {
        return !!branchName && !/\/HEAD\s*->/i.test(branchName) && !branchName.includes('HEAD ->');
      })
      .sort((a, b) => a.localeCompare(b));
  }

  public async checkoutRemoteBranch(cwd: string, remoteBranchName: string): Promise<string> {
    const git = this.createGit(cwd);
    const normalizedRemoteBranch = this.normalizeRemoteBranchName(remoteBranchName);
    const localBranchName = this.getLocalNameFromRemoteBranch(normalizedRemoteBranch);

    const localBranches = await this.getLocalBranches(cwd);

    if (localBranches.branches.includes(localBranchName)) {
      await this.checkoutBranch(cwd, localBranchName);
      return localBranchName;
    }

    await git.checkout(['--track', normalizedRemoteBranch]);

    return localBranchName;
  }

  public async getAllBranches(cwd: string): Promise<string[]> {
    const branches = await this.createGit(cwd).branch(['-a']);

    return branches.all.filter((b) => !b.includes('->'));
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

  public async checkoutBranch(cwd: string, branchName: string): Promise<void> {
    await this.createGit(cwd).checkout(branchName);
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

    return status.files
      .filter((file) => file.index !== ' ' && file.index !== '?')
      .map((file) => ({
        status: file.index,
        file: file.path,
      }));
  }

  public async getWorkingTreeChangeFiles(cwd: string): Promise<GitFileItem[]> {
    const status = await this.createGit(cwd).status();

    return status.files
      .filter((file) => file.working_dir !== ' ')
      .filter((file) => !status.conflicted.includes(file.path))
      .map((file) => {
        let s = file.working_dir;

        if (s === '?') {
          s = 'U';
        }

        const hasIndexVersion = file.index !== ' ' && file.index !== '?';

        return {
          status: s,
          file: file.path,
          baseRef: hasIndexVersion ? 'index' : undefined,
        };
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

  public async getStashFiles(cwd: string, index: number): Promise<StashFilesResult> {
    const git = this.createGit(cwd);
    const stashHash = `stash@{${index}}`;
    const parentHash = `${stashHash}^1`;

    const diffRaw = await git.raw(['-c', 'core.quotepath=false', 'diff', '--name-status', parentHash, stashHash]);
    const files = this.parseNameStatus(diffRaw);

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

    return logRaw.all.map((c: any) => ({
      hash: c.hash,
      parents: [],
      author: c.author,
      message: c.message,
      timestamp: parseInt(String(c.timestamp), 10) * 1000,
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

    return logResult.all.map((c: any) => ({
      hash: c.hash,
      parents: [],
      author: c.author,
      message: c.message,
      timestamp: parseInt(String(c.timestamp), 10) * 1000,
    }));
  }

  public async getDiffFilesBetweenBranches(cwd: string, baseBranch: string, targetBranch: string): Promise<GitFileItem[]> {
    const diffRaw = await this.createGit(cwd).raw(['-c', 'core.quotepath=false', 'diff', '--name-status', baseBranch, targetBranch]);

    return this.parseNameStatus(diffRaw);
  }

  public async getCommitFiles(cwd: string, hash: string): Promise<CommitFilesResult> {
    const git = this.createGit(cwd);

    if (hash === '__WORKING_TREE__') {
      const status = await git.status();

      const files: GitFileItem[] = status.files
        .filter((file) => !status.conflicted.includes(file.path))
        .map((file) => {
          let fileStatus = file.working_dir !== ' ' ? file.working_dir : file.index;

          if (fileStatus === '?') {
            fileStatus = 'U';
          }

          return {
            status: fileStatus,
            file: file.path,
            baseRef: file.index !== ' ' && file.index !== '?' ? 'index' : 'HEAD',
          };
        })
        .filter((file) => file.status && file.status !== ' ');

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
    const files = this.parseNameStatus(diffRaw);

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

    for (const f of status.files) {
      const wDir = f.working_dir;

      if (wDir === ' ' || wDir === '') continue;

      if (wDir === 'D') {
        filesToDelete.push(f.path);
      } else if (wDir === '?' || wDir === 'U') {
        filesToAdd.push(f.path);
      } else {
        const diff = await git.diff(['--', f.path]);

        if (!diff.trim()) {
          await git.checkout(['--', f.path]);
        } else {
          filesToAdd.push(f.path);
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

  public async stageFile(cwd: string, file: string, status: string): Promise<'staged' | 'discarded-empty-change'> {
    const git = this.createGit(cwd);

    if (status === 'D') {
      await git.rm([file]);
      return 'staged';
    }

    if (status === '?' || status === 'U' || status === 'C') {
      await git.add([file]);
      return 'staged';
    }

    const diff = await git.diff(['--', file]);

    if (!diff.trim()) {
      await git.checkout(['--', file]);
      return 'discarded-empty-change';
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

  public async unstageFile(cwd: string, file: string): Promise<void> {
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

  public async discardFile(cwd: string, file: string, status: string): Promise<void> {
    if (status === 'U') {
      try {
        await vscode.workspace.fs.delete(vscode.Uri.file(path.join(cwd, file)), {
          recursive: true,
          useTrash: false,
        });
      } catch {
        // ignore
      }

      return;
    }

    await this.createGit(cwd).checkout(['--', file]);
  }

  /**
   * 给资源管理器右键菜单使用的单文件取消变更。
   *
   * 注意：不要改动上面的 discardFile。Git 视图里已经有一套针对工作区/暂存区的处理逻辑，
   * 其它地方也在调用 discardFile。这里单独新增方法，避免影响 Git 视图已有行为。
   */
  public async discardRecentProjectFile(cwd: string, file: string, status: string): Promise<void> {
    const git = this.createGit(cwd);
    const rawStatus = String(status || '').trim();
    const cleanStatus = rawStatus.replace(/[\[\]]/g, '').trim();
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
    } catch {
      // 兼容旧 Git 版本：restore 不可用时退回 reset + checkout。
    }

    await git.reset(['HEAD', '--', file]).catch(() => undefined);
    await git.checkout(['--', file]);
  }

  public async commit(cwd: string, message: string, skipVerify: boolean): Promise<void> {
    const git = this.createGit(cwd);
    const status = await git.status();

    const hasStaged = status.files.some((f) => f.index !== ' ' && f.index !== '?');

    if (!hasStaged) {
      await git.add(['-A']);
    }

    const options: any = {};

    if (skipVerify) {
      options['--no-verify'] = null;
    }

    await git.commit(message, options);
  }

  public async pull(cwd: string): Promise<void> {
    await this.createGit(cwd).pull();
  }

  public async getPushInfo(cwd: string): Promise<PushInfo> {
    const git = this.createGit(cwd);
    const status = await git.status();
    const branchSummary = await git.branchLocal();

    return {
      currentBranch: branchSummary.current,
      hasUpstream: !!status.tracking,
    };
  }

  public async push(cwd: string, options?: { createUpstream?: boolean; branch?: string }): Promise<void> {
    const git = this.createGit(cwd);

    if (options?.createUpstream && options.branch) {
      await git.push(['-u', 'origin', options.branch]);
      return;
    }

    await git.push();
  }

  public async addToGitignore(cwd: string, file: string): Promise<void> {
    const gitignorePath = path.join(cwd, '.gitignore');
    const gitignoreUri = vscode.Uri.file(gitignorePath);

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

  private parseNameStatus(diffRaw: string): GitFileItem[] {
    return diffRaw
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => {
        const parts = line.split('\t');

        return {
          status: parts[0].charAt(0),
          file: parts[parts.length - 1],
        };
      });
  }
}

export default GitService;
