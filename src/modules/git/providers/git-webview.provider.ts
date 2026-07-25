import * as vscode from 'vscode';
import * as path from 'path';
import { execFile } from 'child_process';
import ReactWebviewHtmlWorkflow from '@/workflow/react-webview-html';
import { ExtensionContextProvider } from '@common/providers/extension-context.provider';
import { GitService } from '@modules/git/git.service';
import { GIT_VIEW_IDS, GIT_WEBVIEW_ROUTES } from '@/modules/git/constants/git.constant';
import type { GitFileItem } from '@modules/git/git.type';

const GLOBAL_STATE_COMMIT_TYPE_ENABLED = 'quickOps.git.commitTypeEnabled';

interface GitGraphLikeCommit {
  hash: string;
  parents?: string[];
  author: string;
  email?: string;
  message: string;
  timestamp?: number;
  refs?: string;
  type?: 'commit' | 'uncommitted' | 'stash';

  /**
   * @description 当前提交是否存在于远程跟踪分支历史中
   */
  isRemote?: boolean;
}

interface GitGraphLikeData {
  graphCommits: GitGraphLikeCommit[];
  graphFilter: string;
  totalCommits: number;
}

export class GitWebviewProvider implements vscode.WebviewViewProvider {
  public static inject = [ExtensionContextProvider, GitService];

  private _view?: vscode.WebviewView;

  private _isInternalOp = false;
  private _internalOpTimer: NodeJS.Timeout | null = null;
  private _gitWatchers: vscode.Disposable[] = [];

  private _isRefreshing = false;
  private _pendingRefresh: { cwd: string; fullRefresh: boolean } | null = null;

  private _debounceTimer: NodeJS.Timeout | null = null;
  private _lastGraphState = '';
  private _customCwd: string | null = null;

  private _isRemoteSyncChecking = false;
  private _pendingRemoteSyncFetch = false;
  private _lastRemoteFetchAt = 0;
  private readonly REMOTE_FETCH_INTERVAL = 60 * 1000;

  /**
   * 记录每个仓库上一次切换前所在的分支。
   *
   * 例如：
   * - 当前在 feature/0.0.1
   * - 切换到 dev
   * - 那么在 dev 点击“合并本地分支”时，默认选中 feature/0.0.1
   */
  private readonly _lastCheckoutSourceBranchByCwd = new Map<string, string>();

  private _currentGraphFilter = '当前分支';

  private readonly _context: vscode.ExtensionContext;
  private readonly _extensionUri: vscode.Uri;
  private readonly reactWebviewHtmlWorkflow = new ReactWebviewHtmlWorkflow();

  constructor(
    extensionContextProvider: ExtensionContextProvider,
    private readonly gitService: GitService,
  ) {
    this._context = extensionContextProvider.getContext();
    this._extensionUri = this._context.extensionUri;
  }

