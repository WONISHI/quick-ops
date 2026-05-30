import * as vscode from 'vscode';
import * as path from 'path';
import { getReactWebviewHtml } from '../utils/WebviewHelper';
import GitService, { type GitFileItem } from '../services/GitService';

const GLOBAL_STATE_COMMIT_TYPE_ENABLED = 'quickOps.git.commitTypeEnabled';

export class GitWebviewProvider implements vscode.WebviewViewProvider {
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

  private readonly VIEW_ID = 'quickOps.gitView';
  private readonly gitService = new GitService();

  constructor(private readonly _extensionUri: vscode.Uri, private readonly _context: vscode.ExtensionContext) {
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

  private getDefaultCommitTypeEnabled(): boolean {
    return this._context.globalState.get<boolean>(GLOBAL_STATE_COMMIT_TYPE_ENABLED, false);
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

  private async checkRemoteSyncInBackground(cwd: string): Promise<void> {
    if (!this._view) return;
    if (this._isRemoteSyncChecking) return;

    this._isRemoteSyncChecking = true;

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
      this._isRemoteSyncChecking = false;

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
          currentState = await this.gitService.getGraphState(cwd);
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

        if (msg.command === 'toggleCommitTypeEnabled') {
          const nextValue = !!msg.value;

          await this._context.globalState.update(GLOBAL_STATE_COMMIT_TYPE_ENABLED, nextValue);

          this._view?.webview.postMessage({
            type: 'gitConfigChanged',
            defaultCommitTypeEnabled: nextValue,
          });

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
            defaultCommitTypeEnabled: this.getDefaultCommitTypeEnabled(),
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
                await this.gitService.stashPush(cwd, stashMsg);
                vscode.window.showInformationMessage('📦 已成功贮藏工作区更改。');
                await this.refreshStatus(cwd, false);
              } catch (e: any) {
                await this.handleGitErrorWithConflictCheck(cwd, '贮藏 (Stash)', e.message);
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
                await this.gitService.undoLastCommit(cwd);
                vscode.window.showInformationMessage('✅ 已撤销最近一次提交，更改已退回工作区。');
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

                  await this.executeGitOperation(async () => {
                    try {
                      const localBranchName = await this.gitService.checkoutRemoteBranch(cwd, selected.remoteBranchName);

                      vscode.window.showInformationMessage(`✅ 已切换到分支: ${localBranchName}`);

                      await this.refreshStatus(cwd, true);
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

                const items = localBranches.map((branchName) => ({
                  label: branchName,
                  description: branchName === currentBranch ? '当前分支' : undefined,
                  branchName,
                  buttons: [copyBtn, remoteOpBtn],
                }));

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

                  await this.executeGitOperation(async () => {
                    try {
                      await this.gitService.checkoutBranch(cwd, selected.branchName);

                      vscode.window.showInformationMessage(`✅ 已切换到分支: ${selected.branchName}`);

                      await this.refreshStatus(cwd, true);
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

              const items = mergeableBranches.map((b) => ({
                label: b,
                branchName: b,
              }));

              const selected = await vscode.window.showQuickPick(items, {
                placeHolder: `请选择要合并到【${current}】的本地分支`,
                matchOnDescription: true,
              });

              if (!selected) return;

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
              const currentOption = this.gitService.CURRENT_BRANCH_FILTER;
              const allOption = this.gitService.ALL_BRANCH_FILTER;

              const quickPick = vscode.window.createQuickPick<vscode.QuickPickItem & { branchName: string }>();

              quickPick.placeholder = '选择要查看的分支记录 (支持搜索)';
              quickPick.matchOnDescription = true;

              const updateQuickPickItems = async () => {
                await this.withViewProgress(async () => {
                  const branchNames = await this.gitService.getAllBranches(cwd);

                  const items = [currentOption, allOption, ...branchNames].map((b) => ({
                    label: b === msg.current ? `$(check) ${b}` : b,
                    description: b === msg.current ? '当前选择' : undefined,
                    branchName: b,
                  }));

                  const prevActive = quickPick.activeItems[0]?.branchName;

                  quickPick.items = items;

                  if (prevActive) {
                    const newActive = items.find((i) => i.branchName === prevActive);

                    if (newActive) {
                      quickPick.activeItems = [newActive];
                    }
                  } else {
                    const currentItem = items.find((i) => i.branchName === msg.current);

                    if (currentItem) {
                      quickPick.activeItems = [currentItem];
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

              await this.withViewProgress(async () => {
                const graphData = await this.gitService.getGraph(cwd, selectedBranch);

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

                baseBranch = await new Promise<string | undefined>((resolve) => {
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

                await this.withViewProgress(async () => {
                  const branchesAfterFetch = await this.gitService.getAllBranches(cwd);
                  const branchNamesAfterFetch = branchesAfterFetch.filter((b) => b !== baseBranch);

                  targetBranch = await vscode.window.showQuickPick(branchNamesAfterFetch, {
                    placeHolder: `2/2: 请选择【目标分支】(查看 ${baseBranch} 中没有的记录)`,
                    matchOnDescription: true,
                  });
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
                vscode.window.showInformationMessage('正在拉取代码...');

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
                  const confirm = await vscode.window.showInformationMessage(
                    `当前分支 [ ${pushInfo.currentBranch} ] 尚未在远程仓库建立跟踪，是否要创建对应的远程分支并推送？`,
                    {
                      modal: true,
                    },
                    '创建远程分支并推送',
                  );

                  if (confirm !== '创建远程分支并推送') return;
                }

                vscode.window.showInformationMessage('正在推送到远程...');

                await this.gitService.push(cwd, {
                  createUpstream: !pushInfo.hasUpstream,
                  branch: pushInfo.currentBranch,
                });

                vscode.window.showInformationMessage('🚀 推送成功！');

                this._view?.webview.postMessage({
                  type: 'clearJustCommitted',
                });

                await this.refreshStatus(cwd, true);
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

              await this.refreshStatus(cwd, false);
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

          case 'deleteWorkingFile': {
            const fileName = msg.file.split('/').pop() || msg.file;
            const fileUri = vscode.Uri.file(path.join(cwd, msg.file));

            const confirm = await vscode.window.showWarningMessage(
              `确定要删除文件 “${fileName}” 吗？\n\n文件会被移动到系统回收站/废纸篓。`,
              { modal: true },
              '删除文件',
            );

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
            const leftUri = this.createGitContentUri(cwd, msg.parentHash || 'empty', msg.file);

            const rightRef = msg.status === 'D' ? 'empty' : msg.hash;
            const rightUri = this.createGitContentUri(cwd, rightRef, msg.file);

            const title = `${path.basename(msg.file)} (${msg.hash.substring(0, 7)})`;

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
        defaultCommitTypeEnabled: this.getDefaultCommitTypeEnabled(),
      });

      if (repoStatus.remoteUrl) {
        void this.checkRemoteSyncInBackground(cwd);
      }

      if (fullRefresh) {
        try {
          this._lastGraphState = await this.gitService.getGraphState(cwd);

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

  private async handleCommit(cwd: string, message: string, skipVerify: boolean) {
    await this.gitService.commit(cwd, message, skipVerify);

    vscode.window.showInformationMessage('🎉 提交成功！');

    this._view?.webview.postMessage({
      type: 'commitSuccess',
    });

    await this.refreshStatus(cwd, true);
  }
}