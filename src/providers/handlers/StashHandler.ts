import * as vscode from 'vscode';
import type GitService from '../../services/GitService';

export class StashHandler {
  constructor(
    private gitService: GitService,
    private view: vscode.WebviewView | undefined,
    private withViewProgress: <T>(task: () => Promise<T>) => Promise<T>,
    private executeGitOperation: (operation: () => Promise<void> | void) => Promise<void>,
    private refreshStatus: (cwd: string, fullRefresh: boolean) => Promise<void>,
    private handleGitErrorWithConflictCheck: (cwd: string, operationName: string, errorMsg: string) => Promise<void>,
  ) {}

  async handleStash(cwd: string) {
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
  }

  async handleGetStashFiles(cwd: string, index: number) {
    await this.withViewProgress(async () => {
      try {
        const result = await this.gitService.getStashFiles(cwd, index);

        this.view?.webview.postMessage({
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
  }

  async handleStashApply(cwd: string, index: number) {
    await this.executeGitOperation(async () => {
      try {
        await this.gitService.stashApply(cwd, index);
        vscode.window.showInformationMessage(`✅ 已应用贮藏 stash@{${index}}`);
        await this.refreshStatus(cwd, false);
      } catch (e: any) {
        await this.handleGitErrorWithConflictCheck(cwd, '应用贮藏', e.message);
      }
    });
  }

  async handleStashPop(cwd: string, index: number) {
    await this.executeGitOperation(async () => {
      try {
        await this.gitService.stashPop(cwd, index);
        vscode.window.showInformationMessage(`✅ 已弹出并删除贮藏 stash@{${index}}`);
        await this.refreshStatus(cwd, false);
      } catch (e: any) {
        await this.handleGitErrorWithConflictCheck(cwd, '弹出贮藏', e.message);
      }
    });
  }

  async handleStashDrop(cwd: string, index: number) {
    const confirm = await vscode.window.showWarningMessage(
      `确定要永久删除贮藏 stash@{${index}} 吗?\n此操作不可撤销！`,
      { modal: true },
      '删除贮藏',
    );

    if (confirm !== '删除贮藏') return;

    await this.executeGitOperation(async () => {
      try {
        await this.gitService.stashDrop(cwd, index);
        vscode.window.showInformationMessage(`🗑️ 已删除贮藏 stash@{${index}}`);
        await this.refreshStatus(cwd, false);
      } catch (e: any) {
        vscode.window.showErrorMessage(`删除贮藏失败: ${e.message}`);
      }
    });
  }
}
