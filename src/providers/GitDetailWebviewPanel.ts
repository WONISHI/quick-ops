import * as vscode from 'vscode';
import * as path from 'path';
import { getReactWebviewHtml } from '../utils/WebviewHelper';
import GitService from '../services/GitService';

export class GitDetailWebviewPanel {
  private _panel?: vscode.WebviewPanel;
  private readonly gitService = new GitService();

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly getWorkspaceRoot: () => string | undefined,
  ) {}

  public open() {
    if (this._panel) {
      this._panel.reveal(vscode.ViewColumn.Active);

      const cwd = this.getWorkspaceRoot();

      if (cwd) {
        void this.postGraphData(cwd, '全部分支');
      }

      return;
    }

    this._panel = vscode.window.createWebviewPanel(
      'quickOps.gitDetail',
      'Git 提交详情',
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this._extensionUri],
      },
    );

    this._panel.onDidDispose(() => {
      this._panel = undefined;
    });

    this._panel.webview.onDidReceiveMessage(async (msg) => {
      try {
        if (msg.command === 'openExternal') {
          vscode.env.openExternal(vscode.Uri.parse(msg.url));
          return;
        }

        const cwd = this.getWorkspaceRoot();

        if (!cwd) {
          this._panel?.webview.postMessage({
            type: 'gitDetailNoWorkspace',
          });
          return;
        }

        switch (msg.command) {
          case 'gitDetailLoaded':
          case 'refreshGitDetail': {
            await this.postGraphData(cwd, msg.graphFilter || '全部分支');
            break;
          }

          case 'changeGitDetailFilter': {
            await this.changeGraphFilter(cwd, msg.current || '全部分支');
            break;
          }

          case 'openCommitMultiDiff': {
            await this.openCommitMultiDiff(cwd, msg.hash);
            break;
          }

          case 'copy': {
            vscode.env.clipboard.writeText(msg.text || '');
            vscode.window.showInformationMessage(`已复制: ${msg.text}`);
            break;
          }
        }
      } catch (error: any) {
        vscode.window.showErrorMessage(`Git 详情错误: ${error?.message ?? String(error)}`);

        this._panel?.webview.postMessage({
          type: 'gitDetailError',
          message: error?.message ?? String(error),
        });
      }
    });

    this._panel.webview.html = getReactWebviewHtml(this._extensionUri, this._panel.webview, '/git-detail');

    this._panel.iconPath = vscode.Uri.joinPath(this._extensionUri, 'resources', 'icons', 'git.png');

    const cwd = this.getWorkspaceRoot();

    if (cwd) {
      setTimeout(() => {
        void this.postGraphData(cwd, '全部分支');
      }, 300);
    } else {
      setTimeout(() => {
        this._panel?.webview.postMessage({
          type: 'gitDetailNoWorkspace',
        });
      }, 300);
    }
  }

  private async postGraphData(cwd: string, graphFilter: string) {
    const isRepo = await this.gitService.checkIsRepo(cwd);

    if (!isRepo) {
      this._panel?.webview.postMessage({
        type: 'gitDetailNotRepo',
      });
      return;
    }

    this._panel?.webview.postMessage({
      type: 'gitDetailLoading',
    });

    const graphData = await this.gitService.getGraph(cwd, graphFilter);

    this._panel?.webview.postMessage({
      type: 'gitDetailGraphData',
      graphCommits: graphData.graphCommits,
      graphFilter: graphData.graphFilter,
      totalCommits: graphData.totalCommits,
      folderName: path.basename(cwd),
    });
  }

  private async changeGraphFilter(cwd: string, current: string) {
    const allOption = '全部分支';

    const quickPick = vscode.window.createQuickPick<vscode.QuickPickItem & { branchName: string }>();

    quickPick.placeholder = '选择要查看的分支记录 (支持搜索)';
    quickPick.matchOnDescription = true;

    const updateQuickPickItems = async () => {
      const branchNames = await this.gitService.getAllBranches(cwd);

      const items = [allOption, ...branchNames].map((b) => ({
        label: b === current ? `$(check) ${b}` : b,
        description: b === current ? '当前选择' : undefined,
        branchName: b,
      }));

      quickPick.items = items;

      const currentItem = items.find((i) => i.branchName === current);

      if (currentItem) {
        quickPick.activeItems = [currentItem];
      }
    };

    await updateQuickPickItems();
    quickPick.show();

    quickPick.busy = true;

    this.gitService
      .fetchAllPrune(cwd)
      .then(updateQuickPickItems)
      .catch(() => {})
      .finally(() => {
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

    await this.postGraphData(cwd, selectedBranch);
  }

  private createGitContentUri(cwd: string, ref: string, file: string): vscode.Uri {
    const query = encodeURIComponent(JSON.stringify({ cwd, ref }));
    return vscode.Uri.parse(`quickops-git:///${file}?${query}`);
  }

  private async openCommitMultiDiff(cwd: string, hash: string) {
    if (!hash) return;

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
  }
}

export default GitDetailWebviewPanel;