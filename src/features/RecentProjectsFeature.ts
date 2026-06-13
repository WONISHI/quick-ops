import * as vscode from 'vscode';
import * as path from 'path';
import { IFeature } from '../core/interfaces/IFeature';
import ColorLog from '../utils/ColorLog';
import { RecentProjectsProvider } from '../providers/RecentProjectsProvider';
import { ReadOnlyFileSystemProvider } from '../providers/ReadOnlyFileSystemProvider';

export class RecentProjectsFeature implements IFeature {
  public readonly id = 'RecentProjectsFeature';

  private refreshTimer: NodeJS.Timeout | undefined;
  private metadataTimer: NodeJS.Timeout | undefined;

  public activate(context: vscode.ExtensionContext): void {
    const provider = new RecentProjectsProvider(context);

    const roProvider = new ReadOnlyFileSystemProvider();
    const roDocRegistration = vscode.workspace.registerFileSystemProvider('quickops-ro', roProvider, {
      isReadonly: true,
    });

    const requestMetadataSync = () => {
      if (this.metadataTimer) {
        clearTimeout(this.metadataTimer);
      }

      this.metadataTimer = setTimeout(() => {
        this.metadataTimer = undefined;
        provider.requestVisibleMetadataSync();
      }, 120);
    };

    const requestRefresh = (refreshExpandedTree: boolean = true) => {
      if (this.refreshTimer) {
        clearTimeout(this.refreshTimer);
      }

      this.refreshTimer = setTimeout(() => {
        this.refreshTimer = undefined;

        provider.refresh(refreshExpandedTree);
        roProvider.refreshAllWatched();

        const currentActivePath = (provider as any).currentActivePath;

        if (currentActivePath) {
          (provider as any).setActivePath(currentActivePath);
        }

        requestMetadataSync();
      }, 200);
    };

    const roTargetRefreshWatcher = roProvider.onDidRefreshReadonlyTarget(() => {
      provider.refresh(true);
      requestMetadataSync();
    });

    const saveDocumentWatcher = vscode.workspace.onDidSaveTextDocument((document) => {
      if (document.uri.scheme !== 'file') {
        return;
      }

      requestRefresh(true);
    });

    const createFilesWatcher = vscode.workspace.onDidCreateFiles(() => {
      requestRefresh(true);
    });

    const deleteFilesWatcher = vscode.workspace.onDidDeleteFiles(() => {
      requestRefresh(true);
    });

    const renameFilesWatcher = vscode.workspace.onDidRenameFiles(() => {
      requestRefresh(true);
    });

    const diagnosticsWatcher = vscode.languages.onDidChangeDiagnostics(() => {
      requestMetadataSync();
    });

    const webviewView = vscode.window.registerWebviewViewProvider('quickOps.recentProjectsView', provider, {
      webviewOptions: {
        retainContextWhenHidden: true,
      },
    });

    const revealCmd = vscode.commands.registerCommand('quickOps.revealInRecentProjects', () => {
      provider.revealCurrentActive();
    });

    const addCmd = vscode.commands.registerCommand('quickOps.addRecentProject', async () => {
      const quickPick = vscode.window.createQuickPick();
      quickPick.placeholder = '直接输入本地绝对路径或远程URL按回车，或在下方选择';
      quickPick.items = [
        { label: '$(folder) 浏览本地项目...', description: '打开系统文件夹选择器', alwaysShow: true },
        { label: '$(repo) 填写远程仓库...', description: '手动输入添加 GitHub / GitLab 链接', alwaysShow: true },
      ];

      quickPick.onDidChangeValue((value) => {
        if (value.trim()) {
          const isRemote = /^(https?:\/\/|git@|vscode-vfs:\/\/)/i.test(value.trim()) || /^([^/]+\/[^/]+)$/.test(value.trim());
          quickPick.items = [
            {
              label: isRemote ? '$(repo) 识别为【远程仓库】并添加' : '$(folder) 识别为【本地项目】并添加',
              description: value,
              alwaysShow: true,
            },
            { label: '$(folder) 浏览本地项目...', description: '打开系统文件夹选择器', alwaysShow: true },
            { label: '$(repo) 填写远程仓库...', description: '手动输入添加 GitHub / GitLab 链接', alwaysShow: true },
          ];
        } else {
          quickPick.items = [
            { label: '$(folder) 浏览本地项目...', description: '打开系统文件夹选择器', alwaysShow: true },
            { label: '$(repo) 填写远程仓库...', description: '手动输入添加 GitHub / GitLab 链接', alwaysShow: true },
          ];
        }
      });

      quickPick.onDidAccept(async () => {
        const inputValue = quickPick.value.trim();
        const selected = quickPick.selectedItems[0];
        quickPick.hide();
        quickPick.dispose();

        if (inputValue && selected.description === inputValue) {
          const isRemote = /^(https?:\/\/|git@|vscode-vfs:\/\/)/i.test(inputValue) || /^([^/]+\/[^/]+)$/.test(inputValue);

          if (isRemote) {
            const parsed = (provider as any).parseRemoteUrlInput(inputValue);

            if (parsed) {
              const existingProjects = (provider as any).getRecentProjects();

              if (existingProjects.some((p: any) => p.fsPath === parsed.targetUriStr)) {
                vscode.window.showWarningMessage('⚠️ 该远程项目已存在于列表中！');
                return;
              }

              const projectName = await vscode.window.showInputBox({
                prompt: '确认远程项目名称',
                value: parsed.repoFullName.split('/').pop() || parsed.repoFullName,
              });

              if (projectName) {
                await (provider as any).insertProjectToHistory(projectName, parsed.targetUriStr, parsed.platform, parsed.customDomain);
                vscode.window.showInformationMessage(`✅ 已添加远程项目: ${projectName}`);
                requestMetadataSync();
              }
            } else {
              vscode.window.showErrorMessage('❌ 无效的远程地址格式，请检查。');
            }
          } else {
            try {
              const localUri = vscode.Uri.file(inputValue);
              const stat = await vscode.workspace.fs.stat(localUri);

              if ((stat.type & vscode.FileType.Directory) !== 0) {
                const uriStr = localUri.toString();
                const existingProjects = (provider as any).getRecentProjects();

                if (existingProjects.some((p: any) => p.fsPath === uriStr)) {
                  vscode.window.showWarningMessage('⚠️ 该本地项目已存在于列表中！');
                  return;
                }

                const folderName = path.basename(inputValue) || '本地项目';
                await (provider as any).insertProjectToHistory(folderName, uriStr);
                vscode.window.showInformationMessage(`✅ 已添加本地项目: ${folderName}`);
                requestMetadataSync();
              } else {
                vscode.window.showErrorMessage('❌ 输入的路径是一个文件，请提供文件夹路径。');
              }
            } catch {
              vscode.window.showErrorMessage('❌ 找不到该本地路径，请检查拼写是否正确。');
            }
          }
        } else if (selected) {
          if (selected.label.includes('浏览本地项目')) {
            await provider.addLocalProject();
          } else if (selected.label.includes('填写远程仓库')) {
            await provider.addRemoteProject();
          }

          requestMetadataSync();
        }
      });

      quickPick.show();
    });

    const refreshCmd = vscode.commands.registerCommand('quickOps.refreshRecentProjects', async () => {
      provider.refresh(true);
      roProvider.refreshAllWatched();
      await provider.syncAllBranches();
      requestMetadataSync();
    });

    const clearCmd = vscode.commands.registerCommand('quickOps.clearRecentProjects', () => provider.clearAll());
    const syncCmd = vscode.commands.registerCommand('quickOps.syncBranches', async () => {
      await provider.syncAllBranches();
      requestMetadataSync();
    });

    const selectForCompareCmd = vscode.commands.registerCommand('quickOps.selectForCompare', (uri: vscode.Uri) => {
      if (uri) provider.selectForCompare(uri.toString());
    });

    const compareWithSelectedCmd = vscode.commands.registerCommand('quickOps.compareWithSelected', (uri: vscode.Uri) => {
      if (uri) provider.compareWithSelected(uri.toString());
    });

    const windowFocusWatcher = vscode.window.onDidChangeWindowState((event) => {
      if (event.focused) {
        requestRefresh(true);
      }
    });

    context.subscriptions.push(
      webviewView,
      roDocRegistration,
      roTargetRefreshWatcher,
      roProvider,
      saveDocumentWatcher,
      createFilesWatcher,
      deleteFilesWatcher,
      renameFilesWatcher,
      diagnosticsWatcher,
      windowFocusWatcher,
      revealCmd,
      addCmd,
      refreshCmd,
      syncCmd,
      clearCmd,
      selectForCompareCmd,
      compareWithSelectedCmd
    );

    context.subscriptions.push({
      dispose: () => {
        if (this.refreshTimer) {
          clearTimeout(this.refreshTimer);
          this.refreshTimer = undefined;
        }

        if (this.metadataTimer) {
          clearTimeout(this.metadataTimer);
          this.metadataTimer = undefined;
        }
      },
    });

    ColorLog.black(`[${this.id}]`, 'Activated.');
  }
}
