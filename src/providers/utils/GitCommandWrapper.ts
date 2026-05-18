import * as vscode from 'vscode';
import type GitService from '../../services/GitService';

export class GitCommandWrapper {
  private _isInternalOp = false;
  private _internalOpTimer: NodeJS.Timeout | null = null;

  constructor(
    private gitService: GitService,
    private view: vscode.WebviewView | undefined,
  ) {}

  async executeGitOperation(operation: () => Promise<void> | void, viewId?: string) {
    this._isInternalOp = true;

    if (this._internalOpTimer) {
      clearTimeout(this._internalOpTimer);
    }

    try {
      await this.withViewProgress(async () => {
        await operation();
      }, viewId);
    } finally {
      this._internalOpTimer = setTimeout(() => {
        this._isInternalOp = false;
      }, 1500);
    }
  }

  private async withViewProgress<T>(task: () => Promise<T>, viewId?: string): Promise<T> {
    return vscode.window.withProgress(
      {
        location: {
          viewId: viewId || 'quickOps.gitView',
        },
      },
      async () => {
        return await task();
      },
    );
  }

  async handleGitErrorWithConflictCheck(cwd: string, operationName: string, originalErrorMsg: string) {
    try {
      const repoStatus = await this.gitService.getRepoStatus(cwd);
      const conflicts = repoStatus.conflictedFiles || [];

      if (conflicts.length > 0) {
        vscode.window.showWarningMessage(
          `【${operationName}】产生冲突!\n共检测到 ${conflicts.length} 个冲突文件，请在侧边栏的【冲突区】中逐一解决。`,
        );
        vscode.commands.executeCommand('workbench.view.scm');
      } else {
        vscode.window.showErrorMessage(`${operationName} 失败: ${originalErrorMsg}`);
      }
    } catch {
      vscode.window.showErrorMessage(`${operationName} 失败: ${originalErrorMsg}`);
    }
  }

  isInternalOp(): boolean {
    return this._isInternalOp;
  }

  clearInternalOp() {
    this._isInternalOp = false;
    if (this._internalOpTimer) {
      clearTimeout(this._internalOpTimer);
      this._internalOpTimer = null;
    }
  }

  destroy() {
    if (this._internalOpTimer) {
      clearTimeout(this._internalOpTimer);
      this._internalOpTimer = null;
    }
  }
}
