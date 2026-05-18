import * as vscode from 'vscode';
import * as path from 'path';
import type GitService from '../../services/GitService';

export class CommitHandler {
  constructor(
    private gitService: GitService,
    private view: vscode.WebviewView | undefined,
    private executeGitOperation: (operation: () => Promise<void> | void) => Promise<void>,
    private refreshStatus: (cwd: string, fullRefresh: boolean) => Promise<void>,
    private handleGitErrorWithConflictCheck: (cwd: string, operationName: string, errorMsg: string) => Promise<void>,
    private createGitContentUri: (cwd: string, ref: string, file: string) => vscode.Uri,
  ) {}

  async handleCommit(cwd: string, message: string, skipVerify: boolean) {
    await this.executeGitOperation(async () => {
      await this.gitService.commit(cwd, message, skipVerify);

      vscode.window.showInformationMessage('🎉 提交成功！');

      this.view?.webview.postMessage({
        type: 'commitSuccess',
      });

      await this.refreshStatus(cwd, true);
    });
  }

  async handlePull(cwd: string) {
    await this.executeGitOperation(async () => {
      try {
        vscode.window.showInformationMessage('正在拉取代码...');

        await this.gitService.pull(cwd);

        vscode.window.showInformationMessage('⬇️ 拉取成功！');

        this.view?.webview.postMessage({
          type: 'clearJustCommitted',
        });

        await this.refreshStatus(cwd, true);
      } catch (e: any) {
        await this.handleGitErrorWithConflictCheck(cwd, '拉取 (Pull)', e.message);
      }
    });
  }

  async handlePush(cwd: string) {
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

        this.view?.webview.postMessage({
          type: 'clearJustCommitted',
        });

        await this.refreshStatus(cwd, true);
      } catch (e: any) {
        await this.handleGitErrorWithConflictCheck(cwd, '推送 (Push)', e.message);
      }
    });
  }

  async handleUndoLastCommit(cwd: string) {
    await this.executeGitOperation(async () => {
      try {
        await this.gitService.undoLastCommit(cwd);
        vscode.window.showInformationMessage('✅ 已撤销最近一次提交，更改已退回工作区。');
        await this.refreshStatus(cwd, true);
      } catch (e: any) {
        vscode.window.showErrorMessage(`无法撤销提交 (可能没有足够的提交记录): ${e.message}`);
      }
    });
  }

  async handleStageAll(cwd: string) {
    await this.executeGitOperation(async () => {
      await this.gitService.stageAll(cwd);
      await this.refreshStatus(cwd, false);
    });
  }

  async handleStage(cwd: string, file: string, status: string) {
    await this.executeGitOperation(async () => {
      const result = await this.gitService.stageFile(cwd, file, status);

      if (result === 'discarded-empty-change') {
        vscode.window.showInformationMessage(`文件 ${file} 无实质性内容更改，已自动剔除。`);
      }

      await this.refreshStatus(cwd, false);
    });
  }

  async handleUnstageAll(cwd: string) {
    await this.executeGitOperation(async () => {
      await this.gitService.unstageAll(cwd);
      await this.refreshStatus(cwd, false);
    });
  }

  async handleUnstage(cwd: string, file: string) {
    await this.executeGitOperation(async () => {
      await this.gitService.unstageFile(cwd, file);
      await this.refreshStatus(cwd, false);
    });
  }

  async handleDiscard(cwd: string, file: string, status: string) {
    const fileName = file.split('/').pop() || file;

    const confirm = await vscode.window.showWarningMessage(`是否确实要放弃 "${fileName}" 中的更改?`, { modal: true }, '放弃文件');

    if (confirm !== '放弃文件') return;

    await this.executeGitOperation(async () => {
      if (status === 'U') {
        const fileUri = vscode.Uri.file(path.join(cwd, file));

        await vscode.workspace.fs.delete(fileUri, {
          recursive: true,
          useTrash: true,
        });
      } else {
        await this.gitService.discardFile(cwd, file, status);
      }

      await this.refreshStatus(cwd, false);
    });
  }

  async handleDiscardAll(cwd: string, count: number) {
    const confirm = await vscode.window.showWarningMessage(
      `是否确实要放弃 ${count} 个文件中的全部更改?\n\n此操作不可撤销！\n如果继续操作，你当前的工作集将永久丢失。`,
      {
        modal: true,
      },
      `放弃所有 ${count} 个文件`,
    );

    if (confirm !== `放弃所有 ${count} 个文件`) return;

    await this.executeGitOperation(async () => {
      await this.gitService.discardAll(cwd);
      await this.refreshStatus(cwd, false);
    });
  }

  async handleIgnore(cwd: string, file: string) {
    await this.executeGitOperation(async () => {
      await this.gitService.addToGitignore(cwd, file);
      vscode.window.showInformationMessage(`已将 ${file} 添加到 .gitignore`);
      await this.refreshStatus(cwd, false);
    });
  }
}
