import * as vscode from 'vscode';
import type GitService from '../../services/GitService';

export class BranchHandler {
  constructor(
    private gitService: GitService,
    private view: vscode.WebviewView | undefined,
    private withViewProgress: <T>(task: () => Promise<T>) => Promise<T>,
    private executeGitOperation: (operation: () => Promise<void> | void) => Promise<void>,
    private refreshStatus: (cwd: string, fullRefresh: boolean) => Promise<void>,
    private handleGitErrorWithConflictCheck: (cwd: string, operationName: string, errorMsg: string) => Promise<void>,
  ) {}

  async handleCreateBranch(cwd: string) {
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
        await this.gitService.createBranch(cwd, newBranchName);
        vscode.window.showInformationMessage(`✅ 已成功创建并切换到新分支: ${newBranchName}`);
        await this.refreshStatus(cwd, true);
      });
    } catch (e: any) {
      vscode.window.showErrorMessage(`创建新分支失败: ${e.message}`);
    }
  }

  async handleCheckoutBranch(cwd: string) {
    try {
      const { branches: localBranches, current: currentBranch } = await this.gitService.getLocalBranches(cwd);

      const quickPick = vscode.window.createQuickPick<vscode.QuickPickItem & { branchName: string }>();

      quickPick.placeholder = '请选择要切换到的本地分支';
      quickPick.matchOnDescription = true;

      const copyBtn: vscode.QuickInputButton = {
        iconPath: new vscode.ThemeIcon('copy'),
        tooltip: '复制分支名',
      };

      const remoteOpBtn: vscode.QuickInputButton = {
        iconPath: new vscode.ThemeIcon('cloud'),
        tooltip: '远程分支操作 (创建/删除)',
      };

      const items = localBranches.map((b) => ({
        label: b,
        description: b === currentBranch ? '当前分支' : undefined,
        branchName: b,
        buttons: [copyBtn, remoteOpBtn],
      }));

      quickPick.items = items;

      const activeItem = items.find((i) => i.branchName === currentBranch);

      if (activeItem) {
        quickPick.activeItems = [activeItem];
      }

      quickPick.onDidTriggerItemButton((e) => {
        if (e.button === copyBtn) {
          vscode.env.clipboard.writeText(e.item.branchName);
          vscode.window.showInformationMessage(`已复制分支名: ${e.item.branchName}`);
          return;
        }

        if (e.button === remoteOpBtn) {
          quickPick.hide();
          this.handleRemoteOps(cwd, e.item.branchName);
        }
      });

      quickPick.onDidAccept(async () => {
        const selected = quickPick.selectedItems[0];

        if (!selected || selected.branchName === currentBranch) {
          quickPick.hide();
          return;
        }

        quickPick.hide();

        await this.executeGitOperation(async () => {
          try {
            await this.gitService.checkoutBranch(cwd, selected.branchName);
            vscode.window.showInformationMessage(`✅ 已切换到分支: ${selected.branchName}`);
            await this.refreshStatus(cwd, true);
          } catch (err: any) {
            await this.handleGitErrorWithConflictCheck(cwd, '切换分支', err.message);
          }
        });
      });

      quickPick.onDidHide(() => quickPick.dispose());
      quickPick.show();
    } catch (e: any) {
      vscode.window.showErrorMessage(`获取分支列表失败: ${e.message}`);
    }
  }

  private async handleRemoteOps(cwd: string, branchName: string) {
    const remoteQuickPick = vscode.window.createQuickPick<vscode.QuickPickItem & { action: string }>();

    remoteQuickPick.title = `远程分支操作 - ${branchName}`;
    remoteQuickPick.placeholder = '请选择要执行的操作';
    remoteQuickPick.items = [
      {
        label: '$(cloud-upload) 创建远程分支',
        description: `推送本地 ${branchName} 到 origin/${branchName}`,
        action: 'create',
      },
      {
        label: '$(trash) 删除远程分支',
        description: `从 origin 永久删除 ${branchName}`,
        action: 'delete',
      },
    ];

    remoteQuickPick.onDidAccept(async () => {
      const selectedOp = remoteQuickPick.selectedItems[0];

      if (!selectedOp) return;

      remoteQuickPick.hide();

      await this.executeGitOperation(async () => {
        try {
          if (selectedOp.action === 'create') {
            vscode.window.showInformationMessage(`正在创建并推送远程分支 origin/${branchName}...`);
            await this.gitService.pushBranchToOrigin(cwd, branchName);
            vscode.window.showInformationMessage(`✅ 已成功创建并推送远程分支: origin/${branchName}`);
          }

          if (selectedOp.action === 'delete') {
            const confirm = await vscode.window.showWarningMessage(
              `确定要删除远程分支 origin/${branchName} 吗?\n此操作不可逆，团队其他成员将无法再访问该分支！`,
              { modal: true },
              '确定删除',
            );

            if (confirm === '确定删除') {
              vscode.window.showInformationMessage(`正在删除远程分支 origin/${branchName}...`);
              await this.gitService.deleteRemoteBranch(cwd, branchName);
              vscode.window.showInformationMessage(`🗑️ 已成功删除远程分支: origin/${branchName}`);
            }
          }

          await this.refreshStatus(cwd, true);
        } catch (err: any) {
          vscode.window.showErrorMessage(`远程分支操作失败: ${err.message}`);
        }
      });
    });

    remoteQuickPick.onDidHide(() => remoteQuickPick.dispose());
    remoteQuickPick.show();
  }

  async handleMergeBranch(cwd: string) {
    try {
      const { branches, current } = await this.gitService.getLocalBranches(cwd);
      const mergeableBranches = branches.filter((b) => b !== current);

      if (mergeableBranches.length === 0) {
        vscode.window.showInformationMessage('没有其他本地分支可供合并');
        return;
      }

      const items = mergeableBranches.map((b) => ({
        label: b,
        branchName: b,
      }));

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: `请选择要合并到【${current}】的本地分支`,
        matchOnDescription: true,
      });

      if (!selected) return;

      await this.executeGitOperation(async () => {
        try {
          await this.gitService.mergeBranch(cwd, selected.branchName);
          vscode.window.showInformationMessage(`🎉 已成功将 ${selected.branchName} 合并到 ${current}`);
          await this.refreshStatus(cwd, true);
        } catch (e: any) {
          await this.handleGitErrorWithConflictCheck(cwd, '合并分支', e.message);
        }
      });
    } catch (e: any) {
      vscode.window.showErrorMessage(`处理合并时出错: ${e.message}`);
    }
  }

  async handleChangeGraphFilter(cwd: string, currentBranch: string, msg: any) {
    try {
      const currentOption = this.gitService.CURRENT_BRANCH_FILTER;
      const allOption = this.gitService.ALL_BRANCH_FILTER;

      const quickPick = vscode.window.createQuickPick<vscode.QuickPickItem & { branchName: string }>();

      quickPick.placeholder = '选择要查看的分支记录 (支持搜索)';
      quickPick.matchOnDescription = true;

      const updateQuickPickItems = async () => {
        await this.withViewProgress(async () => {
          const branchNames = await this.gitService.getAllBranches(cwd);

          const items = [currentOption, allOption, ...branchNames].map((b) => ({
            label: b === currentBranch ? `$(check) ${b}` : b,
            description: b === currentBranch ? '当前选择' : undefined,
            branchName: b,
          }));

          const prevActive = quickPick.activeItems[0]?.branchName;

          quickPick.items = items;

          if (prevActive) {
            const newActive = items.find((i) => i.branchName === prevActive);

            if (newActive) {
              quickPick.activeItems = [newActive];
            }
          } else {
            const currentItem = items.find((i) => i.branchName === currentBranch);

            if (currentItem) {
              quickPick.activeItems = [currentItem];
            }
          }
        });
      };

      await updateQuickPickItems();
      quickPick.show();

      quickPick.busy = true;

      this.executeGitOperation(async () => {
        try {
          await this.gitService.fetchAllPrune(cwd);
          await updateQuickPickItems();
        } catch {
          // ignore
        }
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
        const graphData = await this.gitService.getGraph(cwd, selectedBranch);

        this.view?.webview.postMessage({
          type: 'graphData',
          graphCommits: graphData.graphCommits,
          graphFilter: graphData.graphFilter,
          totalCommits: graphData.totalCommits,
        });
      });
    } catch (e: any) {
      vscode.window.showErrorMessage(`获取分支记录失败: ${e.message}`);
    }
  }
}
