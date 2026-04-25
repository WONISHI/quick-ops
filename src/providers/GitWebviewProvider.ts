import * as vscode from 'vscode';
import simpleGit, { SimpleGit } from 'simple-git';
import path from 'path';
import { getReactWebviewHtml } from '../utils/WebviewHelper';
import { exec } from 'child_process';

export class GitWebviewProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;

  private _isInternalOp = false;
  private _internalOpTimer: NodeJS.Timeout | null = null;
  private _gitWatchers: vscode.Disposable[] = [];

  private _isRefreshing = false;
  private _debounceTimer: NodeJS.Timeout | null = null;
  private _lastGraphState = '';

  private readonly VIEW_ID = 'quickOps.gitView';

  constructor(private readonly _extensionUri: vscode.Uri) {
    const gitDiffProvider = new (class implements vscode.TextDocumentContentProvider {
      async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
        try {
          const params = JSON.parse(decodeURIComponent(uri.query));
          const cwd = params.cwd;
          const ref = params.ref || 'HEAD';
          const filepath = uri.path.substring(1);

          if (ref === 'empty') return '';

          const git: SimpleGit = simpleGit(cwd);
          const content = await git.show([`${ref}:${filepath}`]);
          return content;
        } catch (e) {
          return '';
        }
      }
    })();
    vscode.workspace.registerTextDocumentContentProvider('quickops-git', gitDiffProvider);
  }

  private async withViewProgress<T>(task: () => Promise<T>): Promise<T> {
    return vscode.window.withProgress({ location: { viewId: this.VIEW_ID } }, async () => {
      return await task();
    });
  }

  private checkGitInstalled(): Promise<boolean> {
    return new Promise((resolve) => {
      exec('git --version', (error) => {
        resolve(!error);
      });
    });
  }

  private async executeGitOperation(operation: () => Promise<void> | void) {
    this._isInternalOp = true;
    if (this._internalOpTimer) clearTimeout(this._internalOpTimer);

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

  // 🌟 核心拦截器：只提示，文件展示交给侧边栏的“冲突区”
  private async handleGitErrorWithConflictCheck(cwd: string, operationName: string, originalErrorMsg: string) {
    try {
      const git = simpleGit(cwd);
      const status = await git.status();
      const conflicts = status.conflicted;

      if (conflicts.length > 0) {
        vscode.window.showWarningMessage(
          `【${operationName}】产生冲突！\n共检测到 ${conflicts.length} 个冲突文件，请在侧边栏的【冲突区】中逐一解决。`
        );
        // 唤起原生 SCM 面板作为辅助
        vscode.commands.executeCommand('workbench.view.scm');
      } else {
        vscode.window.showErrorMessage(`${operationName} 失败: ${originalErrorMsg}`);
      }
    } catch (e) {
      vscode.window.showErrorMessage(`${operationName} 失败: ${originalErrorMsg}`);
    }

    await this.refreshStatus(cwd, false);
  }

  private async setupGitWatcher() {
    const gitExtension = vscode.extensions.getExtension('vscode.git');
    if (!gitExtension) return;

    try {
      if (!gitExtension.isActive) await gitExtension.activate();
    } catch (e) {
      return;
    }

    const gitApi = gitExtension.exports?.getAPI(1);
    if (!gitApi) return;

    const onStateChange = () => {
      if (this._isInternalOp) return;
      if (this._debounceTimer) clearTimeout(this._debounceTimer);

      this._debounceTimer = setTimeout(async () => {
        if (this._isInternalOp) return;
        if (this._isRefreshing) return;

        const cwd = this.getWorkspaceRoot();
        if (cwd) {
          const git = simpleGit(cwd);
          let currentState = '';

          try {
            const refs = await git.raw(['show-ref']).catch(() => '');
            const head = await git.raw(['rev-parse', 'HEAD']).catch(() => '');
            currentState = refs + head;
          } catch (e) { }

          const graphChanged = currentState !== this._lastGraphState;

          if (graphChanged) {
            this._lastGraphState = currentState;
          }

          this.refreshStatus(cwd, graphChanged);
        }
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

  public resolveWebviewView(webviewView: vscode.WebviewView, context: vscode.WebviewViewResolveContext, _token: vscode.CancellationToken) {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true, localResourceRoots: [this._extensionUri] };
    webviewView.webview.html = getReactWebviewHtml(this._extensionUri, webviewView.webview, '/git');

    this.setupGitWatcher();

    const editorListener = vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor && this._view && editor.document.uri.scheme === 'file') {
        const cwd = this.getWorkspaceRoot();
        if (cwd) {
          const relativePath = path.relative(cwd, editor.document.uri.fsPath).replace(/\\/g, '/');
          this._view.webview.postMessage({ type: 'activeEditorChanged', file: relativePath });
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

        if (msg.command === 'webviewLoaded' || msg.command === 'refresh') {
          const isInstalled = await this.checkGitInstalled();

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
            this._view?.webview.postMessage({ type: 'noWorkspace' });
          }
          return;
        }

        const git: SimpleGit = simpleGit(cwd);

        switch (msg.command) {
          case 'webviewLoaded':
          case 'refresh':
            await this.refreshStatus(cwd, true);
            if (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri.scheme === 'file') {
              const relativePath = path.relative(cwd, vscode.window.activeTextEditor.document.uri.fsPath).replace(/\\/g, '/');
              this._view?.webview.postMessage({ type: 'activeEditorChanged', file: relativePath });
            }
            break;

          case 'refreshStatusOnly':
            await this.refreshStatus(cwd, false);
            break;

          case 'stash': {
            const stashMsg = await vscode.window.showInputBox({
              prompt: '请输入贮藏备注 (留空将自动生成系统默认备注)',
              placeHolder: '例如: 暂存前端开发进度',
            });

            if (stashMsg === undefined) return;

            await this.executeGitOperation(async () => {
              try {
                if (stashMsg.trim()) {
                  await git.stash(['push', '-m', stashMsg]);
                } else {
                  await git.stash(['push']);
                }
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
                const stashHash = `stash@{${msg.index}}`;
                const parentHash = `${stashHash}^1`;
                const diffRaw = await git.raw(['diff', '--name-status', parentHash, stashHash]);

                const files = diffRaw
                  .split('\n')
                  .filter((line) => line.trim())
                  .map((line) => {
                    const parts = line.split('\t');
                    return { status: parts[0].charAt(0), file: parts[parts.length - 1] };
                  });

                this._view?.webview.postMessage({
                  type: 'stashFilesData',
                  index: msg.index,
                  hash: stashHash,
                  parentHash,
                  files
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
                await git.stash(['apply', `stash@{${msg.index}}`]);
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
                await git.stash(['pop', `stash@{${msg.index}}`]);
                vscode.window.showInformationMessage(`✅ 已弹出并删除贮藏 stash@{${msg.index}}`);
                await this.refreshStatus(cwd, false);
              } catch (e: any) {
                await this.handleGitErrorWithConflictCheck(cwd, '弹出贮藏', e.message);
              }
            });
            break;
          }

          case 'stashDrop': {
            const confirm = await vscode.window.showWarningMessage(
              `确定要永久删除贮藏 stash@{${msg.index}} 吗？\n此操作不可撤销！`,
              { modal: true },
              '删除贮藏'
            );
            if (confirm !== '删除贮藏') return;

            await this.executeGitOperation(async () => {
              try {
                await git.stash(['drop', `stash@{${msg.index}}`]);
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
                await git.reset(['--mixed', 'HEAD~1']);
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
                await git.checkoutLocalBranch(newBranchName);
                vscode.window.showInformationMessage(`✅ 已成功创建并切换到新分支: ${newBranchName}`);
                await this.refreshStatus(cwd, true);
              });
            } catch (e: any) {
              vscode.window.showErrorMessage(`创建新分支失败: ${e.message}`);
            }
            break;
          }

          case 'checkoutBranch': {
            try {
              let localBranches: string[] = [];
              let currentBranch = '';

              await this.withViewProgress(async () => {
                const branchSummary = await git.branchLocal();
                localBranches = branchSummary.all;
                currentBranch = branchSummary.current;
              });

              const items = localBranches.map((b) => ({
                label: b === currentBranch ? `$(check) ${b}` : b,
                description: b === currentBranch ? '当前分支' : undefined,
                branchName: b,
              }));

              const selected = await vscode.window.showQuickPick(items, {
                placeHolder: '请选择要切换到的本地分支',
                matchOnDescription: true,
              });

              if (!selected || selected.branchName === currentBranch) return;

              await this.executeGitOperation(async () => {
                await git.checkout(selected.branchName);
                vscode.window.showInformationMessage(`✅ 已切换到分支: ${selected.branchName}`);
                await this.refreshStatus(cwd, true);
              });
            } catch (e: any) {
              vscode.window.showErrorMessage(`切换分支失败: ${e.message}`);
            }
            break;
          }

          case 'mergeBranch': {
            try {
              let mergeableBranches: string[] = [];
              let currentBranch = '';

              await this.withViewProgress(async () => {
                const branchSummary = await git.branchLocal();
                currentBranch = branchSummary.current;
                mergeableBranches = branchSummary.all.filter((b) => b !== currentBranch);
              });

              if (mergeableBranches.length === 0) {
                vscode.window.showInformationMessage('没有其他本地分支可供合并');
                return;
              }

              const items = mergeableBranches.map((b) => ({
                label: b,
                branchName: b,
              }));

              const selected = await vscode.window.showQuickPick(items, {
                placeHolder: `请选择要合并到【${currentBranch}】的本地分支`,
                matchOnDescription: true,
              });

              if (!selected) return;

              await this.executeGitOperation(async () => {
                try {
                  await git.merge([selected.branchName]);
                  vscode.window.showInformationMessage(`🎉 已成功将 ${selected.branchName} 合并到 ${currentBranch}`);
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
              const allOption = '全部分支';

              const quickPick = vscode.window.createQuickPick<vscode.QuickPickItem & { branchName: string }>();
              quickPick.placeholder = '选择要查看的分支记录 (支持搜索)';
              quickPick.matchOnDescription = true;

              const updateQuickPickItems = async () => {
                await this.withViewProgress(async () => {
                  const branches = await git.branch(['-a']);
                  const branchNames = branches.all.filter((b) => !b.includes('->'));
                  const items = [allOption, ...branchNames].map((b) => ({
                    label: b === msg.current ? `$(check) ${b}` : b,
                    description: b === msg.current ? '当前选择' : undefined,
                    branchName: b,
                  }));

                  const prevActive = quickPick.activeItems[0]?.branchName;
                  quickPick.items = items;

                  if (prevActive) {
                    const newActive = items.find((i) => i.branchName === prevActive);
                    if (newActive) quickPick.activeItems = [newActive];
                  } else {
                    const currentItem = items.find((i) => i.branchName === msg.current);
                    if (currentItem) quickPick.activeItems = [currentItem];
                  }
                });
              };

              await updateQuickPickItems();
              quickPick.show();

              quickPick.busy = true;
              this.executeGitOperation(async () => {
                try {
                  await git.fetch(['--all', '--prune']);
                  await updateQuickPickItems();
                } catch (e) { }
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
                const logOptions: any = {
                  '--topo-order': null,
                  format: { hash: '%H', parents: '%P', author: '%an', email: '%ae', message: '%s', timestamp: '%ct', refs: '%D' },
                  maxCount: 5000,
                };

                if (selectedBranch === allOption) {
                  logOptions['--all'] = null;
                } else {
                  logOptions[selectedBranch] = null;
                }

                const logRaw = await git.log(logOptions);
                const graphCommits = logRaw.all.map((c: any) => ({
                  hash: c.hash,
                  parents: c.parents ? (c.parents as string).split(' ').filter(Boolean) : [],
                  author: c.author,
                  email: c.email,
                  message: c.message,
                  refs: c.refs || '',
                  timestamp: parseInt(c.timestamp as string, 10) * 1000,
                }));

                this._view?.webview.postMessage({
                  type: 'graphData',
                  graphCommits,
                  graphFilter: selectedBranch,
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
                const logOptions: any = {
                  '--topo-order': null,
                  format: { hash: '%H', author: '%an', message: '%s', timestamp: '%ct' },
                  maxCount: 5000,
                  file: msg.file,
                };

                const logRaw = await git.log(logOptions);
                const commits = logRaw.all.map((c: any) => ({
                  hash: c.hash,
                  author: c.author,
                  message: c.message,
                  timestamp: parseInt(c.timestamp as string, 10) * 1000,
                }));

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
                  const branches = await git.branch(['-a']);
                  const branchNames = branches.all.filter((b) => !b.includes('->'));

                  const prevActive = quickPick.activeItems[0]?.branchName;
                  const items = branchNames.map((b) => ({ label: b, branchName: b }));

                  quickPick.items = items;
                  if (prevActive) {
                    const newActive = items.find((i) => i.branchName === prevActive);
                    if (newActive) quickPick.activeItems = [newActive];
                  }
                });
              };

              await updateQuickPickItems();
              quickPick.show();

              quickPick.busy = true;
              this.executeGitOperation(async () => {
                try {
                  await git.fetch(['--all', '--prune']);
                  await updateQuickPickItems();
                } catch (e) { }
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
                const branchesAfterFetch = await git.branch(['-a']);
                const branchNamesAfterFetch = branchesAfterFetch.all.filter((b) => !b.includes('->') && b !== baseBranch);

                targetBranch = await vscode.window.showQuickPick(branchNamesAfterFetch, {
                  placeHolder: `2/2: 请选择【目标分支】(查看 ${baseBranch} 中没有的记录)`,
                  matchOnDescription: true,
                });
              });

              if (!targetBranch) return;

              await this.withViewProgress(async () => {
                const logOptions = {
                  from: baseBranch,
                  to: targetBranch,
                  format: { hash: '%H', author: '%an', message: '%s', timestamp: '%ct' },
                };

                const logResult = await git.log(logOptions);
                const commits = logResult.all.map((c) => ({
                  hash: c.hash,
                  author: c.author,
                  message: c.message,
                  timestamp: parseInt(c.timestamp as string, 10) * 1000,
                }));

                this._view?.webview.postMessage({ type: 'compareData', baseBranch, targetBranch, commits });
              });
            } catch (e: any) {
              vscode.window.showErrorMessage(`对比分支失败: ${e.message}`);
            }
            break;
          }

          case 'compareFileAcrossBranches': {
            try {
              const quickPick = vscode.window.createQuickPick<vscode.QuickPickItem & { branchName: string }>();
              quickPick.placeholder = '1/2: 请选择【基准分支】(Base Branch，支持远程分支)';
              quickPick.matchOnDescription = true;

              const updateQuickPickItems = async () => {
                await this.withViewProgress(async () => {
                  const branches = await git.branch(['-a']);
                  const branchNames = branches.all.filter((b) => !b.includes('->'));
                  const prevActive = quickPick.activeItems[0]?.branchName;
                  const items = branchNames.map((b) => ({ label: b, branchName: b }));
                  quickPick.items = items;
                  if (prevActive) {
                    const newActive = items.find((i) => i.branchName === prevActive);
                    if (newActive) quickPick.activeItems = [newActive];
                  }
                });
              };

              await updateQuickPickItems();
              quickPick.show();

              quickPick.busy = true;
              this.executeGitOperation(async () => {
                try {
                  await git.fetch(['--all', '--prune']);
                  await updateQuickPickItems();
                } catch (e) { }
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
                const branchesAfterFetch = await git.branch(['-a']);
                const branchNamesAfterFetch = branchesAfterFetch.all.filter((b) => !b.includes('->') && b !== baseBranch);

                targetBranch = await vscode.window.showQuickPick(branchNamesAfterFetch, {
                  placeHolder: `2/2: 请选择【目标分支】(查看 ${baseBranch} 中没有的记录)`,
                  matchOnDescription: true,
                });
              });

              if (!targetBranch) return;

              await this.withViewProgress(async () => {
                const logOptions = {
                  from: baseBranch,
                  to: targetBranch,
                  format: { hash: '%H', author: '%an', message: '%s', timestamp: '%ct' },
                };
                const logResult = await git.log(logOptions);
                const commits = logResult.all.map((c) => ({
                  hash: c.hash,
                  author: c.author,
                  message: c.message,
                  timestamp: parseInt(c.timestamp as string, 10) * 1000,
                }));

                this._view?.webview.postMessage({ type: 'compareData', baseBranch, targetBranch, commits });
              });

              await this.withViewProgress(async () => {
                // @ts-ignore
                const diffRaw = await git.raw(['diff', '--name-status', baseBranch, targetBranch]);
                const diffFiles = diffRaw
                  .split('\n')
                  .filter((line) => line.trim())
                  .map((line) => {
                    const parts = line.split('\t');
                    return {
                      status: parts[0].charAt(0),
                      file: parts[parts.length - 1],
                    };
                  });

                if (diffFiles.length === 0) {
                  vscode.window.showInformationMessage(`分支 ${baseBranch} 和 ${targetBranch} 之间没有任何文件差异。`);
                  return;
                }

                const changesArgs = diffFiles.map((f) => {
                  let leftRef = baseBranch;
                  let rightRef = targetBranch;

                  if (f.status === 'A') leftRef = 'empty';
                  if (f.status === 'D') rightRef = 'empty';

                  const leftQuery = encodeURIComponent(JSON.stringify({ cwd, ref: leftRef }));
                  const leftUri = vscode.Uri.parse(`quickops-git:///${f.file}?${leftQuery}`);

                  const rightQuery = encodeURIComponent(JSON.stringify({ cwd, ref: rightRef }));
                  const rightUri = vscode.Uri.parse(`quickops-git:///${f.file}?${rightQuery}`);

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
              const diffRaw = await git.raw(['diff-tree', '--no-commit-id', '--name-status', '-r', '--root', msg.hash]);
              const files = diffRaw
                .split('\n')
                .filter((line) => line.trim())
                .map((line) => {
                  const parts = line.split('\t');
                  return { status: parts[0].charAt(0), file: parts[parts.length - 1] };
                });

              let parentOid: string | undefined;
              try {
                parentOid = (await git.raw(['rev-parse', `${msg.hash}^1`])).trim();
              } catch (e) {
                parentOid = undefined;
              }

              if (files.length > 0) {
                const changesArgs = files.map((f) => {
                  let leftRef = parentOid ? parentOid : 'empty';
                  let rightRef = msg.hash;

                  if (f.status === 'A') leftRef = 'empty';
                  if (f.status === 'D') rightRef = 'empty';

                  const leftQuery = encodeURIComponent(JSON.stringify({ cwd, ref: leftRef }));
                  const leftUri = vscode.Uri.parse(`quickops-git:///${f.file}?${leftQuery}`);

                  const rightQuery = encodeURIComponent(JSON.stringify({ cwd, ref: rightRef }));
                  const rightUri = vscode.Uri.parse(`quickops-git:///${f.file}?${rightQuery}`);

                  const fileUri = vscode.Uri.file(path.join(cwd, f.file));

                  return [fileUri, leftUri, rightUri];
                });

                const title = `Commit: ${msg.hash.substring(0, 7)}`;
                await vscode.commands.executeCommand('vscode.changes', title, changesArgs);
              }
            });
            break;
          }

          // 🌟 修改点：支持原生打开冲突文件
          case 'diff': {
            const fileUri = vscode.Uri.file(path.join(cwd, msg.file));

            if (msg.status === 'C') {
              // 1. 冲突文件：必须直接打开，交由 VS Code 原生三向合并工具接管
              vscode.commands.executeCommand('vscode.open', fileUri);
            } else if (msg.status === 'U' || msg.status === 'A') {
              // 2. 🌟 新增的优化：全新文件也展示对比视图！(左侧设为 empty 虚拟文件，右侧为当前文件)
              const query = encodeURIComponent(JSON.stringify({ cwd, ref: 'empty' }));
              const emptyUri = vscode.Uri.parse(`quickops-git:///${msg.file}?${query}`);
              vscode.commands.executeCommand('vscode.diff', emptyUri, fileUri, `${msg.file} (未跟踪)`);
            } else {
              // 3. 被修改的文件 (M, D等)：正常对比 HEAD 历史版本
              const query = encodeURIComponent(JSON.stringify({ cwd, ref: 'HEAD' }));
              const originalUri = vscode.Uri.parse(`quickops-git:///${msg.file}?${query}`);
              vscode.commands.executeCommand('vscode.diff', originalUri, fileUri, `${msg.file} (工作树)`);
            }
            break;
          }

          case 'commit':
            await this.executeGitOperation(async () => {
              await this.handleCommit(cwd, msg.message, msg.skipVerify);
            });
            break;

          case 'pull':
            await this.executeGitOperation(async () => {
              try {
                vscode.window.showInformationMessage('正在拉取代码...');
                await git.pull();
                vscode.window.showInformationMessage('⬇️ 拉取成功！');
                this._view?.webview.postMessage({ type: 'clearJustCommitted' });
                await this.refreshStatus(cwd, true);
              } catch (e: any) {
                await this.handleGitErrorWithConflictCheck(cwd, '拉取 (Pull)', e.message);
              }
            });
            break;

          case 'push':
            await this.executeGitOperation(async () => {
              vscode.window.showInformationMessage('正在推送到远程...');
              await git.push(['-u', 'origin', 'HEAD']);
              vscode.window.showInformationMessage('🚀 推送成功！');
              this._view?.webview.postMessage({ type: 'clearJustCommitted' });
              await this.refreshStatus(cwd, true);
            });
            break;

          case 'open': {
            const fileUri = vscode.Uri.file(path.join(cwd, msg.file));
            vscode.commands.executeCommand('vscode.open', fileUri);
            break;
          }

          case 'stageAll': {
            await this.executeGitOperation(async () => {
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

              if (filesToAdd.length > 0) await git.add(filesToAdd);
              if (filesToDelete.length > 0) await git.rm(filesToDelete);

              await this.refreshStatus(cwd, false);
            });
            break;
          }

          // 🌟 核心修改：允许 C(冲突) 状态的文件被暂存
          case 'stage': {
            await this.executeGitOperation(async () => {
              if (msg.status === 'D') {
                await git.rm([msg.file]);
              } else if (msg.status === '?' || msg.status === 'U' || msg.status === 'C') {
                await git.add([msg.file]);
              } else {
                const diff = await git.diff(['--', msg.file]);
                if (!diff.trim()) {
                  await git.checkout(['--', msg.file]);
                  vscode.window.showInformationMessage(`文件 ${msg.file} 无实质性内容更改，已自动剔除。`);
                } else {
                  await git.add([msg.file]);
                }
              }
              await this.refreshStatus(cwd, false);
            });
            break;
          }

          case 'unstageAll': {
            await this.executeGitOperation(async () => {
              try {
                await git.reset(['HEAD']);
              } catch (e) {
                console.log('err', e);
                await git.raw(['rm', '--cached', '-r', '.']);
              }
              await this.refreshStatus(cwd, false);
            });
            break;
          }

          case 'discardAll': {
            const confirm = await vscode.window.showWarningMessage(
              `是否确实要放弃 ${msg.count} 个文件中的全部更改?\n\n此操作不可撤销！\n如果继续操作，你当前的工作集将永久丢失。`,
              { modal: true },
              `放弃所有 ${msg.count} 个文件`,
            );
            if (confirm !== `放弃所有 ${msg.count} 个文件`) return;

            await this.executeGitOperation(async () => {
              await git.checkout(['--', '.']);
              await git.clean('f', ['-d']);
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
                await vscode.workspace.fs.delete(fileUri, { useTrash: true });
              } else {
                await git.checkout(['--', msg.file]);
              }
              await this.refreshStatus(cwd, false);
            });
            break;
          }

          case 'unstage': {
            await this.executeGitOperation(async () => {
              try {
                await git.reset(['HEAD', '--', msg.file]);
              } catch (e) {
                await git.raw(['rm', '--cached', '--', msg.file]);
              }
              await this.refreshStatus(cwd, false);
            });
            break;
          }

          case 'diffBranchFile': {
            const leftQuery = encodeURIComponent(JSON.stringify({ cwd, ref: msg.baseBranch }));
            const leftUri = vscode.Uri.parse(`quickops-git:///${msg.file}?${leftQuery}`);

            const rightRef = msg.status === 'D' ? 'empty' : msg.targetBranch;
            const rightQuery = encodeURIComponent(JSON.stringify({ cwd, ref: rightRef }));
            const rightUri = vscode.Uri.parse(`quickops-git:///${msg.file}?${rightQuery}`);

            const title = `${path.basename(msg.file)} (${msg.baseBranch} ↔ ${msg.targetBranch.substring(0, 7)})`;
            vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title);
            break;
          }

          case 'copy':
            vscode.env.clipboard.writeText(msg.text);
            vscode.window.showInformationMessage(`已复制: ${msg.text}`);
            break;

          case 'ignore': {
            await this.executeGitOperation(async () => {
              const gitignoreUri = vscode.Uri.file(path.join(cwd, '.gitignore'));
              let existingContent = Buffer.alloc(0);
              try {
                existingContent = Buffer.from(await vscode.workspace.fs.readFile(gitignoreUri));
              } catch (e) { }

              const appendStr = existingContent.length > 0 ? `\n${msg.file}` : msg.file;
              const appendContent = Buffer.from(appendStr, 'utf8');
              const newContent = Buffer.concat([existingContent, appendContent]);

              await vscode.workspace.fs.writeFile(gitignoreUri, newContent);
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
        this._view?.webview.postMessage({ type: 'error', message: error.message });
      }
    });
  }

  private async refreshStatus(cwd: string, fullRefresh: boolean = true) {
    if (!this._view) return;
    if (this._isRefreshing) return;
    this._isRefreshing = true;

    if (fullRefresh) this._view.webview.postMessage({ type: 'startLoading' });

    const git: SimpleGit = simpleGit(cwd);

    const doRefresh = async () => {
      const isRepo = await git.checkIsRepo();
      if (!isRepo) {
        this._view?.webview.postMessage({ type: 'notRepo' });
        return;
      }

      const branchPromise = git.branchLocal().then((b) => b.current).catch(() => 'HEAD');
      const remoteUrlPromise = git.listRemote(['--get-url']).then((r) => r.trim()).catch(() => '');
      const statusPromise = git.status();
      const stashPromise = git.stashList().catch(() => ({ all: [] }));

      const branch = await branchPromise;
      const remoteUrl = await remoteUrlPromise;
      const status = await statusPromise;
      const stashRaw = await stashPromise;

      // 🌟 核心修改：分离冲突文件
      const conflictedFiles: { status: string; file: string }[] = [];
      const stagedFiles: { status: string; file: string }[] = [];
      const unstagedFiles: { status: string; file: string }[] = [];

      status.files.forEach((file) => {
        if (status.conflicted.includes(file.path)) {
          conflictedFiles.push({ status: 'C', file: file.path });
          return;
        }

        if (file.index !== ' ' && file.index !== '?') {
          stagedFiles.push({ status: file.index, file: file.path });
        }
        if (file.working_dir !== ' ') {
          let s = file.working_dir;
          if (s === '?') s = 'U';
          unstagedFiles.push({ status: s, file: file.path });
        }
      });

      const stashes = stashRaw.all.map((s, idx) => ({
        index: idx,
        message: s.message
      }));

      this._view?.webview.postMessage({
        type: 'statusData',
        stagedFiles,
        unstagedFiles,
        conflictedFiles, // 🌟 推送新增的 conflictedFiles
        branch,
        remoteUrl,
        folderName: path.basename(cwd),
        stashes,
      });

      if (fullRefresh) {
        try {
          const refs = await git.raw(['show-ref']).catch(() => '');
          const head = await git.raw(['rev-parse', 'HEAD']).catch(() => '');
          this._lastGraphState = refs + head;
        } catch (e) { }

        const logOptions = {
          '--all': null,
          '--topo-order': null,
          format: { hash: '%H', parents: '%P', author: '%an', email: '%ae', message: '%s', timestamp: '%ct', refs: '%D' },
          maxCount: 5000,
        };

        const logRaw = await git.log(logOptions);
        const graphCommits = logRaw.all.map((c: any) => ({
          hash: c.hash,
          parents: c.parents ? (c.parents as string).split(' ').filter(Boolean) : [],
          author: c.author,
          email: c.email,
          message: c.message,
          refs: c.refs || '',
          timestamp: parseInt(c.timestamp as string, 10) * 1000,
        }));

        this._view?.webview.postMessage({ type: 'graphData', graphCommits, graphFilter: '全部分支' });
      }
    };

    try {
      if (fullRefresh) {
        await this.withViewProgress(doRefresh);
      } else {
        await doRefresh();
      }
    } catch (e: any) {
      this._view?.webview.postMessage({ type: 'notRepo' });
    } finally {
      this._isRefreshing = false;
    }
  }

  private async handleCommit(cwd: string, message: string, skipVerify: boolean) {
    const git: SimpleGit = simpleGit(cwd);
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
    vscode.window.showInformationMessage('🎉 提交成功！');

    this._view?.webview.postMessage({ type: 'commitSuccess' });

    await this.refreshStatus(cwd, true);
  }

  private getWorkspaceRoot(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }
}