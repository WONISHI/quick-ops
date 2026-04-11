import * as vscode from 'vscode';
import simpleGit, { SimpleGit } from 'simple-git';
import path from 'path';
import { getReactWebviewHtml } from '../utils/WebviewHelper';

export class GitWebviewProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;

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

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true, localResourceRoots: [this._extensionUri] };
    webviewView.webview.html = getReactWebviewHtml(this._extensionUri, webviewView.webview, '/git');

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

          // 🌟 核心新增：处理切换图形分支过滤器的请求
          case 'changeGraphFilter': {
            try {
              // 1. 获取所有分支 (包含远程分支)
              const branches = await git.branch(['-a']);
              const branchNames = branches.all.filter(b => !b.includes('->'));
              const allOption = '全部分支';

              // 2. 弹出 VS Code 原生选择器
              const selectedBranch = await vscode.window.showQuickPick([allOption, ...branchNames], {
                placeHolder: '选择要查看的分支记录 (支持搜索)',
                matchOnDescription: true
              });

              if (!selectedBranch) return; // 用户取消了选择

              // 3. 构建特定的 log 参数
              const logOptions: any = {
                '--topo-order': null,
                format: { hash: '%H', parents: '%P', author: '%an', email: '%ae', message: '%s', timestamp: '%ct', refs: '%D' },
                maxCount: 5000
              };

              if (selectedBranch === allOption) {
                logOptions['--all'] = null;
              } else {
                // 如果选择了特定分支，则将该分支名传给 git log
                logOptions[selectedBranch] = null;
              }

              // 4. 执行获取数据
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

              // 5. 将新数据和选中的分支名发回前端
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

          case 'requestCompare': {
            try {
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

              // 获取目标分支相对于基准分支的独立提交记录
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
            await this.handleCommit(cwd, msg.message);
            break;

          case 'push':
            vscode.window.showInformationMessage('正在推送到远程...');
            await git.push(['-u', 'origin', 'HEAD']);
            vscode.window.showInformationMessage('🚀 推送成功！');
            await this.refreshStatus(cwd, true);
            break;

          case 'pull':
            vscode.window.showInformationMessage('正在拉取代码...');
            await git.pull();
            vscode.window.showInformationMessage('⬇️ 拉取成功！');
            await this.refreshStatus(cwd, true);
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
            if (msg.status === 'U') {
              const fileUri = vscode.Uri.file(path.join(cwd, msg.file));
              await vscode.workspace.fs.delete(fileUri, { useTrash: true });
            } else {
              await git.checkout(['--', msg.file]);
            }
            await this.refreshStatus(cwd, false);
            break;
          }

          case 'stage': {
            if (msg.status === 'D') {
              await git.rm([msg.file]);
            } else {
              await git.add([msg.file]);
            }
            await this.refreshStatus(cwd, false);
            break;
          }

          case 'unstage': {
            await git.reset(['--', msg.file]);
            await this.refreshStatus(cwd, false);
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

      const stagedFiles: {status: string, file: string}[] = [];
      const unstagedFiles: {status: string, file: string}[] = [];

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

        // 刷新时重置过滤显示标签
        this._view.webview.postMessage({ type: 'graphData', graphCommits, graphFilter: '全部分支' });
      }

    } catch (e: any) {
      this._view.webview.postMessage({ type: 'statusData', stagedFiles: [], unstagedFiles: [], branch: '未初始化', remoteUrl: '' });
      if (fullRefresh) this._view.webview.postMessage({ type: 'graphData', graphCommits: [], graphFilter: '全部分支' });
    }
  }

  private async handleCommit(cwd: string, message: string) {
    const git: SimpleGit = simpleGit(cwd);
    const status = await git.status();

    const hasStaged = status.files.some(f => f.index !== ' ' && f.index !== '?');
    if (!hasStaged) {
      await git.add(['-A']);
    }

    await git.commit(message);
    vscode.window.showInformationMessage('🎉 提交成功！');
    await this.refreshStatus(cwd, true);
  }

  private getWorkspaceRoot(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }
}