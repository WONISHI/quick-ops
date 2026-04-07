import * as vscode from 'vscode';
import git from 'isomorphic-git';
import fs from 'fs';
import path from 'path';
import http from 'isomorphic-git/http/node';
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

          const commitOid = await git.resolveRef({ fs, dir: cwd, ref });
          const { blob } = await git.readBlob({ fs, dir: cwd, oid: commitOid, filepath });
          return Buffer.from(blob).toString('utf8');
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

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      const cwd = this.getWorkspaceRoot();
      if (!cwd) return;

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
            await git.push({ fs, http, dir: cwd, remote: 'origin', ref: await git.currentBranch({ fs, dir: cwd }) || 'master' });
            vscode.window.showInformationMessage('🚀 推送成功！');
            await this.refreshStatus(cwd);
            break;
          case 'pull':
            vscode.window.showInformationMessage('正在拉取代码...');
            await git.pull({ fs, http, dir: cwd, remote: 'origin', ref: await git.currentBranch({ fs, dir: cwd }) || 'master', author: { name: 'Quick Ops', email: 'quickops@plugin.com' } });
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
              await git.checkout({ fs, dir: cwd, filepaths: [msg.file], force: true });
            }
            await this.refreshStatus(cwd);
            break;
          }
          case 'stage': {
            if (msg.status === 'D') {
              await git.remove({ fs, dir: cwd, filepath: msg.file });
            } else {
              await git.add({ fs, dir: cwd, filepath: msg.file });
            }
            await this.refreshStatus(cwd);
            break;
          }
          case 'unstage': {
            await git.resetIndex({ fs, dir: cwd, filepath: msg.file });
            await this.refreshStatus(cwd);
            break;
          }
          case 'loadMoreCommits': {
            const commitsRaw = await git.log({ fs, dir: cwd, ref: msg.ref, depth: 31 });
            const nextCommits = commitsRaw.slice(1).map(c => ({
              hash: c.oid,
              parents: c.commit.parent || [], // 🌟 新增：读取父级节点信息
              author: c.commit.author.name,
              email: c.commit.author.email,
              message: c.commit.message,
              timestamp: c.commit.committer.timestamp * 1000
            }));
            this._view?.webview.postMessage({ type: 'moreCommitsData', commits: nextCommits });
            break;
          }
          case 'getCommitFiles': {
            const commit = await git.readCommit({ fs, dir: cwd, oid: msg.hash });
            const parentOid = commit.commit.parent[0];

            const trees = [git.TREE({ ref: msg.hash })];
            if (parentOid) trees.push(git.TREE({ ref: parentOid }));

            const files = await git.walk({
              fs, dir: cwd, trees,
              map: async function(filepath, entries) {
                if (filepath === '.') return;
                const [curr, prev] = entries;
                const currType = curr ? await curr.type() : null;
                const prevType = prev ? await prev.type() : null;
                if (currType === 'tree' || prevType === 'tree') return; 

                const currOid = curr ? await curr.oid() : null;
                const prevOid = prev ? await prev.oid() : null;
                if (currOid === prevOid) return;

                let status = 'M';
                if (!prev) status = 'A';
                if (!curr) status = 'D';
                return { file: filepath, status };
              }
            });

            const validFiles = files.filter((f:any) => f); 
            this._view?.webview.postMessage({ type: 'commitFilesData', hash: msg.hash, files: validFiles, parentHash: parentOid });
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
        // 🌟 新增：添加到 .gitignore
          case 'ignore': {
            const gitignorePath = path.join(cwd, '.gitignore');
            // 如果文件不存在会自动创建，写入时加换行确保安全追加
            fs.appendFileSync(gitignorePath, `\n${msg.file}`);
            vscode.window.showInformationMessage(`已将 ${msg.file} 添加到 .gitignore`);
            await this.refreshStatus(cwd);
            break;
          }
          // 🌟 新增：在访达/资源管理器中显示文件
          case 'reveal': {
            const fileUri = vscode.Uri.file(path.join(cwd, msg.file));
            // 这是 VS Code 自带的底层原生 API，直接调用即可
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

    try {
      const branchPromise = git.currentBranch({ fs, dir: cwd, fullname: false }).catch(() => 'HEAD');
      const remoteUrlPromise = git.getConfig({ fs, dir: cwd, path: 'remote.origin.url' }).catch(() => '');
      const matrixPromise = git.statusMatrix({ fs, dir: cwd }).catch(() => []);
      const logPromise = git.log({ fs, dir: cwd, depth: 30 }).catch(() => []);

      const branch = await branchPromise;
      const remoteUrl = await remoteUrlPromise as string;
      const matrix = await matrixPromise;
      
      const stagedFiles: {status: string, file: string}[] = [];
      const unstagedFiles: {status: string, file: string}[] = [];

      matrix.forEach(row => {
        const [file, head, workdir, stage] = row;
        if (workdir !== stage) {
          let status = 'M';
          if (stage === 0 && workdir === 2) status = 'U';
          if (stage === 1 && workdir === 0) status = 'D';
          if (stage === 2 && workdir === 0) status = 'D';
          unstagedFiles.push({ status, file });
        }
        if (head !== stage) {
          let status = 'M';
          if (head === 0 && stage === 2) status = 'A';
          if (head === 1 && stage === 0) status = 'D';
          stagedFiles.push({ status, file });
        }
      });

      this._view.webview.postMessage({ 
        type: 'statusData', 
        stagedFiles, 
        unstagedFiles, 
        branch, 
        remoteUrl 
      });

      const commitsRaw = await logPromise;
      const graphCommits = commitsRaw.map(c => ({
          hash: c.oid,
          parents: c.commit.parent || [], // 🌟 新增：读取父级节点信息
          author: c.commit.author.name,
          email: c.commit.author.email,
          message: c.commit.message,
          timestamp: c.commit.committer.timestamp * 1000
      }));

      this._view.webview.postMessage({ 
        type: 'graphData', 
        graphCommits 
      });

    } catch (e: any) {
      if (e.code === 'NotFoundError' || e.code === 'NotADirectoryError') {
        this._view.webview.postMessage({ type: 'statusData', stagedFiles: [], unstagedFiles: [], branch: '未初始化', remoteUrl: '' });
        this._view.webview.postMessage({ type: 'graphData', graphCommits: [] });
      }
    }
  }

  private async handleCommit(cwd: string, message: string) {
    const matrix = await git.statusMatrix({ fs, dir: cwd });
    const hasStaged = matrix.some(row => row[1] !== row[3]);
    if (!hasStaged) {
      for (const row of matrix) {
        const [filepath, , workdir, stage] = row;
        if (workdir !== stage) {
          if (workdir === 0) await git.remove({ fs, dir: cwd, filepath });
          else await git.add({ fs, dir: cwd, filepath });
        }
      }
    }
    await git.commit({ fs, dir: cwd, message, author: { name: 'Quick Ops', email: 'quickops@plugin.com' } });
    vscode.window.showInformationMessage('🎉 提交成功！');
    await this.refreshStatus(cwd);
  }

  private getWorkspaceRoot(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }
}