  public async setCustomWorkspace(cwd: string | null): Promise<void> {
    this._customCwd = cwd;
    this._lastRemoteFetchAt = 0;
    this._pendingRemoteSyncFetch = false;

    await this.gitService.setCurrentPreviewPath(cwd || undefined);

    const targetCwd = this.getWorkspaceRoot();

    if (targetCwd) {
      this._currentGraphFilter = this.gitService.CURRENT_BRANCH_FILTER;
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

  public async refresh(fullRefresh = true): Promise<void> {
    const cwd = this.getWorkspaceRoot();

    if (!cwd) {
      this._view?.webview.postMessage({
        type: 'noWorkspace',
      });

      return;
    }

    await this.refreshStatus(cwd, fullRefresh);
  }

  public dispose(): void {
    this._view = undefined;

    this._gitWatchers.forEach((disposable) => {
      disposable.dispose();
    });
    this._gitWatchers = [];

    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }

    if (this._internalOpTimer) {
      clearTimeout(this._internalOpTimer);
      this._internalOpTimer = null;
    }

    this._pendingRefresh = null;
    this._pendingRemoteSyncFetch = false;
    this._lastCheckoutSourceBranchByCwd.clear();
  }

  private getDefaultCommitTypeEnabled(): boolean {
    return this._context.globalState.get<boolean>(GLOBAL_STATE_COMMIT_TYPE_ENABLED, false);
  }

  private async withViewProgress<T>(task: () => Promise<T>): Promise<T> {
    return vscode.window.withProgress(
      {
        location: {
          viewId: GIT_VIEW_IDS.main,
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

    const defaultWorkspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const isCurrentWorkspace = defaultWorkspace && cwd === defaultWorkspace;

    const changesArgs = files.map((f) => {
      const status = f.status.charAt(0);
      const fileUri = vscode.Uri.file(path.join(cwd, f.file));

      let leftRef = mode === 'working' ? f.baseRef || 'HEAD' : 'HEAD';
      let rightRef: string | null = mode === 'staged' ? 'index' : null;

      if ((status === 'A' || status === 'U' || status === '?') && !f.baseRef) {
        leftRef = 'empty';
      }

      if (status === 'D') {
        rightRef = 'empty';
      }

      const leftUri = this.createGitContentUri(cwd, leftRef, f.file);

      let rightUri: vscode.Uri;

      if (mode === 'working') {
        if (rightRef === 'empty') {
          rightUri = this.createGitContentUri(cwd, 'empty', f.file);
        } else {
          rightUri = isCurrentWorkspace ? fileUri : this.createGitContentUri(cwd, 'working', f.file);
        }
      } else {
        rightUri = this.createGitContentUri(cwd, rightRef || 'index', f.file);
      }

      return [fileUri, leftUri, rightUri];
    });

    await vscode.commands.executeCommand('vscode.changes', title, changesArgs);
  }

  private normalizeGitRelativePath(value: string): string {
    return value.replace(/\\/g, '/').replace(/^\/+/, '');
  }

  private getRelativePathFromUri(cwd: string, uri: vscode.Uri | undefined): string | null {
    if (!uri) return null;

    if (uri.scheme === 'quickops-git') {
      return this.normalizeGitRelativePath(uri.path);
    }

    if (uri.scheme === 'file') {
      const relativePath = path.relative(cwd, uri.fsPath);

      if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        return null;
      }

      return this.normalizeGitRelativePath(relativePath);
    }

    return null;
  }

  private collectTabInputUris(input: any): vscode.Uri[] {
    const uris: vscode.Uri[] = [];
    const visited = new Set<any>();

    const collect = (value: any) => {
      if (!value) return;

      if (value instanceof vscode.Uri) {
        uris.push(value);
        return;
      }

      if (typeof value === 'object') {
        if (visited.has(value)) return;
        visited.add(value);
      }

      if (Array.isArray(value)) {
        value.forEach((item) => collect(item));
        return;
      }

      if (typeof value === 'object') {
        collect(value.uri);
        collect(value.original);
        collect(value.modified);
        collect(value.primary);
        collect(value.secondary);
        collect(value.resource);
        collect(value.left);
        collect(value.right);
        collect(value.base);
        collect(value.input);
        collect(value.resources);
      }
    };

    collect(input);

    return uris;
  }

  private async closeWorkingTreeDiffTabs(cwd: string, files?: string[]): Promise<void> {
    const normalizedFiles = files?.map((file) => this.normalizeGitRelativePath(file));
    const closeAllWorkingTreeDiffTabs = !normalizedFiles || normalizedFiles.length === 0;
    const tabsToClose: vscode.Tab[] = [];

    vscode.window.tabGroups.all.forEach((group) => {
      group.tabs.forEach((tab) => {
        const inputUris = this.collectTabInputUris(tab.input);

        if (inputUris.length === 0) return;

        const isWorkingTreeDiff = inputUris.some((uri) => {
          if (uri.scheme !== 'quickops-git') return false;

          try {
            const params = JSON.parse(decodeURIComponent(uri.query || ''));
            return params.cwd === cwd && (params.ref === 'HEAD' || params.ref === 'empty');
          } catch {
            return false;
          }
        });

        if (!isWorkingTreeDiff) return;

        if (closeAllWorkingTreeDiffTabs) {
          tabsToClose.push(tab);
          return;
        }

        const hasDiscardedFile = inputUris.some((uri) => {
          const relativePath = this.getRelativePathFromUri(cwd, uri);
          return !!relativePath && normalizedFiles!.includes(relativePath);
        });

        if (hasDiscardedFile) {
          tabsToClose.push(tab);
        }
      });
    });

    if (tabsToClose.length > 0) {
      await vscode.window.tabGroups.close(tabsToClose, true);
    }
  }

  private async executeGitOperation(operation: () => Promise<void> | void) {
    this._isInternalOp = true;

    if (this._internalOpTimer) {
      clearTimeout(this._internalOpTimer);
    }

    try {
      await this.withViewProgress(async () => {
        await operation();
      });
    } finally {
      this._internalOpTimer = setTimeout(() => {
        this._isInternalOp = false;
      }, 1500);
    }
  }

  private async confirmCheckoutWhenCurrentBranchHasUnpushedCommits(cwd: string, targetBranch: string): Promise<boolean> {
    try {
      const unpushedInfo = await this.gitService.getCurrentBranchUnpushedInfo(cwd);

      if (!unpushedInfo.hasUnpushedCommits) {
        return true;
      }

      const countText = unpushedInfo.unpushedCommitCount > 0 ? `当前分支还有 ${unpushedInfo.unpushedCommitCount} 个本地提交没有 push。` : '当前分支存在本地提交没有 push。';

      const upstreamText = unpushedInfo.hasUpstream ? `远程跟踪分支：${unpushedInfo.upstream}` : '当前分支尚未建立远程跟踪分支。';

      const confirm = await vscode.window.showWarningMessage(
        `当前分支 [ ${unpushedInfo.currentBranch} ] 还有提交没有 push，确定要切换到 [ ${targetBranch} ] 吗？\n\n${countText}\n${upstreamText}\n\n建议先 push，避免切换后忘记当前分支还有未推送提交。`,
        { modal: true },
        '继续切换',
      );

      return confirm === '继续切换';
    } catch {
      return true;
    }
  }

  private async refreshRecentProjectsAfterCheckout(cwd: string): Promise<void> {
    try {
      await vscode.commands.executeCommand('quickOps.refreshCurrentWorkspaceRecentProject', cwd);
    } catch {
      // Recent Projects 视图未激活或命令尚未注册时，不影响 Git 主流程。
    }
  }

  private async handleGitErrorWithConflictCheck(cwd: string, operationName: string, originalErrorMsg: string) {
    try {
      const repoStatus = await this.gitService.getRepoStatus(cwd);
      const conflicts = repoStatus.conflictedFiles || [];

      if (conflicts.length > 0) {
        vscode.window.showWarningMessage(`【${operationName}】产生冲突！\n共检测到 ${conflicts.length} 个冲突文件，请在侧边栏的【冲突区】中逐一解决。`);
        vscode.commands.executeCommand('workbench.view.scm');
      } else {
        vscode.window.showErrorMessage(`${operationName} 失败: ${originalErrorMsg}`);
      }
    } catch {
      vscode.window.showErrorMessage(`${operationName} 失败: ${originalErrorMsg}`);
    }

    await this.refreshStatus(cwd, false);
  }

  private shouldFetchRemote(force = false): boolean {
    if (force) return true;

    const now = Date.now();

    return now - this._lastRemoteFetchAt > this.REMOTE_FETCH_INTERVAL;
  }

  private async checkRemoteSyncInBackground(cwd: string, options: { fetch?: boolean } = {}): Promise<void> {
    if (!this._view) return;

    const needFetch = !!options.fetch;

    if (this._isRemoteSyncChecking) {
      if (needFetch) {
        this._pendingRemoteSyncFetch = true;
      }

      return;
    }

    this._isRemoteSyncChecking = true;

    this._view.webview.postMessage({
      type: 'remoteSyncChecking',
      checking: true,
    });

    try {
      if (needFetch) {
        this._lastRemoteFetchAt = Date.now();
      }

      const remoteSync = await this.gitService.getRemoteSync(cwd, {
        fetch: needFetch,
      });

      this._view.webview.postMessage({
        type: 'remoteSyncData',
        remoteSync,
      });
    } finally {
      this._isRemoteSyncChecking = false;

      this._view?.webview.postMessage({
        type: 'remoteSyncChecking',
        checking: false,
      });

      if (this._pendingRemoteSyncFetch) {
        this._pendingRemoteSyncFetch = false;

        setTimeout(() => {
          void this.checkRemoteSyncInBackground(cwd, { fetch: true });
        }, 0);
      }
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
      if (this._isInternalOp) return;

      if (this._debounceTimer) {
        clearTimeout(this._debounceTimer);
      }

      this._debounceTimer = setTimeout(async () => {
        if (this._isInternalOp) return;
        if (this._isRefreshing) return;

        const cwd = this.getWorkspaceRoot();

        if (!cwd) return;

        let currentState = '';

        try {
          currentState = await this.getGraphState(cwd);
        } catch {
          currentState = '';
        }

        const graphChanged = currentState !== this._lastGraphState;

        if (graphChanged) {
          this._lastGraphState = currentState;
        }

        void this.refreshStatus(cwd, graphChanged);
      }, 1500);
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

  public async resolveWebviewView(webviewView: vscode.WebviewView, _context: vscode.WebviewViewResolveContext, _token: vscode.CancellationToken): Promise<void> {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = await this.reactWebviewHtmlWorkflow.createReactWebviewHtml({
      extensionUri: this._extensionUri,
      webview: webviewView.webview,
      routeName: GIT_WEBVIEW_ROUTES.main,
    });

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

      if (this._debounceTimer) {
        clearTimeout(this._debounceTimer);
        this._debounceTimer = null;
      }

      if (this._internalOpTimer) {
        clearTimeout(this._internalOpTimer);
        this._internalOpTimer = null;
      }
    });

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      try {
        const command = msg.command || msg.type;

        if (command === 'openExternal') {
          vscode.env.openExternal(vscode.Uri.parse(msg.url));
          return;
        }

        if (command === 'clone') {
          vscode.commands.executeCommand('git.clone');
          return;
        }

        if (command === 'error') {
          vscode.window.showErrorMessage(msg.message || '操作失败');
          return;
        }

        if (command === 'toggleCommitTypeEnabled') {
          const nextValue = !!msg.value;

          await this._context.globalState.update(GLOBAL_STATE_COMMIT_TYPE_ENABLED, nextValue);

          this._view?.webview.postMessage({
            type: 'gitConfigChanged',
            defaultCommitTypeEnabled: nextValue,
          });

          return;
        }

        if (command === 'webviewLoaded' || command === 'refresh') {
          const isInstalled = await this.gitService.checkGitInstalled();

          const config = vscode.workspace.getConfiguration('quick-ops.git');
          const defaultSkipVerify = config.get<boolean>('defaultSkipVerify') || false;

          this._view?.webview.postMessage({
            type: 'gitInstallationStatus',
            isInstalled,
            defaultSkipVerify,
            defaultCommitTypeEnabled: this.getDefaultCommitTypeEnabled(),
            isInit: command === 'webviewLoaded',
          });

          if (!isInstalled) return;
        }

        const cwd = this.getWorkspaceRoot();

        if (!cwd) {
          if (command === 'webviewLoaded' || command === 'refresh') {
            this._view?.webview.postMessage({
              type: 'noWorkspace',
            });
          }

          return;
        }

        switch (command) {
          case 'webviewLoaded':
          case 'refresh': {
            await this.refreshStatus(cwd, true);

            if (command === 'refresh') {
              void this.checkRemoteSyncInBackground(cwd, { fetch: true });
            }

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
            await this.checkRemoteSyncInBackground(cwd, { fetch: true });
            break;
          }

          case 'openStagedChanges': {
            await this.withViewProgress(async () => {
              const files = await this.gitService.getStagedChangeFiles(cwd);
              await this.openChangesEditor(cwd, '暂存区更改', files, 'staged');
            });

            break;
          }

          case 'openWorkingTreeChanges': {
            await this.withViewProgress(async () => {
              const files = await this.gitService.getWorkingTreeChangeFiles(cwd);
              await this.openChangesEditor(cwd, '工作区更改', files, 'working');
            });

            break;
          }

          case 'stash': {
            const selectedFiles = (msg as any).selectedFiles as string[] | undefined;

            const options: vscode.QuickPickItem[] = [
              {
                label: '$(archive) 快速贮藏 (默认备注)',
                description: '直接贮藏，使用系统自动生成的 WIP 备注',
                alwaysShow: true,
              },
              {
                label: '$(edit) 自定义备注贮藏...',
                description: '手动输入具体的贮藏备注信息',
                alwaysShow: true,
              },
            ];

            const selected = await vscode.window.showQuickPick(options, {
              placeHolder: '请选择贮藏方式',
            });

            if (!selected) return;

            let stashMsg = '';

            if (selected.label.includes('自定义备注贮藏')) {
              const input = await vscode.window.showInputBox({
                prompt: '请输入贮藏备注',
                placeHolder: '例如: 暂存前端开发进度',
              });

              if (input === undefined) return;

              stashMsg = input.trim();
            }

            await this.executeGitOperation(async () => {
              try {
                if (selectedFiles && selectedFiles.length > 0) {
                  await this.gitService.stashPushFiles(cwd, selectedFiles, stashMsg);
                } else {
                  await this.gitService.stashPush(cwd, stashMsg);
                }
                vscode.window.showInformationMessage('📦 已成功贮藏工作区更改。');
                await this.refreshStatus(cwd, false);
              } catch (e: any) {
                await this.handleGitErrorWithConflictCheck(cwd, '贮藏 (Stash)', e.message);
              }
            });

            break;
          }

          case 'stashFiles': {
            const files = (msg as any).files as string[];

            if (!files || files.length === 0) break;

            await this.executeGitOperation(async () => {
              try {
                await this.gitService.stashPushFiles(cwd, files);
                vscode.window.showInformationMessage(`📦 已成功贮藏 ${files.length} 个文件。`);
                await this.refreshStatus(cwd, false);
              } catch (e: any) {
                await this.handleGitErrorWithConflictCheck(cwd, '贮藏文件 (Stash)', e.message);
              }
            });

            break;
          }

          case 'getStashFiles': {
            await this.withViewProgress(async () => {
              try {
                const result = await this.gitService.getStashFiles(cwd, msg.index);

                this._view?.webview.postMessage({
                  type: 'stashFilesData',
                  index: result.index,
                  hash: result.hash,
                  parentHash: result.parentHash,
                  files: result.files,
                });
              } catch (e: any) {
                vscode.window.showErrorMessage(`获取贮藏文件失败: ${e.message}`);
              }
            });

            break;
          }

          case 'stashApply': {
            await this.executeGitOperation(async () => {
              try {
                await this.gitService.stashApply(cwd, msg.index);
                vscode.window.showInformationMessage(`✅ 已应用贮藏 stash@{${msg.index}}`);
                await this.refreshStatus(cwd, false);
              } catch (e: any) {
                await this.handleGitErrorWithConflictCheck(cwd, '应用贮藏', e.message);
              }
            });

            break;
          }

          case 'stashPop': {
            await this.executeGitOperation(async () => {
              try {
                await this.gitService.stashPop(cwd, msg.index);
                vscode.window.showInformationMessage(`✅ 已弹出并删除贮藏 stash@{${msg.index}}`);
                await this.refreshStatus(cwd, false);
              } catch (e: any) {
                await this.handleGitErrorWithConflictCheck(cwd, '弹出贮藏', e.message);
              }
            });

            break;
          }

          case 'stashDrop': {
            const confirm = await vscode.window.showWarningMessage(`确定要永久删除贮藏 stash@{${msg.index}} 吗？\n此操作不可撤销！`, { modal: true }, '删除贮藏');

            if (confirm !== '删除贮藏') return;

            await this.executeGitOperation(async () => {
              try {
                await this.gitService.stashDrop(cwd, msg.index);
                vscode.window.showInformationMessage(`🗑️ 已删除贮藏 stash@{${msg.index}}`);
                await this.refreshStatus(cwd, false);
              } catch (e: any) {
                vscode.window.showErrorMessage(`删除贮藏失败: ${e.message}`);
              }
            });

            break;
          }

          case 'undoLastCommit': {
            await this.executeGitOperation(async () => {
              try {
                const lastCommitMessage = await this.getHeadCommitMessage(cwd);

                await this.gitService.undoLastCommit(cwd);

                vscode.window.showInformationMessage('✅ 已撤销最近一次提交，更改已退回暂存区。');

                this._view?.webview.postMessage({
                  type: 'undoLastCommitSuccess',
                  message: lastCommitMessage,
                });

                await this.refreshStatus(cwd, true);
              } catch (e: any) {
                vscode.window.showErrorMessage(`无法撤销提交 (可能没有足够的提交记录): ${e.message}`);
              }
            });

            break;
          }

          case 'createBranch': {
            try {
              const newBranchName = await vscode.window.showInputBox({
                prompt: '请输入新分支的名称',
                placeHolder: '例如: feature/new-login',
                validateInput: (text) => {
                  if (text.trim().length === 0) return '分支名称不能为空';
                  if (/\s/.test(text)) return '分支名称不能包含空格';
                  return null;
                },
              });

              if (!newBranchName) return;

              await this.executeGitOperation(async () => {
                await this.gitService.createBranch(cwd, newBranchName);
                vscode.window.showInformationMessage(`✅ 已成功创建并切换到新分支: ${newBranchName}`);
                await this.refreshStatus(cwd, true);
                await this.refreshRecentProjectsAfterCheckout(cwd);
              });
            } catch (e: any) {
              vscode.window.showErrorMessage(`创建新分支失败: ${e.message}`);
            }

            break;
          }

          case 'checkoutBranch': {
            type BranchSourceType = 'local' | 'remote';

            type LocalBranchQuickPickItem = vscode.QuickPickItem & {
              branchName: string;
            };

            type RemoteBranchQuickPickItem = vscode.QuickPickItem & {
              remoteBranchName: string;
              localBranchName: string;
            };

            const copyBtn: vscode.QuickInputButton = {
              iconPath: new vscode.ThemeIcon('copy'),
              tooltip: '复制分支名',
            };

            const remoteOpBtn: vscode.QuickInputButton = {
              iconPath: new vscode.ThemeIcon('cloud'),
              tooltip: '远程分支操作 (创建/删除)',
            };

            const showRemoteBranchQuickPick = async () => {
              try {
                const { branches: localBranches, current: currentBranch } = await this.gitService.getLocalBranches(cwd);

                const remoteBranches = await this.withViewProgress(async () => {
                  return await this.gitService.getRemoteBranches(cwd, {
                    fetch: true,
                  });
                });

                if (remoteBranches.length === 0) {
                  vscode.window.showInformationMessage('没有获取到远程分支。');
                  return;
                }

                const quickPick = vscode.window.createQuickPick<RemoteBranchQuickPickItem>();

                quickPick.title = '切换远程分支';
                quickPick.placeholder = '请选择要切换的远程分支';
                quickPick.matchOnDescription = true;
                quickPick.ignoreFocusOut = true;

                quickPick.items = remoteBranches.map((remoteBranchName) => {
                  const localBranchName = this.gitService.getLocalNameFromRemoteBranch(remoteBranchName);
                  const hasLocalBranch = localBranches.includes(localBranchName);

                  return {
                    label: remoteBranchName,
                    description: hasLocalBranch ? `本地已存在：${localBranchName}` : `将创建本地分支：${localBranchName}`,
                    detail: hasLocalBranch ? '选择后切换到已有本地分支' : `选择后基于 ${remoteBranchName} 创建并跟踪本地分支`,
                    remoteBranchName,
                    localBranchName,
                    buttons: [copyBtn],
                  };
                });

                const activeItem = quickPick.items.find((item) => {
                  return item.localBranchName === currentBranch;
                });

                if (activeItem) {
                  quickPick.activeItems = [activeItem];
                }

                quickPick.onDidTriggerItemButton((e) => {
                  if (e.button === copyBtn) {
                    vscode.env.clipboard.writeText(e.item.remoteBranchName);
                    vscode.window.showInformationMessage(`已复制远程分支名: ${e.item.remoteBranchName}`);
                  }
                });

                quickPick.onDidAccept(async () => {
                  const selected = quickPick.selectedItems[0];

                  if (!selected) {
                    quickPick.hide();
                    return;
                  }

                  quickPick.hide();

                  const confirm = await vscode.window.showWarningMessage(
                    `确定要切换到远程分支 [ ${selected.remoteBranchName} ] 吗？\n\n此操作可能会改变当前工作区文件状态，请确认当前更改已保存或已处理。`,
                    { modal: true },
                    '确认切换',
                  );

                  if (confirm !== '确认切换') {
                    return;
                  }

                  const canCheckout = await this.confirmCheckoutWhenCurrentBranchHasUnpushedCommits(cwd, selected.localBranchName || selected.remoteBranchName);

                  if (!canCheckout) {
                    return;
                  }

                  await this.executeGitOperation(async () => {
                    try {
                      const localBranchName = await this.gitService.checkoutRemoteBranch(cwd, selected.remoteBranchName);

                      if (currentBranch && currentBranch !== localBranchName) {
                        this._lastCheckoutSourceBranchByCwd.set(cwd, currentBranch);
                      }

                      vscode.window.showInformationMessage(`✅ 已切换到分支: ${localBranchName}`);

                      await this.refreshStatus(cwd, true);
                      await this.refreshRecentProjectsAfterCheckout(cwd);
                    } catch (err: any) {
                      await this.handleGitErrorWithConflictCheck(cwd, '切换远程分支', err.message);
                    }
                  });
                });

                quickPick.onDidHide(() => quickPick.dispose());
                quickPick.show();
              } catch (e: any) {
                vscode.window.showErrorMessage(`获取远程分支失败: ${e.message}`);
              }
            };

            const showLocalBranchQuickPick = async () => {
              try {
                const { branches: localBranches, current: currentBranch } = await this.gitService.getLocalBranches(cwd);

                const quickPick = vscode.window.createQuickPick<LocalBranchQuickPickItem>();

                quickPick.title = '切换本地分支';
                quickPick.placeholder = '请选择要切换到的本地分支';
                quickPick.matchOnDescription = true;
                quickPick.ignoreFocusOut = true;

                const lastCheckoutSourceBranch = this._lastCheckoutSourceBranchByCwd.get(cwd);

                const items = localBranches.map((branchName) => {
                  const descriptions: string[] = [];

                  if (branchName === currentBranch) {
                    descriptions.push('当前分支');
                  }

                  if (branchName === lastCheckoutSourceBranch && branchName !== currentBranch) {
                    descriptions.push('上一次切换分支');
                  }

                  return {
                    label: branchName,
                    description: descriptions.length > 0 ? descriptions.join(' · ') : undefined,
                    branchName,
                    buttons: [copyBtn, remoteOpBtn],
                  };
                });

                quickPick.items = items;

                const activeItem = items.find((item) => item.branchName === currentBranch);

                if (activeItem) {
                  quickPick.activeItems = [activeItem];
                }

                quickPick.onDidTriggerItemButton((e) => {
                  if (e.button === copyBtn) {
                    vscode.env.clipboard.writeText(e.item.branchName);
                    vscode.window.showInformationMessage(`已复制分支名: ${e.item.branchName}`);
                    return;
                  }

                  if (e.button === remoteOpBtn) {
                    quickPick.hide();

                    const branchName = e.item.branchName;

                    const remoteQuickPick = vscode.window.createQuickPick<vscode.QuickPickItem & { action: string }>();

                    remoteQuickPick.title = `远程分支操作 - ${branchName}`;
                    remoteQuickPick.placeholder = '请选择要执行的操作';
                    remoteQuickPick.items = [
                      {
                        label: '$(cloud-upload) 创建远程分支',
                        description: `推送本地 ${branchName} 到 origin/${branchName}`,
                        action: 'create',
                      },
                      {
                        label: '$(trash) 删除远程分支',
                        description: `从 origin 永久删除 ${branchName}`,
                        action: 'delete',
                      },
                    ];

                    remoteQuickPick.onDidAccept(async () => {
                      const selectedOp = remoteQuickPick.selectedItems[0];

                      if (!selectedOp) return;

                      remoteQuickPick.hide();

                      await this.executeGitOperation(async () => {
                        try {
                          if (selectedOp.action === 'create') {
                            vscode.window.showInformationMessage(`正在创建并推送远程分支 origin/${branchName}...`);

                            await this.gitService.pushBranchToOrigin(cwd, branchName);

                            vscode.window.showInformationMessage(`✅ 已成功创建并推送远程分支: origin/${branchName}`);
                          }

                          if (selectedOp.action === 'delete') {
                            const confirm = await vscode.window.showWarningMessage(
                              `确定要删除远程分支 origin/${branchName} 吗？\n此操作不可逆，团队其他成员将无法再访问该分支！`,
                              { modal: true },
                              '确定删除',
                            );

                            if (confirm === '确定删除') {
                              vscode.window.showInformationMessage(`正在删除远程分支 origin/${branchName}...`);

                              await this.gitService.deleteRemoteBranch(cwd, branchName);

                              vscode.window.showInformationMessage(`🗑️ 已成功删除远程分支: origin/${branchName}`);
                            }
                          }

                          await this.refreshStatus(cwd, true);
                        } catch (err: any) {
                          vscode.window.showErrorMessage(`远程分支操作失败: ${err.message}`);
                        }
                      });
                    });

                    remoteQuickPick.onDidHide(() => remoteQuickPick.dispose());
                    remoteQuickPick.show();
                  }
                });

                quickPick.onDidAccept(async () => {
                  const selected = quickPick.selectedItems[0];

                  if (!selected || selected.branchName === currentBranch) {
                    quickPick.hide();
                    return;
                  }

                  quickPick.hide();

                  const confirm = await vscode.window.showWarningMessage(
                    `确定要从当前分支 [ ${currentBranch} ] 切换到 [ ${selected.branchName} ] 吗？\n\n此操作可能会改变当前工作区文件状态，请确认当前更改已保存或已处理。`,
                    { modal: true },
                    '确认切换',
                  );

                  if (confirm !== '确认切换') {
                    return;
                  }

                  const canCheckout = await this.confirmCheckoutWhenCurrentBranchHasUnpushedCommits(cwd, selected.branchName);

                  if (!canCheckout) {
                    return;
                  }

                  await this.executeGitOperation(async () => {
                    try {
                      await this.gitService.checkoutBranch(cwd, selected.branchName);

                      if (currentBranch && currentBranch !== selected.branchName) {
                        this._lastCheckoutSourceBranchByCwd.set(cwd, currentBranch);
                      }

                      vscode.window.showInformationMessage(`✅ 已切换到分支: ${selected.branchName}`);

                      await this.refreshStatus(cwd, true);
                      await this.refreshRecentProjectsAfterCheckout(cwd);
                    } catch (err: any) {
                      await this.handleGitErrorWithConflictCheck(cwd, '切换分支', err.message);
                    }
                  });
                });

                quickPick.onDidHide(() => quickPick.dispose());
                quickPick.show();
              } catch (e: any) {
                vscode.window.showErrorMessage(`获取本地分支列表失败: ${e.message}`);
              }
            };

            try {
              const source = await vscode.window.showQuickPick<vscode.QuickPickItem & { type: BranchSourceType }>(
                [
                  {
                    label: '$(git-branch) 本地分支',
                    description: '切换已有本地分支',
                    type: 'local',
                  },
                  {
                    label: '$(cloud-download) 远程分支',
                    description: '获取远程分支并切换',
                    type: 'remote',
                  },
                ],
                {
                  title: '切换分支',
                  placeHolder: '请选择分支来源',
                  matchOnDescription: true,
                },
              );

              if (!source) return;

              if (source.type === 'local') {
                await showLocalBranchQuickPick();
                return;
              }

              if (source.type === 'remote') {
                await showRemoteBranchQuickPick();
              }
            } catch (e: any) {
              vscode.window.showErrorMessage(`切换分支失败: ${e.message}`);
            }

            break;
          }

          case 'mergeBranch': {
            try {
              const { branches, current } = await this.gitService.getLocalBranches(cwd);
              const mergeableBranches = branches.filter((b) => b !== current);

              if (mergeableBranches.length === 0) {
                vscode.window.showInformationMessage('没有其他本地分支可供合并');
                return;
              }

              const lastCheckoutSourceBranch = this._lastCheckoutSourceBranchByCwd.get(cwd);

              const items = mergeableBranches.map((b) => ({
                label: b,
                description: b === lastCheckoutSourceBranch ? '上一次切换分支' : undefined,
                branchName: b,
              }));

              const quickPick = vscode.window.createQuickPick<vscode.QuickPickItem & { branchName: string }>();

              quickPick.title = '合并本地分支';
              quickPick.placeholder = `请选择要合并到【${current}】的本地分支`;
              quickPick.matchOnDescription = true;
              quickPick.ignoreFocusOut = true;
              quickPick.items = items;

              const lastCheckoutSourceItem = lastCheckoutSourceBranch ? items.find((item) => item.branchName === lastCheckoutSourceBranch) : undefined;

              /**
               * 如果上一次切换来源分支已经被删除，就清掉缓存。
               * 例如之前记录的是 feature/0.0.1，但该分支已删除，
               * 此时合并列表里找不到它，就回退选中第一个可合并分支。
               */
              if (lastCheckoutSourceBranch && !lastCheckoutSourceItem) {
                this._lastCheckoutSourceBranchByCwd.delete(cwd);
              }

              const activeItem = lastCheckoutSourceItem || items[0];

              if (activeItem) {
                quickPick.activeItems = [activeItem];
              }

              const selected = await new Promise<(vscode.QuickPickItem & { branchName: string }) | undefined>((resolve) => {
                let accepted = false;

                quickPick.onDidAccept(() => {
                  accepted = true;
                  resolve(quickPick.selectedItems[0]);
                  quickPick.hide();
                });

                quickPick.onDidHide(() => {
                  quickPick.dispose();

                  if (!accepted) {
                    resolve(undefined);
                  }
                });

                quickPick.show();
              });

              if (!selected) return;

              const confirm = await vscode.window.showWarningMessage(
                `确定要将分支 [ ${selected.branchName} ] 合并到当前分支 [ ${current} ] 吗？\n\n合并可能产生冲突，请确认当前工作区更改已保存或已处理。`,
                { modal: true },
                '确认合并',
              );

              if (confirm !== '确认合并') {
                return;
              }

              await this.executeGitOperation(async () => {
                try {
                  await this.gitService.mergeBranch(cwd, selected.branchName);
                  vscode.window.showInformationMessage(`🎉 已成功将 ${selected.branchName} 合并到 ${current}`);
                  await this.refreshStatus(cwd, true);
                } catch (e: any) {
                  await this.handleGitErrorWithConflictCheck(cwd, '合并分支', e.message);
                }
              });
            } catch (e: any) {
              vscode.window.showErrorMessage(`处理合并时出错: ${e.message}`);
            }

            break;
          }

          case 'changeGraphFilter': {
            try {
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
                  options.currentFilter === this.gitService.CURRENT_BRANCH_FILTER || options.currentFilter === '当前分支'
                    ? isCurrentBranch
                    : this.normalizeBranchOptionName(branchName) === options.currentFilter;

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

              const createItems = async (options: { fetchRemote?: boolean } = {}) => {
                const localResult = await this.gitService.getLocalBranches(cwd);
                const remoteBranches = await this.gitService.getRemoteBranches(cwd, {
                  fetch: !!options.fetchRemote,
                });

                const currentBranch = localResult.current;
                const currentFilter = this.normalizeGraphFilterName(String(msg.current || this._currentGraphFilter || ''));
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
                await this.withViewProgress(async () => {
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

                  /**
                   * 点击“筛选分支（当前分支）”打开下拉框时，
                   * 默认 activeItems 选中“分支”分组里的本地当前分支。
                   */
                  const currentLocalItem = result.localItems.find((item) => item.branchName === result.currentBranch);

                  if (currentLocalItem) {
                    quickPick.activeItems = [currentLocalItem];
                    return;
                  }

                  const firstBranchItem = result.localItems[0] || result.remoteItems[0];

                  if (firstBranchItem) {
                    quickPick.activeItems = [firstBranchItem];
                  }
                });
              };

              await updateQuickPickItems();
              quickPick.show();

              quickPick.busy = true;

              this.executeGitOperation(async () => {
                try {
                  await updateQuickPickItems({
                    fetchRemote: true,
                  });
                } catch {
                  // ignore
                }
              }).finally(() => {
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
                  quickPick.dispose();

                  if (!accepted) {
                    resolve(undefined);
                  }
                });
              });

              if (!selectedBranch) return;

              this._currentGraphFilter = selectedBranch;

              await this.withViewProgress(async () => {
                const graphData = await this.getGitGraphLikeData(cwd, selectedBranch);

                this._view?.webview.postMessage({
                  type: 'graphData',
                  graphCommits: graphData.graphCommits,
                  graphFilter: graphData.graphFilter,
                  totalCommits: graphData.totalCommits,
                });
              });
            } catch (e: any) {
              vscode.window.showErrorMessage(`获取分支记录失败: ${e.message}`);
            }

            break;
          }

          case 'viewFileHistory': {
            try {
              await this.withViewProgress(async () => {
                const commits = await this.gitService.getFileHistory(cwd, msg.file);
                const fileName = msg.file.split('/').pop() || msg.file;

                this._view?.webview.postMessage({
                  type: 'compareData',
                  baseBranch: '文件历史',
                  targetBranch: fileName,
                  commits,
                });
              });
            } catch (e: any) {
              vscode.window.showErrorMessage(`获取文件历史失败: ${e.message}`);
            }

            break;
          }

          case 'requestCompare': {
            try {
              const quickPick = vscode.window.createQuickPick<vscode.QuickPickItem & { branchName: string }>();

              quickPick.placeholder = '1/2: 请选择【基准分支】(Base Branch，支持远程分支)';
              quickPick.matchOnDescription = true;

              const updateQuickPickItems = async () => {
                await this.withViewProgress(async () => {
                  const branchNames = await this.gitService.getAllBranches(cwd);
                  const prevActive = quickPick.activeItems[0]?.branchName;

                  const items = branchNames.map((b) => ({
                    label: b,
                    branchName: b,
                  }));

                  quickPick.items = items;

                  if (prevActive) {
                    const newActive = items.find((i) => i.branchName === prevActive);

                    if (newActive) {
                      quickPick.activeItems = [newActive];
                    }
                  }
                });
              };

              await updateQuickPickItems();
              quickPick.show();

              quickPick.busy = true;

              this.executeGitOperation(async () => {
                try {
                  await this.gitService.fetchAllPrune(cwd);
                  await updateQuickPickItems();
                } catch {
                  // ignore
                }
              }).finally(() => {
                quickPick.busy = false;
              });

              const baseBranch = await new Promise<string | undefined>((resolve) => {
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

              if (!baseBranch) return;

              let targetBranch: string | undefined;

              await this.withViewProgress(async () => {
                const branchesAfterFetch = await this.gitService.getAllBranches(cwd);
                const branchNamesAfterFetch = branchesAfterFetch.filter((b) => b !== baseBranch);

                targetBranch = await vscode.window.showQuickPick(branchNamesAfterFetch, {
                  placeHolder: `2/2: 请选择【目标分支】(查看 ${baseBranch} 中没有的记录)`,
                  matchOnDescription: true,
                });
              });

              if (!targetBranch) return;

              await this.withViewProgress(async () => {
                const commits = await this.gitService.getCompareCommits(cwd, baseBranch, targetBranch!);

                this._view?.webview.postMessage({
                  type: 'compareData',
                  baseBranch,
                  targetBranch,
                  commits,
                });
              });
            } catch (e: any) {
              vscode.window.showErrorMessage(`对比分支失败: ${e.message}`);
            }

            break;
          }

          case 'compareFileAcrossBranches': {
            try {
              let baseBranch: string | undefined = msg.baseBranch;
              let targetBranch: string | undefined = msg.targetBranch;

              if (!baseBranch || !targetBranch) {
                type CompareBranchQuickPickItem = vscode.QuickPickItem & {
                  branchName?: string;
                  branchType?: 'local' | 'remote';
                };

                interface CompareBranchMeta {
                  author: string;
                  shortHash: string;
                  subject: string;
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

                const getBranchMetaMap = async () => {
                  const metaMap = new Map<string, CompareBranchMeta>();
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

                      metaMap.set(branchName, {
                        author: author || '未知作者',
                        shortHash: shortHash || '',
                        subject: subjectParts.join('\x1f') || '',
                        relativeTime: formatBranchRelativeTime(Number(timestampText) || 0),
                      });
                    });

                  return metaMap;
                };

                const pickBranch = async (options: { title: string; placeholder: string; excludeBranch?: string; defaultBranch?: string; fetchRemote?: boolean }) => {
                  const quickPick = vscode.window.createQuickPick<CompareBranchQuickPickItem>();

                  quickPick.title = options.title;
                  quickPick.placeholder = options.placeholder;
                  quickPick.matchOnDescription = true;
                  quickPick.matchOnDetail = true;
                  quickPick.ignoreFocusOut = true;

                  const updateQuickPickItems = async (fetchRemote = false) => {
                    await this.withViewProgress(async () => {
                      const prevActive = quickPick.activeItems.find((item) => item.branchName)?.branchName;
                      const { branches: localBranches, current: currentBranch } = await this.gitService.getLocalBranches(cwd);
                      const remoteBranches = await this.gitService.getRemoteBranches(cwd, {
                        fetch: fetchRemote,
                      });
                      const localBranchSet = new Set(localBranches);
                      const metaMap = await getBranchMetaMap();

                      const createItem = (branchName: string, branchType: 'local' | 'remote'): CompareBranchQuickPickItem | null => {
                        if (options.excludeBranch && branchName === options.excludeBranch) {
                          return null;
                        }

                        const meta = metaMap.get(branchName);
                        const localName = branchType === 'remote' ? this.gitService.getLocalNameFromRemoteBranch(branchName) : '';
                        const remoteDescription = branchType === 'remote' && localBranchSet.has(localName) ? `本地已存在：${localName}` : undefined;

                        return {
                          iconPath: new vscode.ThemeIcon(branchType === 'remote' ? 'cloud' : 'git-branch'),
                          label: branchName,
                          description: meta?.relativeTime || (branchName === currentBranch ? '当前分支' : remoteDescription),
                          detail: meta ? `${meta.author} • ${meta.shortHash} • ${meta.subject || '无提交信息'}` : remoteDescription,
                          branchName,
                          branchType,
                        };
                      };

                      const localItems = localBranches.map((branchName) => createItem(branchName, 'local')).filter(Boolean) as CompareBranchQuickPickItem[];
                      const remoteItems = remoteBranches.map((branchName) => createItem(branchName, 'remote')).filter(Boolean) as CompareBranchQuickPickItem[];

                      const items: CompareBranchQuickPickItem[] = [
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

                      quickPick.items = items;

                      const activeItem =
                        (prevActive ? items.find((item) => item.branchName === prevActive) : undefined) ||
                        (options.defaultBranch ? items.find((item) => item.branchName === options.defaultBranch) : undefined) ||
                        localItems.find((item) => item.branchName === currentBranch) ||
                        localItems[0] ||
                        remoteItems[0];

                      if (activeItem) {
                        quickPick.activeItems = [activeItem];
                      }
                    });
                  };

                  await updateQuickPickItems(false);
                  quickPick.show();

                  quickPick.busy = true;

                  this.executeGitOperation(async () => {
                    try {
                      await updateQuickPickItems(true);
                    } catch {
                      // ignore
                    }
                  }).finally(() => {
                    quickPick.busy = false;
                  });

                  return await new Promise<string | undefined>((resolve) => {
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
                      quickPick.dispose();

                      if (!accepted) {
                        resolve(undefined);
                      }
                    });
                  });
                };

                baseBranch = await pickBranch({
                  title: '跨分支文件对比',
                  placeholder: '1/2：选择基准分支（Base Branch）',
                });

                if (!baseBranch) return;

                targetBranch = await pickBranch({
                  title: '跨分支文件对比',
                  placeholder: `2/2：选择目标分支（查看 ${baseBranch} 中没有的记录）`,
                  excludeBranch: baseBranch,
                });

                if (!targetBranch) return;
              }

              await this.withViewProgress(async () => {
                const commits = await this.gitService.getCompareCommits(cwd, baseBranch!, targetBranch!);

                this._view?.webview.postMessage({
                  type: 'compareData',
                  baseBranch: baseBranch!,
                  targetBranch: targetBranch!,
                  commits,
                });
              });

              await this.withViewProgress(async () => {
                const diffFiles = await this.gitService.getDiffFilesBetweenBranches(cwd, baseBranch!, targetBranch!);

                if (diffFiles.length === 0) {
                  vscode.window.showInformationMessage(`分支 ${baseBranch} 和 ${targetBranch} 之间没有任何文件差异。`);
                  return;
                }

                const changesArgs = diffFiles.map((f) => {
                  let leftRef = baseBranch!;
                  let rightRef = targetBranch!;

                  if (f.status === 'A') leftRef = 'empty';
                  if (f.status === 'D') rightRef = 'empty';

                  const leftUri = this.createGitContentUri(cwd, leftRef, f.file);
                  const rightUri = this.createGitContentUri(cwd, rightRef, f.file);
                  const fileUri = vscode.Uri.file(path.join(cwd, f.file));

                  return [fileUri, leftUri, rightUri];
                });

                const title = `对比: ${baseBranch} ↔ ${targetBranch}`;

                await vscode.commands.executeCommand('vscode.changes', title, changesArgs);
              });
            } catch (e: any) {
              vscode.window.showErrorMessage(`跨分支对比失败: ${e.message}`);
            }

            break;
          }

          case 'openCommitMultiDiff': {
            await this.withViewProgress(async () => {
              const result = await this.gitService.getCommitFiles(cwd, msg.hash);
              const parentHash = result.parentHash;

              if (result.files.length === 0) return;

              const changesArgs = result.files.map((f) => {
                let leftRef = parentHash || 'empty';
                let rightRef = msg.hash;

                if (f.status === 'A') leftRef = 'empty';
                if (f.status === 'D') rightRef = 'empty';

                const leftUri = this.createGitContentUri(cwd, leftRef, f.file);
                const rightUri = this.createGitContentUri(cwd, rightRef, f.file);
                const fileUri = vscode.Uri.file(path.join(cwd, f.file));

                return [fileUri, leftUri, rightUri];
              });

              const title = `Commit: ${msg.hash.substring(0, 7)}`;

              await vscode.commands.executeCommand('vscode.changes', title, changesArgs);
            });

            break;
          }

          case 'diff': {
            const fileUri = vscode.Uri.file(path.join(cwd, msg.file));
            const defaultWorkspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            const isCurrentWorkspace = defaultWorkspace && cwd === defaultWorkspace;

            if (msg.status === 'C') {
              vscode.commands.executeCommand('vscode.open', fileUri);
            } else if (msg.status === 'U' || msg.status === 'A') {
              const emptyUri = this.createGitContentUri(cwd, 'empty', msg.file);
              const rightUri = isCurrentWorkspace ? fileUri : this.createGitContentUri(cwd, 'working', msg.file);

              vscode.commands.executeCommand('vscode.diff', emptyUri, rightUri, `${msg.file} (未跟踪)`);
            } else {
              const originalUri = this.createGitContentUri(cwd, 'HEAD', msg.file);
              const rightUri = isCurrentWorkspace ? fileUri : this.createGitContentUri(cwd, 'working', msg.file);

              vscode.commands.executeCommand('vscode.diff', originalUri, rightUri, `${msg.file} (工作树)`);
            }

            break;
          }

          case 'commit': {
            await this.executeGitOperation(async () => {
              await this.handleCommit(cwd, msg.message, msg.skipVerify);
            });

            break;
          }

          case 'pull': {
            await this.executeGitOperation(async () => {
              try {
                await this.gitService.pull(cwd);

                vscode.window.showInformationMessage('⬇️ 拉取成功！');

                this._view?.webview.postMessage({
                  type: 'clearJustCommitted',
                });

                await this.refreshStatus(cwd, true);
              } catch (e: any) {
                await this.handleGitErrorWithConflictCheck(cwd, '拉取 (Pull)', e.message);
              }
            });

            break;
          }

          case 'push': {
            await this.executeGitOperation(async () => {
              try {
                const pushInfo = await this.gitService.getPushInfo(cwd);

                if (!pushInfo.currentBranch) {
                  vscode.window.showErrorMessage('无法获取当前分支状态。');
                  return;
                }

                if (!pushInfo.hasUpstream) {
                  const confirm = await vscode.window.showWarningMessage(
                    `确定要创建远程分支并推送当前分支 [ ${pushInfo.currentBranch} ] 吗？\n\n当前分支尚未在远程仓库建立跟踪，确认后会创建 origin/${pushInfo.currentBranch} 并推送本地提交。`,
                    { modal: true },
                    '确认创建并推送',
                  );

                  if (confirm !== '确认创建并推送') return;
                } else {
                  const confirm = await vscode.window.showWarningMessage(
                    `确定要推送当前分支 [ ${pushInfo.currentBranch} ] 到远程仓库吗？\n\n推送会把本地提交发布到远程仓库，请确认提交内容无误。`,
                    { modal: true },
                    '确认推送',
                  );

                  if (confirm !== '确认推送') return;
                }

                await this.gitService.push(cwd, {
                  createUpstream: !pushInfo.hasUpstream,
                  branch: pushInfo.currentBranch,
                });

                vscode.window.showInformationMessage('🚀 推送成功！');

                this._view?.webview.postMessage({
                  type: 'clearJustCommitted',
                });

                this._view?.webview.postMessage({
                  type: 'stopGraphLoading',
                });

                await this.refreshStatus(cwd, false);

                this._view?.webview.postMessage({
                  type: 'stopGraphLoading',
                });

                void this.refreshGraphOnly(cwd);
                void this.checkRemoteSyncInBackground(cwd, { fetch: false });
              } catch (e: any) {
                await this.handleGitErrorWithConflictCheck(cwd, '推送 (Push)', e.message);
              }
            });

            break;
          }

          case 'open': {
            const fileUri = vscode.Uri.file(path.join(cwd, msg.file));
            vscode.commands.executeCommand('vscode.open', fileUri);
            break;
          }

          case 'stageAll': {
            await this.executeGitOperation(async () => {
              await this.gitService.stageAll(cwd);

              /**
               * 全部暂存后，所有工作区 diff tab 已经不再对应“未暂存更改”。
               * 这里关闭所有工作区 diff tab，避免继续显示旧对比。
               */
              await this.closeWorkingTreeDiffTabs(cwd);

              await this.refreshStatus(cwd, false);
            });

            break;
          }

          case 'stage': {
            await this.executeGitOperation(async () => {
              const result = await this.gitService.stageFile(cwd, msg.file, msg.status);

              if (result === 'discarded-empty-change') {
                vscode.window.showInformationMessage(`文件 ${msg.file} 无实质性内容更改，已自动剔除。`);
              }

              /**
               * 单文件暂存后，关闭该文件对应的工作区 diff tab。
               * 例如打开了 1.js 的工作区对比，点击暂存 1.js 后自动关闭该 diff。
               */
              await this.closeWorkingTreeDiffTabs(cwd, [msg.file]);

              await this.refreshStatus(cwd, false);
            });

            break;
          }

          case 'stageFiles': {
            const files = (msg as any).files as string[];

            if (!files || files.length === 0) break;

            await this.executeGitOperation(async () => {
              for (const file of files) {
                await this.gitService.stageFile(cwd, file);
              }

              await this.closeWorkingTreeDiffTabs(cwd, files);
              await this.refreshStatus(cwd, false);
              vscode.window.showInformationMessage(`✅ 已暂存 ${files.length} 个文件`);
            });

            break;
          }

          case 'discardFiles': {
            const files = (msg as any).files as string[];

            if (!files || files.length === 0) break;

            const confirm = await vscode.window.showWarningMessage(
              `是否确实要放弃 ${files.length} 个文件中的更改?\n\n此操作不可撤销！`,
              { modal: true },
              `放弃 ${files.length} 个文件`,
            );

            if (confirm !== `放弃 ${files.length} 个文件`) return;

            await this.executeGitOperation(async () => {
              for (const file of files) {
                await this.gitService.discardFile(cwd, file);
              }

              await this.closeWorkingTreeDiffTabs(cwd, files);
              await this.refreshStatus(cwd, false);
              vscode.window.showInformationMessage(`✅ 已放弃 ${files.length} 个文件的更改`);
            });

            break;
          }

          case 'unstageAll': {
            await this.executeGitOperation(async () => {
              await this.gitService.unstageAll(cwd);
              await this.refreshStatus(cwd, false);
            });

            break;
          }

          case 'discardAll': {
            const confirm = await vscode.window.showWarningMessage(
              `是否确实要放弃 ${msg.count} 个文件中的全部更改?\n\n此操作不可撤销！\n如果继续操作，你当前的工作集将永久丢失。`,
              {
                modal: true,
              },
              `放弃所有 ${msg.count} 个文件`,
            );

            if (confirm !== `放弃所有 ${msg.count} 个文件`) return;

            await this.executeGitOperation(async () => {
              await this.gitService.discardAll(cwd);
              await this.closeWorkingTreeDiffTabs(cwd);
              await this.refreshStatus(cwd, false);
            });

            break;
          }

          case 'discard': {
            const fileName = msg.file.split('/').pop() || msg.file;

            const confirm = await vscode.window.showWarningMessage(`是否确实要放弃 “${fileName}” 中的更改?`, { modal: true }, '放弃文件');

            if (confirm !== '放弃文件') return;

            await this.executeGitOperation(async () => {
              if (msg.status === 'U') {
                const fileUri = vscode.Uri.file(path.join(cwd, msg.file));

                await vscode.workspace.fs.delete(fileUri, {
                  recursive: true,
                  useTrash: true,
                });
              } else {
                await this.gitService.discardFile(cwd, msg.file, msg.status);
              }

              await this.closeWorkingTreeDiffTabs(cwd, [msg.file]);
              await this.refreshStatus(cwd, false);
            });

            break;
          }

          case 'unstage': {
            await this.executeGitOperation(async () => {
              await this.gitService.unstageFile(cwd, msg.file);
              await this.refreshStatus(cwd, false);
            });

            break;
          }

          case 'unstageFiles': {
            const files = (msg as any).files as string[];

            if (!files || files.length === 0) break;

            await this.executeGitOperation(async () => {
              for (const file of files) {
                await this.gitService.unstageFile(cwd, file);
              }

              await this.refreshStatus(cwd, false);
              vscode.window.showInformationMessage(`✅ 已取消暂存 ${files.length} 个文件`);
            });

            break;
          }

          case 'deleteWorkingFile': {
            const fileName = msg.file.split('/').pop() || msg.file;
            const fileUri = vscode.Uri.file(path.join(cwd, msg.file));

            const confirm = await vscode.window.showWarningMessage(`确定要删除文件 “${fileName}” 吗？\n\n文件会被移动到系统回收站/废纸篓。`, { modal: true }, '删除文件');

            if (confirm !== '删除文件') return;

            await this.executeGitOperation(async () => {
              try {
                await vscode.workspace.fs.delete(fileUri, {
                  recursive: true,
                  useTrash: true,
                });

                vscode.window.showInformationMessage(`🗑️ 已删除文件: ${fileName}`);

                await this.refreshStatus(cwd, false);
              } catch (e: any) {
                vscode.window.showErrorMessage(`删除文件失败: ${e?.message ?? String(e)}`);
              }
            });

            break;
          }

          case 'deleteWorkingFiles': {
            const files = (msg as any).files as string[];

            if (!files || files.length === 0) break;

            const confirm = await vscode.window.showWarningMessage(
              `确定要删除 ${files.length} 个文件吗？\n\n文件会被移动到系统回收站/废纸篓。`,
              { modal: true },
              `删除 ${files.length} 个文件`,
            );

            if (confirm !== `删除 ${files.length} 个文件`) return;

            await this.executeGitOperation(async () => {
              try {
                for (const file of files) {
                  const fileUri = vscode.Uri.file(path.join(cwd, file));

                  await vscode.workspace.fs.delete(fileUri, {
                    recursive: true,
                    useTrash: true,
                  });
                }

                vscode.window.showInformationMessage(`🗑️ 已删除 ${files.length} 个文件`);
                await this.refreshStatus(cwd, false);
              } catch (e: any) {
                vscode.window.showErrorMessage(`删除文件失败: ${e?.message ?? String(e)}`);
              }
            });

            break;
          }

          case 'getCommitChangeStats': {
            const stats = await this.getCommitChangeStats(cwd, msg.hash);

            this._view?.webview.postMessage({
              type: 'commitChangeStatsData',
              hash: msg.hash,
              ...stats,
            });

            break;
          }

          case 'getCommitFiles': {
            await this.withViewProgress(async () => {
              const result = await this.gitService.getCommitFiles(cwd, msg.hash);

              this._view?.webview.postMessage({
                type: 'commitFilesData',
                hash: result.hash,
                files: result.files,
                parentHash: result.parentHash,
              });
            });

            break;
          }

          case 'diffBranchFile': {
            const leftUri = this.createGitContentUri(cwd, msg.baseBranch, msg.file);

            const rightRef = msg.status === 'D' ? 'empty' : msg.targetBranch;
            const rightUri = this.createGitContentUri(cwd, rightRef, msg.file);

            const title = `${path.basename(msg.file)} (${msg.baseBranch} ↔ ${msg.targetBranch.substring(0, 7)})`;

            vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title);

            break;
          }

          case 'diffCommitFile': {
            const isWorkingTree = msg.hash === '__WORKING_TREE__';

            const leftRef = msg.parentHash || 'empty';
            const rightRef = msg.status === 'D' ? 'empty' : isWorkingTree ? 'working' : msg.hash;

            const leftUri = this.createGitContentUri(cwd, leftRef, msg.file);
            const rightUri = this.createGitContentUri(cwd, rightRef, msg.file);

            const title = isWorkingTree ? `${path.basename(msg.file)} (未提交更改)` : `${path.basename(msg.file)} (${msg.hash.substring(0, 7)})`;

            vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title);

            break;
          }

          case 'diffCommitFileWithLocalBranch': {
            if (!msg.hash) break;

            const fileUri = vscode.Uri.file(path.join(cwd, msg.file));
            const leftUri = this.createGitContentUri(cwd, msg.hash, msg.file);
            const defaultWorkspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            const isCurrentWorkspace = defaultWorkspace && cwd === defaultWorkspace;
            let rightUri = isCurrentWorkspace ? fileUri : this.createGitContentUri(cwd, 'working', msg.file);

            if (isCurrentWorkspace) {
              try {
                await vscode.workspace.fs.stat(fileUri);
              } catch {
                rightUri = this.createGitContentUri(cwd, 'empty', msg.file);
              }
            }

            const title = `${path.basename(msg.file)} (${msg.hash.substring(0, 7)} ↔ 当前分支)`;

            vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title);

            break;
          }

          case 'copy': {
            vscode.env.clipboard.writeText(msg.text);
            vscode.window.showInformationMessage(`已复制: ${msg.text}`);
            break;
          }

          case 'ignore': {
            await this.executeGitOperation(async () => {
              await this.gitService.addToGitignore(cwd, msg.file);
              vscode.window.showInformationMessage(`已将 ${msg.file} 添加到 .gitignore`);
              await this.refreshStatus(cwd, false);
            });

            break;
          }

          case 'ignoreFiles': {
            const files = (msg as any).files as string[];

            if (!files || files.length === 0) break;

            await this.executeGitOperation(async () => {
              for (const file of files) {
                await this.gitService.addToGitignore(cwd, file);
              }

              vscode.window.showInformationMessage(`✅ 已添加 ${files.length} 个文件到 .gitignore`);
              await this.refreshStatus(cwd, false);
            });

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
      .replace(/^remotes\//, '')
      .replace(/^refs\/tags\//, '')
      .trim();
  }

  private normalizeGraphFilterName(graphFilter: string) {
    const value = (graphFilter || this.gitService.CURRENT_BRANCH_FILTER).trim();

    if (!value || value === this.gitService.CURRENT_BRANCH_FILTER) {
      return this.gitService.CURRENT_BRANCH_FILTER;
    }

    if (value === this.gitService.ALL_BRANCH_FILTER || value === '全部分支') {
      return this.gitService.ALL_BRANCH_FILTER;
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

  /**
   * @description 获取所有远程跟踪分支可达的提交 Hash
   *
   * 使用 refs/remotes/* 的本地状态，不额外请求网络。
   */
  private async getRemoteCommitHashSet(cwd: string): Promise<Set<string>> {
    const output = await this.runGitSafe(cwd, ['rev-list', '--remotes']);

    return new Set(
      output
        .split(/\r?\n/)
        .map((hash) => hash.trim())
        .filter(Boolean),
    );
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
        isRemote: false,
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
      isRemote: false,
    };
  }

  private getGraphArgs(graphFilter: string, extraRefs: string[] = []) {
    const pretty = '%H%x1f%P%x1f%ct%x1f%an%x1f%ae%x1f%D%x1f%s';

    const commonArgs = ['log', '--date-order', '--decorate=full', '--parents', `--pretty=${pretty}`];

    const normalizedGraphFilter = this.normalizeGraphFilterName(graphFilter);

    if (normalizedGraphFilter === this.gitService.ALL_BRANCH_FILTER || normalizedGraphFilter === '全部分支') {
      return [...commonArgs, '--branches', '--remotes', '--tags', ...extraRefs];
    }

    if (!normalizedGraphFilter || normalizedGraphFilter === this.gitService.CURRENT_BRANCH_FILTER || normalizedGraphFilter === '当前分支') {
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

    const [allStashRows, remoteCommitHashSet] = await Promise.all([this.getStashRows(cwd), this.getRemoteCommitHashSet(cwd)]);

    const extraRefs = normalizedGraphFilter === this.gitService.ALL_BRANCH_FILTER || normalizedGraphFilter === '全部分支' ? this.getStashBaseParentHashes(allStashRows) : [];

    const output = await this.runGit(cwd, this.getGraphArgs(normalizedGraphFilter, extraRefs));

    const commits = (
      output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => this.parseLogLine(line))
        .filter(Boolean) as GitGraphLikeCommit[]
    ).map((commit) => ({
      ...commit,
      isRemote: remoteCommitHashSet.has(commit.hash),
    }));

    const commitHashSet = new Set(commits.map((commit) => commit.hash));

    const visibleStashRows =
      normalizedGraphFilter === this.gitService.ALL_BRANCH_FILTER || normalizedGraphFilter === '全部分支'
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

      /**
       * 保持现有统计口径：
       * 图形中显示的未提交行仍然计入 totalCommits。
       */
      totalCommits: uniqueRows.length,
    };
  }

  private async getGraphState(cwd: string) {
    try {
      /**
       * 注意：这里不要使用 show-ref 全量输出。
       * push / fetch 只会改变 refs/remotes/*，不会改变本地提交图谱。
       * 如果把远程 refs 也放进 graphState，push 成功后会被误判为图谱变化，
       * 进而触发 refreshStatus(cwd, true)，导致提交图区域长时间 loading。
       */
      const stateOutput = await this.runGitSafe(cwd, ['for-each-ref', '--format=%(refname) %(objectname)', 'HEAD', 'refs/heads', 'refs/tags', 'refs/stash']);

      const statusOutput = await this.runGitSafe(cwd, ['status', '--porcelain=v1', '-uall']);

      const stashOutput = await this.runGitSafe(cwd, ['stash', 'list', '--format=%gd %H']);

      return `${stateOutput}\n---STATUS---\n${statusOutput}\n---STASH---\n${stashOutput}`;
    } catch {
      return '';
    }
  }

  private async getCommitChangeStats(cwd: string, hash: string): Promise<{ filesChanged: number; insertions: number; deletions: number }> {
    if (hash === '__WORKING_TREE__') {
      return {
        filesChanged: await this.getWorkingTreeChangeCount(cwd),
        insertions: 0,
        deletions: 0,
      };
    }

    return new Promise((resolve) => {
      execFile(
        'git',
        ['-C', cwd, 'show', '--numstat', '--format=', '--find-renames', hash],
        {
          encoding: 'utf8',
          maxBuffer: 1024 * 1024 * 10,
        },
        (_error, stdout) => {
          const lines = String(stdout || '')
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean);

          let filesChanged = 0;
          let insertions = 0;
          let deletions = 0;

          lines.forEach((line) => {
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

          resolve({
            filesChanged,
            insertions,
            deletions,
          });
        },
      );
    });
  }

  private async refreshGraphOnly(cwd: string, graphFilter = this._currentGraphFilter) {
    if (!this._view) return;

    try {
      this._lastGraphState = await this.getGraphState(cwd);

      const graphData = await this.getGitGraphLikeData(cwd, graphFilter || this.gitService.CURRENT_BRANCH_FILTER);

      this._currentGraphFilter = graphData.graphFilter;

      this._view.webview.postMessage({
        type: 'graphData',
        graphCommits: graphData.graphCommits,
        graphFilter: graphData.graphFilter,
        totalCommits: graphData.totalCommits,
      });
    } catch (error: any) {
      this._view.webview.postMessage({
        type: 'error',
        message: error?.message || '刷新提交图失败',
      });
    }
  }

  private async refreshStatus(cwd: string, fullRefresh: boolean = true) {
    if (!this._view) return;

    if (this._isRefreshing) {
      const oldPending = this._pendingRefresh;

      this._pendingRefresh = {
        cwd,
        fullRefresh: fullRefresh || !!oldPending?.fullRefresh,
      };

      return;
    }

    this._isRefreshing = true;

    if (fullRefresh) {
      this._view.webview.postMessage({
        type: 'startLoading',
      });
    }

    const postEmptyGraphData = () => {
      this._view?.webview.postMessage({
        type: 'graphData',
        graphCommits: [],
        graphFilter: this._currentGraphFilter || this.gitService.CURRENT_BRANCH_FILTER,
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
        defaultCommitTypeEnabled: this.getDefaultCommitTypeEnabled(),
      });

      if (repoStatus.remoteUrl) {
        void this.checkRemoteSyncInBackground(cwd, {
          fetch: this.shouldFetchRemote(false),
        });
      }

      if (fullRefresh) {
        try {
          this._lastGraphState = await this.getGraphState(cwd);

          const graphData = await this.getGitGraphLikeData(cwd, this._currentGraphFilter || this.gitService.CURRENT_BRANCH_FILTER);

          this._currentGraphFilter = graphData.graphFilter;

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
      this._isRefreshing = false;

      const pending = this._pendingRefresh;
      this._pendingRefresh = null;

      if (pending) {
        setTimeout(() => {
          void this.refreshStatus(pending.cwd, pending.fullRefresh);
        }, 0);
      }
    }
  }

  private getHeadCommitMessage(cwd: string): Promise<string> {
    return new Promise((resolve) => {
      execFile(
        'git',
        ['-C', cwd, 'log', '-1', '--pretty=%B'],
        {
          encoding: 'utf8',
          maxBuffer: 1024 * 1024,
        },
        (error, stdout) => {
          if (error) {
            resolve('');
            return;
          }

          resolve(String(stdout || '').trim());
        },
      );
    });
  }

  private async handleCommit(cwd: string, message: string, skipVerify: boolean) {
    await this.gitService.commit(cwd, message, skipVerify);

    vscode.window.showInformationMessage('🎉 提交成功！');

    this._view?.webview.postMessage({
      type: 'commitSuccess',
    });

    await this.refreshStatus(cwd, true);
  }
}
