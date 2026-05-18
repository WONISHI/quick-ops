import * as vscode from 'vscode';
import * as path from 'path';
import type GitService from '../../services/GitService';

export class CompareHandler {
  constructor(
    private gitService: GitService,
    private view: vscode.WebviewView | undefined,
    private withViewProgress: <T>(task: () => Promise<T>) => Promise<T>,
    private executeGitOperation: (operation: () => Promise<void> | void) => Promise<void>,
    private createGitContentUri: (cwd: string, ref: string, file: string) => vscode.Uri,
    private openChangesEditor: (cwd: string, title: string, files: any[], mode: 'working' | 'staged') => Promise<void>,
  ) {}

  async handleOpenStagedChanges(cwd: string) {
    await this.withViewProgress(async () => {
      const files = await this.gitService.getStagedChangeFiles(cwd);
      await this.openChangesEditor(cwd, '暂存区更改', files, 'staged');
    });
  }

  async handleOpenWorkingTreeChanges(cwd: string) {
    await this.withViewProgress(async () => {
      const files = await this.gitService.getWorkingTreeChangeFiles(cwd);
      await this.openChangesEditor(cwd, '工作区更改', files, 'working');
    });
  }

  async handleViewFileHistory(cwd: string, file: string) {
    try {
      await this.withViewProgress(async () => {
        const commits = await this.gitService.getFileHistory(cwd, file);
        const fileName = file.split('/').pop() || file;

        this.view?.webview.postMessage({
          type: 'compareData',
          baseBranch: '文件历史',
          targetBranch: fileName,
          commits,
        });
      });
    } catch (e: any) {
      vscode.window.showErrorMessage(`获取文件历史失败: ${e.message}`);
    }
  }

