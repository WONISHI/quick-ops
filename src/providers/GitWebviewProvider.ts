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

  // 🌟 检测 Git 是否安装
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
      // 🌟 3. 在所有写操作中自动应用视图进度条
      await this.withViewProgress(async () => {
        await operation();
      });
    } finally {
      this._internalOpTimer = setTimeout(() => {
        this._isInternalOp = false;
      }, 1500);
    }
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
          } catch (e) {}

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

    // 🌟 核心升级：实时监听 VS Code 全局设置的改变
    const configListener = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('quick-ops.git.defaultSkipVerify')) {
        const config = vscode.workspace.getConfiguration('quick-ops.git');
        const defaultSkipVerify = config.get<boolean>('defaultSkipVerify') || false;
        // 配置一旦发生改变，立刻推送给前端
        this._view?.webview.postMessage({
          type: 'gitConfigChanged',
          defaultSkipVerify,
        });
      }
    });

    webviewView.onDidDispose(() => {
      editorListener.dispose();
      configListener.dispose(); // 🌟 别忘了销毁监听器防止内存泄漏
      this._gitWatchers.forEach((d) => d.dispose());
      this._gitWatchers = [];
    });

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      try {
        // 🌟 1. 无需 Git 仓库即可以执行的全局命令
        if (msg.command === 'openExternal') {
          vscode.env.openExternal(vscode.Uri.parse(msg.url));
          return;
        }
        if (msg.command === 'clone') {
          // 调用 VS Code 完美的内置克隆体验
          vscode.commands.executeCommand('git.clone');
          return;
        }

        // 🌟 2. 拦截 Git 安装状态
        if (msg.command === 'webviewLoaded' || msg.command === 'refresh') {
          const isInstalled = await this.checkGitInstalled();

          // 获取配置
          const config = vscode.workspace.getConfiguration('quick-ops.git');
          const defaultSkipVerify = config.get<boolean>('defaultSkipVerify') || false;
          console.log('defaultSkipVerify', defaultSkipVerify);

          this._view?.webview.postMessage({
            type: 'gitInstallationStatus',
            isInstalled,
            defaultSkipVerify,
            // 传入一个标识，区分是首次加载还是手动刷新
            isInit: msg.command === 'webviewLoaded',
          });

          if (!isInstalled) return;
        }

        // 🌟 3. 拦截空工作区 (根本没打开任何文件夹)
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

          // ==========================================
          // 🌟 新增逻辑 1：切换本地分支 (Checkout)
          // ==========================================
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

              // 先挂载进度条获取本地分支列表
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

              // 执行 Checkout 时挂载进度条并锁定刷新
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

          // ==========================================
          // 🌟 新增逻辑 2：合并本地分支 (Merge)
          // ==========================================
          case 'mergeBranch': {
            try {
              let mergeableBranches: string[] = [];
              let currentBranch = '';

              await this.withViewProgress(async () => {
                const branchSummary = await git.branchLocal();
                currentBranch = branchSummary.current;
                // 过滤掉当前分支（不能合并自己）
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
                await git.merge([selected.branchName]);
                vscode.window.showInformationMessage(`🎉 已成功将 ${selected.branchName} 合并到 ${currentBranch}`);
                await this.refreshStatus(cwd, true);
              });
            } catch (e: any) {
              vscode.window.showErrorMessage(`合并分支失败: ${e.message}`);
              // 如果发生冲突，刷新视图以显示冲突状态 (Unmerged)
              await this.refreshStatus(cwd, true);
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
                // 🌟 使用视图进度条包裹
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
                } catch (e) {}
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

              // 🌟 使用视图进度条包裹大日志查询
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
              // 🌟 使用视图进度条包裹
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

          // 🌟 全新升级的对比分支功能：瞬间弹出 + 顶部蓝条后台静默刷新
          case 'requestCompare': {
            try {
              // 1. 创建高级下拉菜单实例
              const quickPick = vscode.window.createQuickPick<vscode.QuickPickItem & { branchName: string }>();
              quickPick.placeholder = '1/2: 请选择【基准分支】(Base Branch，支持远程分支)';
              quickPick.matchOnDescription = true;

              const updateQuickPickItems = async () => {
                // 🌟 使用视图进度条包裹
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
                } catch (e) {}
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

              // 🌟 使用视图进度条包裹
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

          // ==========================================
          // 🌟 核心升级：一键完成「侧边栏 Commits」+「原生多文件对比」
          // ==========================================
          case 'compareFileAcrossBranches': {
            try {
              // 1. 弹出高级下拉菜单选择【基准分支 Base Branch】
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
                } catch (e) {}
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

              // 2. 选择【目标分支 Target Branch】
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

              // 3. 🌟 动作 A：查询 Commits 记录并推送到 React 侧边栏
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

              // 4. 🌟 动作 B：查询差异文件，并唤起 VS Code 原生多文件对比编辑器
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
                      file: parts[parts.length - 1], // 取最后一部分兼容重命名格式
                    };
                  });

                if (diffFiles.length === 0) {
                  vscode.window.showInformationMessage(`分支 ${baseBranch} 和 ${targetBranch} 之间没有任何文件差异。`);
                  return;
                }

                // 组装 vscode.changes 需要的格式: [文件URI, 左侧旧内容URI, 右侧新内容URI]
                const changesArgs = diffFiles.map((f) => {
                  let leftRef = baseBranch;
                  let rightRef = targetBranch;

                  // 自动处理新增(A)和删除(D)时的空文件占位
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

                // 唤起原生 Multi-Diff
                await vscode.commands.executeCommand('vscode.changes', title, changesArgs);
              });
            } catch (e: any) {
              vscode.window.showErrorMessage(`跨分支对比失败: ${e.message}`);
            }
            break;
          }

          case 'diffBranchFile': {
            // 左侧：1号分支 (Base Branch)
            const leftQuery = encodeURIComponent(JSON.stringify({ cwd, ref: msg.baseBranch }));
            const leftUri = vscode.Uri.parse(`quickops-git:///${msg.file}?${leftQuery}`);

            // 右侧：选中的特定提交节点 (或者 targetBranch)
            const rightRef = msg.status === 'D' ? 'empty' : msg.targetBranch;
            const rightQuery = encodeURIComponent(JSON.stringify({ cwd, ref: rightRef }));
            const rightUri = vscode.Uri.parse(`quickops-git:///${msg.file}?${rightQuery}`);

            const title = `${path.basename(msg.file)} (${msg.baseBranch} ↔ ${msg.targetBranch.substring(0, 7)})`;
            vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title);
            break;
          }

          case 'commit':
            await this.executeGitOperation(async () => {
              await this.handleCommit(cwd, msg.message, msg.skipVerify);
            });
            break;

          case 'push':
            await this.executeGitOperation(async () => {
              vscode.window.showInformationMessage('正在推送到远程...');
              await git.push(['-u', 'origin', 'HEAD']);
              vscode.window.showInformationMessage('🚀 推送成功！');

              // 🌟 新增：推送成功后，通知前端隐藏撤销按钮
              this._view?.webview.postMessage({ type: 'clearJustCommitted' });

              await this.refreshStatus(cwd, true);
            });
            break;

          case 'pull':
            await this.executeGitOperation(async () => {
              vscode.window.showInformationMessage('正在拉取代码...');
              await git.pull();
              vscode.window.showInformationMessage('⬇️ 拉取成功！');

              // 🌟 新增：拉取成功后，通知前端隐藏撤销按钮（防止历史记录错乱）
              this._view?.webview.postMessage({ type: 'clearJustCommitted' });

              await this.refreshStatus(cwd, true);
            });
            break;

          case 'open': {
            const fileUri = vscode.Uri.file(path.join(cwd, msg.file));
            vscode.commands.executeCommand('vscode.open', fileUri);
            break;
          }

          case 'diff': {
            const fileUri = vscode.Uri.file(path.join(cwd, msg.file));
            if (msg.status === 'U' || msg.status === 'A') {
              vscode.commands.executeCommand('vscode.open', fileUri);
            } else {
              const query = encodeURIComponent(JSON.stringify({ cwd, ref: 'HEAD' }));
              const originalUri = vscode.Uri.parse(`quickops-git:///${msg.file}?${query}`);
              vscode.commands.executeCommand('vscode.diff', originalUri, fileUri, `${msg.file} (工作树)`);
            }
            break;
          }

          // ========================================================
          // 🌟 核心升级：stageAll 自动忽略/剔除假变更文件
          // ========================================================
          case 'stageAll': {
            await this.executeGitOperation(async () => {
              const status = await git.status();
              const filesToAdd: string[] = [];
              const filesToDelete: string[] = [];

              for (const f of status.files) {
                const wDir = f.working_dir;
                if (wDir === ' ' || wDir === '') continue; // 未在工作区修改

                if (wDir === 'D') {
                  filesToDelete.push(f.path);
                } else if (wDir === '?' || wDir === 'U') {
                  filesToAdd.push(f.path);
                } else {
                  // 工作区有修改 (如 M), 检查实质内容 diff
                  const diff = await git.diff(['--', f.path]);
                  if (!diff.trim()) {
                    // 无内容变更 (如仅文件权限/换行符变化)，抛弃假修改恢复原始状态
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

          // ========================================================
          // 🌟 核心升级：stage 自动忽略/剔除单文件假变更
          // ========================================================
          case 'stage': {
            await this.executeGitOperation(async () => {
              if (msg.status === 'D') {
                await git.rm([msg.file]);
              } else if (msg.status === '?' || msg.status === 'U') {
                await git.add([msg.file]);
              } else {
                // 检查单文件是否有实质内容更改
                const diff = await git.diff(['--', msg.file]);
                if (!diff.trim()) {
                  // 无内容变更，直接 checkout 抛弃工作区假状态
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
            // 🌟 多文件情况，弹出警告弹窗 (对应截图2)
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
            // 🌟 单文件情况，提取出文件名并弹出警告弹窗 (对应截图1)
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

          case 'getCommitFiles': {
            // 🌟 还原为纯净的数据获取逻辑，专供前端内联展开文件树使用
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

              // 只推送数据给前端，触发你的 activeCommitHash === c.hash 渲染逻辑
              this._view?.webview.postMessage({ type: 'commitFilesData', hash: msg.hash, files, parentHash: parentOid });
            });
            break;
          }

          case 'diffCommitFile': {
            const leftQuery = encodeURIComponent(JSON.stringify({ cwd, ref: msg.parentHash || 'empty' }));
            const leftUri = vscode.Uri.parse(`quickops-git:///${msg.file}?${leftQuery}`);
            const rightRef = msg.status === 'D' ? 'empty' : msg.hash;
            const rightQuery = encodeURIComponent(JSON.stringify({ cwd, ref: rightRef }));
            const rightUri = vscode.Uri.parse(`quickops-git:///${msg.file}?${rightQuery}`);
            const title = `${path.basename(msg.file)} (${msg.hash.substring(0, 7)})`;
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
              } catch (e) {}

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
              // 🌟 修改配置：将用户在 UI 上的操作持久化到全局设置中
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

    // 🌟 1. 将核心的读取逻辑提取出来
    const doRefresh = async () => {
      // 拦截未初始化的文件夹
      const isRepo = await git.checkIsRepo();
      if (!isRepo) {
        this._view?.webview.postMessage({ type: 'notRepo' });
        return;
      }

      const branchPromise = git
        .branchLocal()
        .then((b) => b.current)
        .catch(() => 'HEAD');
      const remoteUrlPromise = git
        .listRemote(['--get-url'])
        .then((r) => r.trim())
        .catch(() => '');
      const statusPromise = git.status();

      const branch = await branchPromise;
      const remoteUrl = await remoteUrlPromise;
      const status = await statusPromise;

      const stagedFiles: { status: string; file: string }[] = [];
      const unstagedFiles: { status: string; file: string }[] = [];

      status.files.forEach((file) => {
        if (file.index !== ' ' && file.index !== '?') {
          stagedFiles.push({ status: file.index, file: file.path });
        }
        if (file.working_dir !== ' ') {
          let s = file.working_dir;
          if (s === '?') s = 'U';
          unstagedFiles.push({ status: s, file: file.path });
        }
      });

      this._view?.webview.postMessage({
        type: 'statusData',
        stagedFiles,
        unstagedFiles,
        branch,
        remoteUrl,
        folderName: path.basename(cwd),
      });

      if (fullRefresh) {
        try {
          const refs = await git.raw(['show-ref']).catch(() => '');
          const head = await git.raw(['rev-parse', 'HEAD']).catch(() => '');
          this._lastGraphState = refs + head;
        } catch (e) {}

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
      // 🌟 2. 核心修复：如果是全量刷新，显示进度条；如果是后台静默刷新(false)，则直接执行，不显示进度条
      if (fullRefresh) {
        await this.withViewProgress(doRefresh);
      } else {
        await doRefresh();
      }
    } catch (e: any) {
      // 出错时也发送 notRepo 拦截
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

    // 🌟 发送通知给前端：刚刚提交成功，可以显示撤销按钮
    this._view?.webview.postMessage({ type: 'commitSuccess' });

    await this.refreshStatus(cwd, true);
  }

  private getWorkspaceRoot(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }
}
