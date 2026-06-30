import * as vscode from 'vscode';
import * as path from 'path';
import { IFeature } from '../core/interfaces/IFeature';
import ColorLog from '../utils/ColorLog';
import { RecentProjectsProvider } from '../providers/RecentProjectsProvider';
import { ReadOnlyFileSystemProvider } from '../providers/ReadOnlyFileSystemProvider';

export class RecentProjectsFeature implements IFeature {
  public readonly id = 'RecentProjectsFeature';

  private refreshTimer: NodeJS.Timeout | undefined;

  public activate(context: vscode.ExtensionContext): void {
    const provider = new RecentProjectsProvider(context);

    const roProvider = new ReadOnlyFileSystemProvider();
    const roDocRegistration = vscode.workspace.registerFileSystemProvider('quickops-ro', roProvider, {
      isReadonly: true,
    });

    /**
     * 只同步指定文件/文件夹的 metadata。
     *
     * 注意：
     * - 输入时 VS Code 会频繁触发 diagnostics 变化，不能走整棵树刷新；
     * - 保存文件只影响当前文件和它所在的父级文件夹状态；
     * - 切换应用回来只补当前激活文件，不刷新整棵树。
     */
    const requestPathMetadataSync = (
      targets: vscode.Uri | string | Array<vscode.Uri | string> | undefined,
      delay: number = 120
    ) => {
      if (!targets) {
        return;
      }

      (provider as any).requestPathMetadataSync(targets, delay);
    };

    /**
     * 结构变化才刷新树。
     *
     * 创建 / 删除 / 重命名会改变目录结构，所以这里可以 refreshExpandedTree。
     * 保存 / 输入 / diagnostics / 窗口聚焦都不要走这里。
     */
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

        provider.requestVisibleMetadataSync();
      }, 260);
    };

    const getRealDocumentUri = (uri: vscode.Uri): vscode.Uri | undefined => {
      if (uri.scheme === 'file') {
        return uri;
      }

      if (uri.scheme === 'quickops-ro') {
        const target = new URLSearchParams(uri.query).get('target');

        if (!target) {
          return undefined;
        }

        try {
          const targetUri = vscode.Uri.parse(target);

          return targetUri.scheme === 'file' ? targetUri : undefined;
        } catch {
          return undefined;
        }
      }

      return undefined;
    };

    const getActiveFileUri = () => {
      const activeUri = vscode.window.activeTextEditor?.document.uri;

      return activeUri ? getRealDocumentUri(activeUri) : undefined;
    };

    const isSameUri = (a: vscode.Uri, b: vscode.Uri) => {
      return a.toString() === b.toString() || a.fsPath === b.fsPath;
    };

    const roTargetRefreshWatcher = roProvider.onDidRefreshReadonlyTarget((event) => {
      requestPathMetadataSync(event.targetUri, 120);
    });

    const typingDocumentWatcher = vscode.workspace.onDidChangeTextDocument((event) => {
      const realUri = getRealDocumentUri(event.document.uri);

      if (!realUri) {
        return;
      }

      if (event.document.isDirty) {
        (provider as any).requestDirtyDocumentMetadataSync(event.document, 90);
        return;
      }

      requestPathMetadataSync(realUri, 120);
    });

    const saveDocumentWatcher = vscode.workspace.onDidSaveTextDocument((document) => {
      const realUri = getRealDocumentUri(document.uri);

      if (!realUri) {
        return;
      }

      roProvider.refreshByTargetUri(realUri);
      (provider as any).requestSavedDocumentMetadataSync(document, 80);
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

    const diagnosticsWatcher = vscode.languages.onDidChangeDiagnostics((event) => {
      const changedUris = event.uris.filter((uri) => uri.scheme === 'file');

      if (changedUris.length === 0) {
        return;
      }

      /**
       * 用户输入时 diagnostics 可能带出一堆相关文件。
       * 这里优先只更新当前正在输入的文件，避免整棵树/大量文件跟着闪。
       */
      const activeUri = getActiveFileUri();

      if (activeUri && changedUris.some((uri) => isSameUri(uri, activeUri))) {
        requestPathMetadataSync(activeUri, 180);
        return;
      }

      requestPathMetadataSync(changedUris, 180);
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
                provider.requestVisibleMetadataSync();
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
                provider.requestVisibleMetadataSync();
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

          provider.requestVisibleMetadataSync();
        }
      });

      quickPick.show();
    });

    const refreshCmd = vscode.commands.registerCommand('quickOps.refreshRecentProjects', async () => {
      provider.refresh(true);
      roProvider.refreshAllWatched();
      await provider.syncAllBranches();
      provider.requestVisibleMetadataSync();
    });

    const clearCmd = vscode.commands.registerCommand('quickOps.clearRecentProjects', () => provider.clearAll());
    const syncCmd = vscode.commands.registerCommand('quickOps.syncBranches', async () => {
      await provider.syncAllBranches();
      provider.requestVisibleMetadataSync();
    });

    const selectForCompareCmd = vscode.commands.registerCommand('quickOps.selectForCompare', (uri: vscode.Uri) => {
      if (uri) provider.selectForCompare(uri.toString());
    });

    const compareWithSelectedCmd = vscode.commands.registerCommand('quickOps.compareWithSelected', (uri: vscode.Uri) => {
      if (uri) provider.compareWithSelected(uri.toString());
    });

    const windowFocusWatcher = vscode.window.onDidChangeWindowState((event) => {
      if (!event.focused) {
        return;
      }

      const activeUri = getActiveFileUri();

      if (activeUri) {
        requestPathMetadataSync(activeUri, 320);
      }
    });

    /**
     * 监听 VS Code Git 仓库状态变化，刷新 file-status-badge。
     *
     * 说明：
     * - commit / reset / restore / discard / stage / unstage / checkout 都会改变 Git 状态；
     * - 这些变化不一定会触发 onDidSaveTextDocument / onDidCreateFiles / onDidDeleteFiles；
     * - 这里只刷新当前可见节点的 metadata，不刷新整棵树，避免树闪烁和展开状态丢失。
     */
    const registerGitStateWatcher = () => {
      const disposables: vscode.Disposable[] = [];
      const repoDisposables = new Map<any, vscode.Disposable>();
      let gitStateRefreshTimer: NodeJS.Timeout | undefined;

      const requestGitStateMetadataSync = (delay: number = 260) => {
        if (gitStateRefreshTimer) {
          clearTimeout(gitStateRefreshTimer);
        }

        gitStateRefreshTimer = setTimeout(() => {
          gitStateRefreshTimer = undefined;

          provider.requestVisibleMetadataSync();

          const activeUri = getActiveFileUri();

          if (activeUri) {
            requestPathMetadataSync(activeUri, 0);
          }
        }, delay);
      };

      const watchRepository = (repo: any) => {
        if (!repo || repoDisposables.has(repo)) {
          return;
        }

        const disposable = repo.state.onDidChange(() => {
          requestGitStateMetadataSync(260);
        });

        repoDisposables.set(repo, disposable);
        disposables.push(disposable);
      };

      const setupGitWatchers = async () => {
        try {
          const gitExtension = vscode.extensions.getExtension('vscode.git');

          if (!gitExtension) {
            return;
          }

          const gitExports = gitExtension.isActive
            ? gitExtension.exports
            : await gitExtension.activate();

          const gitApi = gitExports?.getAPI?.(1);

          if (!gitApi) {
            return;
          }

          gitApi.repositories.forEach((repo: any) => {
            watchRepository(repo);
          });

          disposables.push(
            gitApi.onDidOpenRepository((repo: any) => {
              watchRepository(repo);
              requestGitStateMetadataSync(120);
            })
          );

          disposables.push(
            gitApi.onDidCloseRepository((repo: any) => {
              const disposable = repoDisposables.get(repo);

              if (disposable) {
                disposable.dispose();
                repoDisposables.delete(repo);
              }

              requestGitStateMetadataSync(120);
            })
          );
        } catch (error) {
          console.warn('[Quick Ops] Git state watcher init failed:', error);
        }
      };

      void setupGitWatchers();

      return new vscode.Disposable(() => {
        if (gitStateRefreshTimer) {
          clearTimeout(gitStateRefreshTimer);
          gitStateRefreshTimer = undefined;
        }

        repoDisposables.forEach((disposable) => disposable.dispose());
        repoDisposables.clear();

        disposables.forEach((disposable) => disposable.dispose());
        disposables.length = 0;
      });
    };

    const gitStateWatcher = registerGitStateWatcher();

    context.subscriptions.push(
      webviewView,
      roDocRegistration,
      roTargetRefreshWatcher,
      roProvider,
      typingDocumentWatcher,
      saveDocumentWatcher,
      createFilesWatcher,
      deleteFilesWatcher,
      renameFilesWatcher,
      diagnosticsWatcher,
      windowFocusWatcher,
      gitStateWatcher,
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
      },
    });

    ColorLog.black(`[${this.id}]`, 'Activated.');
  }
}
