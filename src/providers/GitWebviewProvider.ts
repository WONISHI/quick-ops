import * as vscode from 'vscode';
import simpleGit, { SimpleGit } from 'simple-git';
import path from 'path';
import { getReactWebviewHtml } from '../utils/WebviewHelper';

export class GitWebviewProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;

  // 核心拦截状态：记录是否是我们 Webview 发起的 Git 操作
  private _isInternalOp = false;
  private _internalOpTimer: NodeJS.Timeout | null = null;
  private _gitWatchers: vscode.Disposable[] = [];

  // 刷新并发锁与防抖定时器
  private _isRefreshing = false;
  private _debounceTimer: NodeJS.Timeout | null = null;

  // 🌟 核心优化：缓存上一次的 Git 树状态指纹
  private _lastGraphState = '';

  constructor(private readonly _extensionUri: vscode.Uri) {
    const gitDiffProvider = new class implements vscode.TextDocumentContentProvider {
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
    }();
    vscode.workspace.registerTextDocumentContentProvider('quickops-git', gitDiffProvider);
  }

  // 内部操作锁执行器
  private async executeGitOperation(operation: () => Promise<void> | void) {
    this._isInternalOp = true;
    if (this._internalOpTimer) clearTimeout(this._internalOpTimer);

    try {
      await operation();
    } finally {
      this._internalOpTimer = setTimeout(() => {
        this._isInternalOp = false;
      }, 1500);
    }
  }

  // 设置全局 Git 监听器
  private async setupGitWatcher() {
    // 1. 获取官方 Git 插件实例（不直接拿 exports）
    const gitExtension = vscode.extensions.getExtension('vscode.git');
    if (!gitExtension) {
      console.warn('未找到 VS Code 内置 Git 插件');
      return;
    }

    try {
      // 🌟 2. 核心修复：如果还没激活，主动等待它激活！
      if (!gitExtension.isActive) {
        await gitExtension.activate();
      }
    } catch (e) {
      console.warn('激活 VS Code 内置 Git 插件失败:', e);
      return;
    }

    // 3. 安全获取 API
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
            console.log('检测到 Commit/分支 发生变化，执行全量刷新');
          } else {
            console.log('检测到单纯的文件修改，仅刷新工作区状态，图形保持静止');
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

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true, localResourceRoots: [this._extensionUri] };
    webviewView.webview.html = getReactWebviewHtml(this._extensionUri, webviewView.webview, '/git');

    this.setupGitWatcher();

    const editorListener = vscode.window.onDidChangeActiveTextEditor(editor => {
      if (editor && this._view && editor.document.uri.scheme === 'file') {
        const cwd = this.getWorkspaceRoot();
        if (cwd) {
          const relativePath = path.relative(cwd, editor.document.uri.fsPath).replace(/\\/g, '/');
          this._view.webview.postMessage({ type: 'activeEditorChanged', file: relativePath });
        }
      }
    });

    webviewView.onDidDispose(() => {
      editorListener.dispose();
      this._gitWatchers.forEach(d => d.dispose());
      this._gitWatchers = [];
    });

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      const cwd = this.getWorkspaceRoot();
      if (!cwd) return;

      const git: SimpleGit = simpleGit(cwd);

      try {
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

          case 'changeGraphFilter': {
            try {
              const allOption = '全部分支';

              const quickPick = vscode.window.createQuickPick<vscode.QuickPickItem & { branchName: string }>();
              quickPick.placeholder = '选择要查看的分支记录 (支持搜索)';
              quickPick.matchOnDescription = true;

              const updateQuickPickItems = async () => {
                const branches = await git.branch(['-a']);
                const branchNames = branches.all.filter(b => !b.includes('->'));
                const items = [allOption, ...branchNames].map(b => ({
                  label: b === msg.current ? `$(check) ${b}` : b,
                  description: b === msg.current ? '当前选择' : undefined,
                  branchName: b
                }));
                quickPick.items = items;

                const currentItem = items.find(i => i.branchName === msg.current);
                if (currentItem && quickPick.activeItems.length === 0) {
                  quickPick.activeItems = [currentItem];
                }
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

              const logOptions: any = {
                '--topo-order': null,
                format: { hash: '%H', parents: '%P', author: '%an', email: '%ae', message: '%s', timestamp: '%ct', refs: '%D' },
                maxCount: 5000
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
                timestamp: parseInt(c.timestamp as string, 10) * 1000
              }));

              this._view?.webview.postMessage({
                type: 'graphData',
                graphCommits,
                graphFilter: selectedBranch
              });

            } catch (e: any) {
              vscode.window.showErrorMessage(`获取分支记录失败: ${e.message}`);
            }
            break;
          }

          case 'viewFileHistory': {
            try {
              const logOptions: any = {
                '--topo-order': null,
                format: { hash: '%H', author: '%an', message: '%s', timestamp: '%ct' },
                maxCount: 5000,
                file: msg.file
              };

              const logRaw = await git.log(logOptions);
              const commits = logRaw.all.map((c: any) => ({
                hash: c.hash,
                author: c.author,
                message: c.message,
                timestamp: parseInt(c.timestamp as string, 10) * 1000
              }));

              const fileName = msg.file.split('/').pop() || msg.file;

              this._view?.webview.postMessage({
                type: 'compareData',
                baseBranch: '文件历史',
                targetBranch: fileName,
                commits
              });

            } catch (e: any) {
              vscode.window.showErrorMessage(`获取文件历史失败: ${e.message}`);
            }
            break;
          }

          case 'requestCompare': {
            try {
              this.executeGitOperation(async () => {
                await git.fetch(['--all', '--prune']).catch(() => { });
              });

              const branches = await git.branch(['-a']);
              const branchNames = branches.all.filter(b => !b.includes('->'));

              const baseBranch = await vscode.window.showQuickPick(branchNames, {
                placeHolder: '1/2: 请选择【基准分支】(Base Branch，支持远程分支)',
                matchOnDescription: true
              });
              if (!baseBranch) return;

              const targetBranch = await vscode.window.showQuickPick(branchNames.filter(b => b !== baseBranch), {
                placeHolder: `2/2: 请选择【目标分支】(查看 ${baseBranch} 中没有的记录)`,
                matchOnDescription: true
              });
              if (!targetBranch) return;

              const logOptions = {
                from: baseBranch,
                to: targetBranch,
                format: { hash: '%H', author: '%an', message: '%s', timestamp: '%ct' }
              };

              const logResult = await git.log(logOptions);
              const commits = logResult.all.map(c => ({
                hash: c.hash,
                author: c.author,
                message: c.message,
                timestamp: parseInt(c.timestamp as string, 10) * 1000
              }));

              this._view?.webview.postMessage({ type: 'compareData', baseBranch, targetBranch, commits });
            } catch (e: any) {
              vscode.window.showErrorMessage(`对比分支失败: ${e.message}`);
            }
            break;
          }

          case 'commit':
            await this.executeGitOperation(async () => {
              // 🌟 接收 skipVerify
              await this.handleCommit(cwd, msg.message, msg.skipVerify);
            });
            break;

          case 'push':
            await this.executeGitOperation(async () => {
              vscode.window.showInformationMessage('正在推送到远程...');
              await git.push(['-u', 'origin', 'HEAD']);
              vscode.window.showInformationMessage('🚀 推送成功！');
              await this.refreshStatus(cwd, true);
            });
            break;

          case 'pull':
            await this.executeGitOperation(async () => {
              vscode.window.showInformationMessage('正在拉取代码...');
              await git.pull();
              vscode.window.showInformationMessage('⬇️ 拉取成功！');
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

          case 'discard': {
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

          case 'stage': {
            await this.executeGitOperation(async () => {
              if (msg.status === 'D') {
                await git.rm([msg.file]);
              } else {
                await git.add([msg.file]);
              }
              await this.refreshStatus(cwd, false);
            });
            break;
          }

          case 'unstage': {
            await this.executeGitOperation(async () => {
              await git.reset(['--', msg.file]);
              await this.refreshStatus(cwd, false);
            });
            break;
          }

          case 'getCommitFiles': {
            const diffRaw = await git.raw(['diff-tree', '--no-commit-id', '--name-status', '-r', '--root', msg.hash]);
            const files = diffRaw.split('\n').filter(line => line.trim()).map(line => {
              const parts = line.split('\t');
              return { status: parts[0].charAt(0), file: parts[parts.length - 1] };
            });

            let parentOid: string | undefined;
            try {
              parentOid = (await git.raw(['rev-parse', `${msg.hash}^1`])).trim();
            } catch (e) {
              parentOid = undefined;
            }

            this._view?.webview.postMessage({ type: 'commitFilesData', hash: msg.hash, files, parentHash: parentOid });
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

          case 'reveal': {
            const fileUri = vscode.Uri.file(path.join(cwd, msg.file));
            vscode.commands.executeCommand('revealFileInOS', fileUri);
            break;
          }

          case 'openExternal':
            vscode.env.openExternal(vscode.Uri.parse(msg.url));
            break;
        }
      } catch (error: any) {
        vscode.window.showErrorMessage(`Git 错误: ${error.message}`);
        this._view?.webview.postMessage({ type: 'error', message: error.message });
      }
    });
  }

  private async refreshStatus(cwd: string, fullRefresh: boolean = true) {
    if (!this._view) return;

    // 如果已经被锁住了，直接退出
    if (this._isRefreshing) return;

    // 开始执行，立刻上锁
    this._isRefreshing = true;

    if (fullRefresh) this._view.webview.postMessage({ type: 'startLoading' });

    const git: SimpleGit = simpleGit(cwd);

    try {
      const isRepo = await git.checkIsRepo();
      if (!isRepo) throw new Error('Not a git repository');

      const branchPromise = git.branchLocal().then(b => b.current).catch(() => 'HEAD');
      const remoteUrlPromise = git.listRemote(['--get-url']).then(r => r.trim()).catch(() => '');
      const statusPromise = git.status();

      const branch = await branchPromise;
      const remoteUrl = await remoteUrlPromise;
      const status = await statusPromise;

      const stagedFiles: { status: string, file: string }[] = [];
      const unstagedFiles: { status: string, file: string }[] = [];

      status.files.forEach(file => {
        if (file.index !== ' ' && file.index !== '?') {
          stagedFiles.push({ status: file.index, file: file.path });
        }
        if (file.working_dir !== ' ') {
          let s = file.working_dir;
          if (s === '?') s = 'U';
          unstagedFiles.push({ status: s, file: file.path });
        }
      });

      this._view.webview.postMessage({
        type: 'statusData',
        stagedFiles,
        unstagedFiles,
        branch,
        remoteUrl
      });

      if (fullRefresh) {
        // 🌟 每次主动全量刷新时，同步更新指纹缓存
        try {
          const refs = await git.raw(['show-ref']).catch(() => '');
          const head = await git.raw(['rev-parse', 'HEAD']).catch(() => '');
          this._lastGraphState = refs + head;
        } catch (e) { }

        const logOptions = {
          '--all': null,
          '--topo-order': null,
          format: { hash: '%H', parents: '%P', author: '%an', email: '%ae', message: '%s', timestamp: '%ct', refs: '%D' },
          maxCount: 5000
        };

        const logRaw = await git.log(logOptions);
        const graphCommits = logRaw.all.map((c: any) => ({
          hash: c.hash,
          parents: c.parents ? (c.parents as string).split(' ').filter(Boolean) : [],
          author: c.author,
          email: c.email,
          message: c.message,
          refs: c.refs || '',
          timestamp: parseInt(c.timestamp as string, 10) * 1000
        }));

        this._view.webview.postMessage({ type: 'graphData', graphCommits, graphFilter: '全部分支' });
      }

    } catch (e: any) {
      this._view.webview.postMessage({ type: 'statusData', stagedFiles: [], unstagedFiles: [], branch: '未初始化', remoteUrl: '' });
      if (fullRefresh) this._view.webview.postMessage({ type: 'graphData', graphCommits: [], graphFilter: '全部分支' });
    } finally {
      // 🌟 最关键的一步：无论成功还是失败，最后一定要解锁！
      this._isRefreshing = false;
    }
  }

  // 🌟 接收 skipVerify 参数
  private async handleCommit(cwd: string, message: string, skipVerify: boolean) {
    const git: SimpleGit = simpleGit(cwd);
    const status = await git.status();

    const hasStaged = status.files.some(f => f.index !== ' ' && f.index !== '?');
    if (!hasStaged) {
      await git.add(['-A']);
    }

    // 🌟 拼装提交配置
    const options: any = {};
    if (skipVerify) {
      options['--no-verify'] = null; // 添加 --no-verify 标志
    }

    await git.commit(message, options);
    vscode.window.showInformationMessage('🎉 提交成功！');
    await this.refreshStatus(cwd, true);
  }

  private getWorkspaceRoot(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }
}