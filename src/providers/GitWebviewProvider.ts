import * as vscode from 'vscode';
import git from 'isomorphic-git';
import fs from 'fs'; // 读写本地工作区文件
import http from 'isomorphic-git/http/node'; // 供 push/pull 使用的 node http 客户端
import { getReactWebviewHtml } from '../utils/WebviewHelper';

export class GitWebviewProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;

  constructor(private readonly _extensionUri: vscode.Uri) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri]
    };

    // 🌟 核心：这里接入 React 编译后的 HTML，并指定渲染 /git 路由页面
    webviewView.webview.html = getReactWebviewHtml(this._extensionUri, webviewView.webview, '/git');

    // 监听前端 React 的交互消息
    webviewView.webview.onDidReceiveMessage(async (msg) => {
      const cwd = this.getWorkspaceRoot();
      if (!cwd) {
        this._view?.webview.postMessage({ type: 'error', message: '未找到工作区' });
        return;
      }

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
            await git.push({
              fs,
              http,
              dir: cwd,
              remote: 'origin',
              ref: await git.currentBranch({ fs, dir: cwd }) || 'master',
              // 💡 注意：如果远程是私有仓库，需要处理鉴权
              // onAuth: () => ({ username: 'YOUR_GITHUB_TOKEN' }) 
            });
            vscode.window.showInformationMessage('🚀 推送成功！');
            await this.refreshStatus(cwd);
            break;
          case 'pull':
            vscode.window.showInformationMessage('正在拉取代码...');
            await git.pull({
              fs,
              http,
              dir: cwd,
              remote: 'origin',
              ref: await git.currentBranch({ fs, dir: cwd }) || 'master',
              author: { name: 'Quick Ops', email: 'quickops@plugin.com' }
            });
            vscode.window.showInformationMessage('⬇️ 拉取成功！');
            await this.refreshStatus(cwd);
            break;
        }
      } catch (error: any) {
        vscode.window.showErrorMessage(`Git 操作失败: ${error.message}`);
        this._view?.webview.postMessage({ type: 'error', message: error.message });
      }
    });
  }

  /**
   * 🌟 核心：使用 isomorphic-git 暂存所有更改并提交
   */
  private async handleCommit(cwd: string, message: string) {
    const matrix = await git.statusMatrix({ fs, dir: cwd });
    
    // 自动暂存所有更改 (等价于 git add .)
    for (const row of matrix) {
      const [filepath, head, workdir, stage] = row;
      // workdir !== stage 说明工作区和暂存区状态不一致，需要更新暂存区
      if (workdir !== stage) {
        if (workdir === 0) {
          // 文件在工作区已被删除
          await git.remove({ fs, dir: cwd, filepath });
        } else {
          // 文件新增或修改了
          await git.add({ fs, dir: cwd, filepath });
        }
      }
    }

    // 执行提交
    await git.commit({
      fs,
      dir: cwd,
      message,
      author: {
        name: 'Quick Ops', // 真实场景中可以通过 git.getConfig 读取用户的 user.name
        email: 'quickops@example.com'
      }
    });

    vscode.window.showInformationMessage('🎉 提交成功！');
    await this.refreshStatus(cwd);
  }

  /**
   * 🌟 核心：获取 Git 状态并推送给 React 前端
   */
  private async refreshStatus(cwd: string) {
    if (!this._view) return;
    try {
      // 1. 获取当前分支
      const branch = await git.currentBranch({ fs, dir: cwd, fullname: false });

      // 2. 获取文件状态矩阵
      // row 格式: [filepath, HEAD状态, 工作区状态, 暂存区状态]
      const matrix = await git.statusMatrix({ fs, dir: cwd });
      
      const files = matrix
        .filter(row => row[1] !== row[2] || row[2] !== row[3]) // 过滤掉完全没修改的文件
        .map(row => {
          const [file, head, workdir] = row;
          
          let status = 'M'; // 默认视为修改 (Modified)
          if (head === 0 && workdir === 2) status = 'A'; // 之前不存在，现在存在 -> 新增 (Added)
          if (head === 1 && workdir === 0) status = 'D'; // 之前存在，现在不存在 -> 删除 (Deleted)
          if (head === 0 && workdir === 1) status = 'U'; // 未追踪 (Untracked)

          return { status, file };
        });

      // 3. 将数据发送给前端
      this._view.webview.postMessage({
        type: 'statusData',
        files,
        branch: branch || 'HEAD'
      });
    } catch (e: any) {
      if (e.code === 'NotFoundError') {
        console.warn("当前工作区不是一个 Git 仓库");
        this._view.webview.postMessage({
          type: 'statusData',
          files: [],
          branch: '未初始化'
        });
      } else {
        console.error("获取 Git 状态失败", e);
      }
    }
  }

  /**
   * 获取当前打开的工作区根目录路径
   */
  private getWorkspaceRoot(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }
}