import * as vscode from 'vscode';
import simpleGit, { SimpleGit } from 'simple-git';
import fs from 'fs';
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

          // 🌟 使用 simple-git 读取历史版本的文件内容
          const git: SimpleGit = simpleGit(cwd);
          const content = await git.show([`${ref}:${filepath}`]);
          return content;
        } catch (e) {
          // 如果文件在某个版本被删除了，show 命令会报错，此时返回空内容
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

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      const cwd = this.getWorkspaceRoot();
      if (!cwd) return;

      const git: SimpleGit = simpleGit(cwd);

      try {
        switch (msg.command) {
          case 'webviewLoaded':
          case 'refresh':
            await this.refreshStatus(cwd);
            break;
          case 'commit':
            await this.handleCommit(cwd, msg.message);
            break;
          case 'push':
            vscode.window.showInformationMessage('正在推送到远程...');
            await git.push();
            vscode.window.showInformationMessage('🚀 推送成功！');
            await this.refreshStatus(cwd);
            break;
          case 'pull':
            vscode.window.showInformationMessage('正在拉取代码...');
            await git.pull();
            vscode.window.showInformationMessage('⬇️ 拉取成功！');
            await this.refreshStatus(cwd);
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
              fs.unlinkSync(path.join(cwd, msg.file));
            } else {
              await git.checkout(['--', msg.file]);
            }
            await this.refreshStatus(cwd);
            break;
          }
          case 'stage': {
            if (msg.status === 'D') {
              await git.rm([msg.file]);
            } else {
              await git.add([msg.file]);
            }
            await this.refreshStatus(cwd);
            break;
          }
          case 'unstage': {
            await git.reset(['--', msg.file]);
            await this.refreshStatus(cwd);
            break;
          }
          case 'loadMoreCommits': {
            // 🌟 获取基于特定 Commit 继续往下的 30 条记录
            const logOptions = {
              to: msg.ref, // 使用 to 参数，表示回溯到这个节点
              maxCount: 31,
              format: { hash: '%H', parents: '%P', author: '%an', email: '%ae', message: '%s', timestamp: '%ct' }
            };
            const logRaw = await git.log(logOptions);
            const nextCommits = logRaw.all.slice(1).map(c => ({
              hash: c.hash,
              parents: c.parents ? (c.parents as string).split(' ').filter(Boolean) : [],
              author: c.author,
              email: c.email,
              message: c.message,
              timestamp: parseInt(c.timestamp as string, 10) * 1000
            }));
            this._view?.webview.postMessage({ type: 'moreCommitsData', commits: nextCommits });
            break;
          }
          case 'getCommitFiles': {
            // 🌟 使用 git diff-tree 极速获取文件的 M/A/D 变动状态
            const diffRaw = await git.raw(['diff-tree', '--no-commit-id', '--name-status', '-r', '--root', msg.hash]);
            const files = diffRaw.split('\n').filter(line => line.trim()).map(line => {
              const parts = line.split('\t');
              return { status: parts[0].charAt(0), file: parts[parts.length - 1] };
            });

            // 获取父级 Hash 用于后续 Diff
            let parentOid: string | undefined;
            try {
              parentOid = (await git.raw(['rev-parse', `${msg.hash}^1`])).trim();
            } catch (e) {
              parentOid = undefined; // 根节点没有父级
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
            const gitignorePath = path.join(cwd, '.gitignore');
            fs.appendFileSync(gitignorePath, `\n${msg.file}`);
            vscode.window.showInformationMessage(`已将 ${msg.file} 添加到 .gitignore`);
            await this.refreshStatus(cwd);
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

  private async refreshStatus(cwd: string) {
    if (!this._view) return;
    this._view.webview.postMessage({ type: 'startLoading' });

    const git: SimpleGit = simpleGit(cwd);

    try {
      const isRepo = await git.checkIsRepo();
      if (!isRepo) throw new Error('Not a git repository');

      // 1. 获取基础状态
      const branchPromise = git.branchLocal().then(b => b.current).catch(() => 'HEAD');
      const remoteUrlPromise = git.listRemote(['--get-url']).then(r => r.trim()).catch(() => '');
      const statusPromise = git.status();

      const branch = await branchPromise;
      const remoteUrl = await remoteUrlPromise;
      const status = await statusPromise;
      
      const stagedFiles: {status: string, file: string}[] = [];
      const unstagedFiles: {status: string, file: string}[] = [];

      // 🌟 解析 simple-git 的状态结构
      status.files.forEach(file => {
        // file.index 代表暂存区的状态
        if (file.index !== ' ' && file.index !== '?') {
          stagedFiles.push({ status: file.index, file: file.path });
        }
        // file.working_dir 代表工作区（未暂存）的状态
        if (file.working_dir !== ' ') {
          let s = file.working_dir;
          if (s === '?') s = 'U'; // simple-git 用 ? 表示 Untracked，我们前端使用 U
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

      // 2. 获取 Log 历史记录 (分离以防卡顿)
      const logOptions = {
        format: { hash: '%H', parents: '%P', author: '%an', email: '%ae', message: '%s', timestamp: '%ct' },
        maxCount: 30
      };
      
      const logRaw = await git.log(logOptions);
      const graphCommits = logRaw.all.map(c => ({
          hash: c.hash,
          parents: c.parents ? (c.parents as string).split(' ').filter(Boolean) : [],
          author: c.author,
          email: c.email,
          message: c.message,
          timestamp: parseInt(c.timestamp as string, 10) * 1000
      }));

      this._view.webview.postMessage({ type: 'graphData', graphCommits });

    } catch (e: any) {
      // 不是 Git 仓库或尚未初始化
      this._view.webview.postMessage({ type: 'statusData', stagedFiles: [], unstagedFiles: [], branch: '未初始化', remoteUrl: '' });
      this._view.webview.postMessage({ type: 'graphData', graphCommits: [] });
    }
  }

  private async handleCommit(cwd: string, message: string) {
    const git: SimpleGit = simpleGit(cwd);
    const status = await git.status();
    
    // 如果没有任何暂存的文件，原生行为是相当于把所有的更改（新、删、改）全部 add 然后提交
    const hasStaged = status.files.some(f => f.index !== ' ' && f.index !== '?');
    if (!hasStaged) {
      await git.add(['-A']);
    }
    
    await git.commit(message);
    vscode.window.showInformationMessage('🎉 提交成功！');
    await this.refreshStatus(cwd);
  }

  private getWorkspaceRoot(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }
}