  async handleRequestCompare(cwd: string) {
    try {
      const quickPick = vscode.window.createQuickPick<vscode.QuickPickItem & { branchName: string }>();

      quickPick.placeholder = '1/2: 请选择【基准分支】(Base Branch，支持远程分支)';
      quickPick.matchOnDescription = true;

      const updateQuickPickItems = async () => {
        await this.withViewProgress(async () => {
          const branchNames = await this.gitService.getAllBranches(cwd);
          const prevActive = quickPick.activeItems[0]?.branchName;

          const items = branchNames.map((b) => ({
            label: b,
            branchName: b,
          }));

          quickPick.items = items;

          if (prevActive) {
            const newActive = items.find((i) => i.branchName === prevActive);

            if (newActive) {
              quickPick.activeItems = [newActive];
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
        const branchesAfterFetch = await this.gitService.getAllBranches(cwd);
        const branchNamesAfterFetch = branchesAfterFetch.filter((b) => b !== baseBranch);

        targetBranch = await vscode.window.showQuickPick(branchNamesAfterFetch, {
          placeHolder: `2/2: 请选择【目标分支】(查看 ${baseBranch} 中没有的记录)`,
          matchOnDescription: true,
        });
      });

      if (!targetBranch) return;

      await this.withViewProgress(async () => {
        const commits = await this.gitService.getCompareCommits(cwd, baseBranch, targetBranch!);

        this.view?.webview.postMessage({
          type: 'compareData',
          baseBranch,
          targetBranch,
          commits,
        });
      });
    } catch (e: any) {
      vscode.window.showErrorMessage(`对比分支失败: ${e.message}`);
    }
  }

  async handleCompareFileAcrossBranches(cwd: string, baseBranch: string | undefined, targetBranch: string | undefined) {
    try {
      if (!baseBranch || !targetBranch) {
        const quickPick = vscode.window.createQuickPick<vscode.QuickPickItem & { branchName: string }>();

        quickPick.placeholder = '1/2: 请选择【基准分支】(Base Branch，支持远程分支)';
        quickPick.matchOnDescription = true;

        const updateQuickPickItems = async () => {
          await this.withViewProgress(async () => {
            const branchNames = await this.gitService.getAllBranches(cwd);
            const prevActive = quickPick.activeItems[0]?.branchName;

            const items = branchNames.map((b) => ({
              label: b,
              branchName: b,
            }));

            quickPick.items = items;

            if (prevActive) {
              const newActive = items.find((i) => i.branchName === prevActive);

              if (newActive) {
                quickPick.activeItems = [newActive];
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

        baseBranch = await new Promise<string | undefined>((resolve) => {
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

        await this.withViewProgress(async () => {
          const branchesAfterFetch = await this.gitService.getAllBranches(cwd);
          const branchNamesAfterFetch = branchesAfterFetch.filter((b) => b !== baseBranch);

          targetBranch = await vscode.window.showQuickPick(branchNamesAfterFetch, {
            placeHolder: `2/2: 请选择【目标分支】(查看 ${baseBranch} 中没有的记录)`,
            matchOnDescription: true,
          });
        });

        if (!targetBranch) return;
      }

      await this.withViewProgress(async () => {
        const commits = await this.gitService.getCompareCommits(cwd, baseBranch!, targetBranch!);

        this.view?.webview.postMessage({
          type: 'compareData',
          baseBranch: baseBranch!,
          targetBranch: targetBranch!,
          commits,
        });
      });

      await this.withViewProgress(async () => {
        const diffFiles = await this.gitService.getDiffFilesBetweenBranches(cwd, baseBranch!, targetBranch!);

        if (diffFiles.length === 0) {
          vscode.window.showInformationMessage(`分支 ${baseBranch} 和 ${targetBranch} 之间没有任何文件差异。`);
          return;
        }

        const changesArgs = diffFiles.map((f) => {
          let leftRef = baseBranch!;
          let rightRef = targetBranch!;

          if (f.status === 'A') leftRef = 'empty';
          if (f.status === 'D') rightRef = 'empty';

          const leftUri = this.createGitContentUri(cwd, leftRef, f.file);
          const rightUri = this.createGitContentUri(cwd, rightRef, f.file);
          const fileUri = vscode.Uri.file(path.join(cwd, f.file));

          return [fileUri, leftUri, rightUri];
        });

        const title = `对比: ${baseBranch} ↔ ${targetBranch}`;

        await vscode.commands.executeCommand('vscode.changes', title, changesArgs);
      });
    } catch (e: any) {
      vscode.window.showErrorMessage(`跨分支对比失败: ${e.message}`);
    }
  }

  async handleOpenCommitMultiDiff(cwd: string, hash: string) {
    await this.withViewProgress(async () => {
      const result = await this.gitService.getCommitFiles(cwd, hash);
      const parentHash = result.parentHash;

      if (result.files.length === 0) return;

      const changesArgs = result.files.map((f) => {
        let leftRef = parentHash || 'empty';
        let rightRef = hash;

        if (f.status === 'A') leftRef = 'empty';
        if (f.status === 'D') rightRef = 'empty';

        const leftUri = this.createGitContentUri(cwd, leftRef, f.file);
        const rightUri = this.createGitContentUri(cwd, rightRef, f.file);
        const fileUri = vscode.Uri.file(path.join(cwd, f.file));

        return [fileUri, leftUri, rightUri];
      });

      const title = `Commit: ${hash.substring(0, 7)}`;

      await vscode.commands.executeCommand('vscode.changes', title, changesArgs);
    });
  }

  async handleDiff(cwd: string, file: string, status: string) {
    const fileUri = vscode.Uri.file(path.join(cwd, file));
    const defaultWorkspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const isCurrentWorkspace = defaultWorkspace && cwd === defaultWorkspace;

    if (status === 'C') {
      vscode.commands.executeCommand('vscode.open', fileUri);
    } else if (status === 'U' || status === 'A') {
      const emptyUri = this.createGitContentUri(cwd, 'empty', file);
      const rightUri = isCurrentWorkspace ? fileUri : this.createGitContentUri(cwd, 'working', file);

      vscode.commands.executeCommand('vscode.diff', emptyUri, rightUri, `${file} (未跟踪)`);
    } else {
      const originalUri = this.createGitContentUri(cwd, 'HEAD', file);
      const rightUri = isCurrentWorkspace ? fileUri : this.createGitContentUri(cwd, 'working', file);

      vscode.commands.executeCommand('vscode.diff', originalUri, rightUri, `${file} (工作树)`);
    }
  }

  async handleGetCommitFiles(cwd: string, hash: string) {
    await this.withViewProgress(async () => {
      const result = await this.gitService.getCommitFiles(cwd, hash);

      this.view?.webview.postMessage({
        type: 'commitFilesData',
        hash: result.hash,
        files: result.files,
        parentHash: result.parentHash,
      });
    });
  }

  async handleDiffBranchFile(cwd: string, baseBranch: string, targetBranch: string, file: string, status: string) {
    const leftUri = this.createGitContentUri(cwd, baseBranch, file);

    const rightRef = status === 'D' ? 'empty' : targetBranch;
    const rightUri = this.createGitContentUri(cwd, rightRef, file);

    const title = `${path.basename(file)} (${baseBranch} ↔ ${targetBranch.substring(0, 7)})`;

    vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title);
  }

  async handleDiffCommitFile(cwd: string, hash: string, parentHash: string | null, file: string, status: string) {
    const leftUri = this.createGitContentUri(cwd, parentHash || 'empty', file);

    const rightRef = status === 'D' ? 'empty' : hash;
    const rightUri = this.createGitContentUri(cwd, rightRef, file);

    const title = `${path.basename(file)} (${hash.substring(0, 7)})`;

    vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title);
  }
}
