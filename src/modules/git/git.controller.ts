import * as vscode from 'vscode';
import * as path from 'path';
import ColorLog from '@utils/ColorLog';
import type { OnModuleInit } from '@core/lifecycle/lifecycle.interface';
import { ExtensionContextProvider } from '@common/providers/extension-context.provider';
import { GitService } from '@modules/git/git.service';
import { GitWebviewProvider } from '@modules/git/providers/git-webview.provider';
import { GitDetailWebviewProvider } from '@modules/git/providers/git-detail-webview.provider';
import { GitVirtualContentProvider } from '@modules/git/providers/git-virtual-content.provider';
import { GIT_COMMANDS, GIT_STATE_KEYS, GIT_VIEW_IDS } from '@modules/git/git.constant';

export class GitController implements OnModuleInit {
  public static inject = [
    ExtensionContextProvider,
    GitService,
    GitWebviewProvider,
    GitDetailWebviewProvider,
    GitVirtualContentProvider,
  ];

  private readonly id = 'GitModule';

  private refreshTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly extensionContextProvider: ExtensionContextProvider,
    private readonly gitService: GitService,
    private readonly gitWebviewProvider: GitWebviewProvider,
    private readonly gitDetailWebviewProvider: GitDetailWebviewProvider,
    private readonly gitVirtualContentProvider: GitVirtualContentProvider,
  ) {}

  public async onModuleInit(): Promise<void> {
    /**
     * 关键：
     * GitVirtualContentProvider 不再通过 static inject 注入 GitService，
     * 这里手动传入已经由容器创建好的 GitService 实例。
     */
    this.gitVirtualContentProvider.setGitService(this.gitService);

    this.registerProviders();
    this.registerCommands();
    this.registerListeners();

    await this.gitService.initializeConfigSync();

    const defaultWorkspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    await this.applyPreviewPath(defaultWorkspace);

    ColorLog.black(`[${this.id}]`, 'Activated.');
  }

  public dispose(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }

    this.gitWebviewProvider.dispose();
    this.gitDetailWebviewProvider.dispose();
    this.gitVirtualContentProvider.dispose();
    this.gitService.dispose();
  }

  private registerProviders(): void {
    this.extensionContextProvider.register(
      vscode.window.registerWebviewViewProvider(
        GIT_VIEW_IDS.main,
        this.gitWebviewProvider,
        {
          webviewOptions: {
            retainContextWhenHidden: true,
          },
        },
      ),

      vscode.workspace.registerTextDocumentContentProvider(
        'quickops-git',
        this.gitVirtualContentProvider,
      ),
    );
  }

  private registerCommands(): void {
    this.extensionContextProvider.register(
      vscode.commands.registerCommand(GIT_COMMANDS.openGitDetail, async () => {
        await this.gitDetailWebviewProvider.open();
      }),

      vscode.commands.registerCommand(GIT_COMMANDS.refreshGit, async () => {
        await this.gitWebviewProvider.refresh();

        await this.gitDetailWebviewProvider.refresh(undefined, {
          silent: true,
          fetchRemote: false,
        });
      }),

      vscode.commands.registerCommand(GIT_COMMANDS.switchGitProject, async () => {
        await this.showSwitchGitProjectQuickPick();
      }),

      vscode.commands.registerCommand(GIT_COMMANDS.cloneGitProject, async () => {
        await this.gitService.cloneGitProjectByInput();
      }),

      vscode.commands.registerCommand(GIT_COMMANDS.openProject, async () => {
        await this.gitService.openCurrentPreviewProject();
      }),

      vscode.commands.registerCommand(GIT_COMMANDS.editRemoteUrl, async () => {
        await this.gitService.editCurrentRemoteUrl();
        await this.gitWebviewProvider.refresh();

        await this.gitDetailWebviewProvider.refresh(undefined, {
          silent: true,
          fetchRemote: false,
        });
      }),

      vscode.commands.registerCommand(GIT_COMMANDS.returnToWorkspace, async () => {
        await this.gitService.returnToWorkspace();

        const currentPath = this.gitService.getCurrentWorkingDir();

        await this.gitWebviewProvider.setCustomWorkspace(currentPath || null);

        await this.gitWebviewProvider.refresh();

        await this.gitDetailWebviewProvider.refresh(currentPath, {
          silent: true,
          fetchRemote: false,
        });
      }),

      vscode.commands.registerCommand(
        GIT_COMMANDS.openFile,
        async (filePath?: string, workingDir?: string) => {
          if (!filePath) return;

          await this.gitService.openFile({
            filePath,
            workingDir: workingDir || this.gitService.getCurrentWorkingDir(),
            preview: false,
          });
        },
      ),

      vscode.commands.registerCommand(
        GIT_COMMANDS.openDiff,
        async (filePath?: string, workingDir?: string) => {
          if (!filePath) return;

          await this.gitService.openFileDiff({
            filePath,
            workingDir: workingDir || this.gitService.getCurrentWorkingDir(),
          });
        },
      ),
    );
  }

  private registerListeners(): void {
    this.extensionContextProvider.register(
      vscode.workspace.onDidSaveTextDocument(() => {
        this.requestRefresh();
      }),

      vscode.workspace.onDidCreateFiles(() => {
        this.requestRefresh();
      }),

      vscode.workspace.onDidDeleteFiles(() => {
        this.requestRefresh();
      }),

      vscode.workspace.onDidRenameFiles(() => {
        this.requestRefresh();
      }),

      vscode.window.onDidChangeActiveTextEditor(() => {
        this.requestRefresh();
      }),

      vscode.workspace.onDidChangeConfiguration(event => {
        void this.gitService.handleConfigurationChange(event);
      }),
    );
  }

  private async applyPreviewPath(
    targetPath: string | undefined,
  ): Promise<void> {
    await this.gitWebviewProvider.setCustomWorkspace(targetPath || null);

    this.gitDetailWebviewProvider.refresh(undefined, {
      silent: true,
      fetchRemote: false,
    });
  }

  private async showSwitchGitProjectQuickPick(): Promise<void> {
    type GitProjectRecord = {
      name: string;
      customName?: string;
      fsPath: string;
      branch?: string;
    };

    type GitProjectQuickPickItem = vscode.QuickPickItem & {
      targetPath: string;
    };

    const context = this.extensionContextProvider.getContext();
    const quickPick = vscode.window.createQuickPick<GitProjectQuickPickItem>();

    quickPick.placeholder = '输入关键字搜索历史项目...';
    quickPick.title = '切换 / 预览 Git 项目';
    quickPick.matchOnDescription = true;
    quickPick.ignoreFocusOut = true;

    const addProjectButton: vscode.QuickInputButton = {
      iconPath: new vscode.ThemeIcon('add'),
      tooltip: '添加本地文件夹到 Git 记录中',
    };

    const deleteButton: vscode.QuickInputButton = {
      iconPath: new vscode.ThemeIcon('trash'),
      tooltip: '删除此记录',
    };

    quickPick.buttons = [addProjectButton];

    let activeItem: GitProjectQuickPickItem | undefined;

    const toNativePath = (value: string): string => {
      if (!value) return '';

      if (value.startsWith('file://')) {
        try {
          return vscode.Uri.parse(value).fsPath;
        } catch {
          return value;
        }
      }

      return value;
    };

    const readProjects = (): GitProjectRecord[] => {
      const gitProjects = context.globalState.get<GitProjectRecord[]>(
        GIT_STATE_KEYS.gitProjects,
        [],
      );

      if (gitProjects.length > 0) {
        return gitProjects;
      }

      const legacyRecentProjects = context.globalState.get<GitProjectRecord[]>(
        GIT_STATE_KEYS.recentProjects,
        [],
      );

      if (legacyRecentProjects.length > 0) {
        return legacyRecentProjects;
      }

      return context.globalState.get<GitProjectRecord[]>(
        GIT_STATE_KEYS.recentProjectsCurrent,
        [],
      );
    };

    const refreshItems = async (): Promise<void> => {
      const projects = [...readProjects()];
      const defaultWorkspace =
        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

      if (defaultWorkspace) {
        const exists = projects.some(project => {
          return toNativePath(project.fsPath) === defaultWorkspace;
        });

        if (!exists) {
          projects.unshift({
            name: path.basename(defaultWorkspace),
            fsPath: defaultWorkspace,
            branch: '',
          });
        }
      }

      await context.globalState.update(
        GIT_STATE_KEYS.gitProjects,
        projects,
      );

      const currentPreviewPath = toNativePath(
        this.gitWebviewProvider.getWorkspaceRoot() || '',
      );

      const items: GitProjectQuickPickItem[] = [];

      activeItem = undefined;

      if (projects.length > 0) {
        items.push({
          label: '最近项目',
          kind: vscode.QuickPickItemKind.Separator,
          targetPath: '',
        });
      }

      for (const project of projects) {
        const rawPath = project.fsPath;
        const targetPath = toNativePath(rawPath);
        const isRemote =
          /^(vscode-vfs:\/\/|https?:\/\/|ssh:\/\/|git@)/i.test(rawPath);
        const isCurrent = targetPath === currentPreviewPath;
        const projectName = project.customName || project.name;
        const branchText = project.branch ? ` : ${project.branch}` : '';
        const currentText = isCurrent ? ' 【当前预览】' : '';

        let decodedPath = targetPath;

        try {
          decodedPath = decodeURIComponent(targetPath);
        } catch {
          decodedPath = targetPath;
        }

        const item: GitProjectQuickPickItem = {
          label: `${isRemote ? '$(repo)' : '$(folder)'} ${projectName}`,
          description: `${projectName}${branchText}${currentText}`,
          detail: decodedPath,
          targetPath: rawPath,
          buttons: isCurrent ? [] : [deleteButton],
        };

        items.push(item);

        if (isCurrent) {
          activeItem = item;
        }
      }

      quickPick.items = items;

      if (activeItem) {
        quickPick.activeItems = [activeItem];
      }
    };

    await refreshItems();

    quickPick.onDidChangeValue(value => {
      if (!value && activeItem) {
        quickPick.activeItems = [activeItem];
      }
    });

    quickPick.onDidTriggerButton(async button => {
      if (button !== addProjectButton) return;

      quickPick.hide();

      const folders = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: '添加到 Git 预览',
      });

      const selectedFolder = folders?.[0];

      if (!selectedFolder) return;

      const targetPath = selectedFolder.fsPath;
      const projects = readProjects().filter(project => {
        return toNativePath(project.fsPath) !== targetPath;
      });

      projects.unshift({
        name: path.basename(targetPath),
        fsPath: targetPath,
        branch: '',
      });

      await context.globalState.update(
        GIT_STATE_KEYS.gitProjects,
        projects,
      );

      await this.applyPreviewPath(targetPath);

      vscode.window.showInformationMessage(
        '✅ 已添加并切换到该项目的 Git 预览。',
      );
    });

    quickPick.onDidTriggerItemButton(async event => {
      if (event.button !== deleteButton) return;

      const displayName = event.item.label.replace(/\$\(.*?\)\s*/, '');
      const confirm = await vscode.window.showWarningMessage(
        `确定要从 Git 记录中删除项目 [ ${displayName} ] 吗？`,
        {
          modal: true,
        },
        '删除',
      );

      if (confirm !== '删除') return;

      const deletedPath = toNativePath(event.item.targetPath);
      const projects = readProjects().filter(project => {
        return toNativePath(project.fsPath) !== deletedPath;
      });

      await context.globalState.update(
        GIT_STATE_KEYS.gitProjects,
        projects,
      );

      vscode.window.showInformationMessage('🗑️ 已删除记录。');

      const currentPreviewPath = toNativePath(
        this.gitWebviewProvider.getWorkspaceRoot() || '',
      );

      if (currentPreviewPath === deletedPath) {
        await this.applyPreviewPath(
          vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
        );
      }

      await refreshItems();
    });

    quickPick.onDidAccept(async () => {
      const selected = quickPick.selectedItems[0];

      if (!selected || selected.kind === vscode.QuickPickItemKind.Separator) {
        return;
      }

      quickPick.hide();

      const targetPath = selected.targetPath;
      const isRemote =
        /^(vscode-vfs:\/\/|https?:\/\/|ssh:\/\/|git@)/i.test(targetPath);

      if (isRemote) {
        if (targetPath.startsWith('git@')) {
          vscode.window.showWarningMessage(
            '纯 SSH 格式不支持直接打开，请先克隆为本地仓库。',
          );

          return;
        }

        try {
          const uri = vscode.Uri.parse(targetPath);
          const displayName = selected.label.replace(/\$\(.*?\)\s*/, '');
          const choice = await vscode.window.showInformationMessage(
            `远程仓库 [ ${displayName} ] 无法直接进行本地 Git 预览，是否作为工作区打开？`,
            {
              modal: true,
            },
            '在当前窗口打开',
            '在新窗口打开',
          );

          if (choice === '在当前窗口打开') {
            await vscode.commands.executeCommand(
              'vscode.openFolder',
              uri,
              false,
            );
          } else if (choice === '在新窗口打开') {
            await vscode.commands.executeCommand(
              'vscode.openFolder',
              uri,
              true,
            );
          }
        } catch {
          vscode.window.showErrorMessage('打开远程项目失败，路径可能无效。');
        }

        return;
      }

      await this.applyPreviewPath(toNativePath(targetPath));
    });

    quickPick.onDidHide(() => {
      quickPick.dispose();
    });

    quickPick.show();
  }

  private requestRefresh(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }

    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;

      void this.gitWebviewProvider.refresh();

      void this.gitDetailWebviewProvider.refresh(undefined, {
        silent: true,
        fetchRemote: false,
      });
    }, 250);
  }
}