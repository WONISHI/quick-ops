import * as vscode from 'vscode';
import { IFeature } from '../core/interfaces/IFeature';
import { GitWebviewProvider } from '../providers/GitWebviewProvider';
import ColorLog from '../utils/ColorLog';
import simpleGit from 'simple-git';
import { execFile } from 'child_process';
import * as path from 'path';

export class GitFeature implements IFeature {
  public readonly id = 'GitFeature';
  private _syncDepth = 0;

  private readonly RECENT_PROJECTS_STATE_KEY = 'quickOps.recentProjectsHistory';
  private readonly GIT_PROJECTS_STATE_KEY = 'quickOps.gitProjectsHistory';
  private readonly LAST_CLONE_PATH_KEY = 'quickOps.lastClonePath';
  private gitProvider!: GitWebviewProvider;
  private _currentPreviewPath: string | undefined;

  private createGit() {
    return simpleGit();
  }

  private getRepoFolderName(repoUrl: string): string {
    const cleanedUrl = repoUrl
      .trim()
      .replace(/\/+$/, '')
      .replace(/\.git$/i, '');
    let rawName = '';
    if (/^git@[^:]+:.+/i.test(cleanedUrl)) {
      rawName = cleanedUrl.substring(cleanedUrl.lastIndexOf(':') + 1);
    } else {
      rawName = cleanedUrl.substring(cleanedUrl.lastIndexOf('/') + 1);
    }
    const folderName = path
      .basename(rawName)
      .replace(/[\\/:*?"<>|]/g, '-')
      .trim();
    return folderName || 'repository';
  }

  private async runWithSyncLock(task: () => Promise<void>): Promise<void> {
    this._syncDepth++;
    try {
      await task();
    } finally {
      this._syncDepth--;
    }
  }

  private checkGitInstalled(): Promise<boolean> {
    return new Promise((resolve) => {
      execFile('git', ['--version'], (error) => {
        resolve(!error);
      });
    });
  }

  private async getGlobalGitUser() {
    const git = this.createGit();
    let name = '';
    let email = '';

    try {
      name = (await git.raw(['config', '--global', 'user.name'])).trim();
    } catch {}

    try {
      email = (await git.raw(['config', '--global', 'user.email'])).trim();
    } catch {}

    return { name, email };
  }

  private async syncGitToExtensionConfig(): Promise<void> {
    const { name, email } = await this.getGlobalGitUser();
    const config = vscode.workspace.getConfiguration('quick-ops.git');

    await this.runWithSyncLock(async () => {
      const updates: Thenable<void>[] = [];

      if (config.get<string>('userName') !== name) {
        updates.push(config.update('userName', name, vscode.ConfigurationTarget.Global));
      }

      if (config.get<string>('userEmail') !== email) {
        updates.push(config.update('userEmail', email, vscode.ConfigurationTarget.Global));
      }

      await Promise.all(updates);
    });
  }

  private async syncExtensionConfigToGit(): Promise<void> {
    const config = vscode.workspace.getConfiguration('quick-ops.git');
    const newName = config.get<string>('userName') ?? '';
    const newEmail = config.get<string>('userEmail') ?? '';

    const { name: oldName, email: oldEmail } = await this.getGlobalGitUser();

    if (newName === oldName && newEmail === oldEmail) return;

    const action = await vscode.window.showInformationMessage(
      `检测到 Git 账号信息更改，是否同步为 Git 全局配置？\n\n[用户名] ${oldName || '未设置'} ➜ ${newName || '未设置'}\n[邮箱] ${oldEmail || '未设置'} ➜ ${newEmail || '未设置'}`,
      { modal: true },
      '确认设置为全局',
    );

    if (action !== '确认设置为全局') {
      await this.runWithSyncLock(async () => {
        await config.update('userName', oldName, vscode.ConfigurationTarget.Global);
        await config.update('userEmail', oldEmail, vscode.ConfigurationTarget.Global);
      });
      return;
    }

    const git = this.createGit();

    if (newName !== oldName) {
      if (!newName) {
        await git.raw(['config', '--global', '--unset', 'user.name']).catch(() => {});
      } else {
        await git.raw(['config', '--global', 'user.name', newName]);
      }
    }

    if (newEmail !== oldEmail) {
      if (!newEmail) {
        await git.raw(['config', '--global', '--unset', 'user.email']).catch(() => {});
      } else {
        await git.raw(['config', '--global', 'user.email', newEmail]);
      }
    }

    vscode.window.showInformationMessage('✅ Git 全局用户信息已成功更新！');
  }

  private async handleConfigurationChange(e: vscode.ConfigurationChangeEvent): Promise<void> {
    if (this._syncDepth > 0) return;
    if (!e.affectsConfiguration('quick-ops.git.userName') && !e.affectsConfiguration('quick-ops.git.userEmail')) {
      return;
    }

    const isGitReady = await this.checkGitInstalled();
    if (!isGitReady) return;

    try {
      await this.syncExtensionConfigToGit();
    } catch (error: any) {
      vscode.window.showErrorMessage(`同步 Git 配置失败: ${error?.message ?? String(error)}`);
    }
  }

  private async initializeConfigSync(context: vscode.ExtensionContext): Promise<void> {
    const isInstalled = await this.checkGitInstalled();
    if (!isInstalled) return;

    await this.syncGitToExtensionConfig();

    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        void this.handleConfigurationChange(e);
      }),
    );
  }

  private async updateCurrentPreviewPath(newPath: string | undefined) {
    this._currentPreviewPath = newPath;
    this.gitProvider.setCustomWorkspace(newPath || null);

    let hasRemote = false;

    if (newPath) {
      try {
        const git = simpleGit(newPath);
        // 首先确认它是一个 Git 仓库
        const isRepo = await git.checkIsRepo();
        if (isRepo) {
          // 然后获取它的所有远程仓库
          const remotes = await git.getRemotes(true);
          if (remotes && remotes.length > 0) {
            hasRemote = true;
          }
        }
      } catch (e) {
        // 非 Git 仓库或无权限，静默忽略
      }
    }

    // 动态注入 Context，如果是有远程仓库的本地项目，右上角的 Settings 按钮就会出现
    vscode.commands.executeCommand('setContext', 'quickOps.hasGitRemote', hasRemote);
  }

  private registerEditRemoteUrlCommand(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
      vscode.commands.registerCommand('quickOps.editRemoteUrl', async () => {
        const currentPath = this._currentPreviewPath;
        if (!currentPath) return;

        const git = simpleGit(currentPath);
        let remotes: any[] = [];

        try {
          const isRepo = await git.checkIsRepo();
          if (!isRepo) return;
          remotes = await git.getRemotes(true);
        } catch (e) {
          vscode.window.showErrorMessage('无法读取 Git 配置。');
          return;
        }

        if (remotes.length === 0) {
          vscode.window.showInformationMessage('当前项目没有配置任何远程仓库。');
          return;
        }

        // 默认获取名为 origin 的远程仓库，如果没有就拿第一个
        const targetRemote = remotes.find((r) => r.name === 'origin') || remotes[0];
        // 提取当前的真实 URL
        const currentUrl = targetRemote.refs.push || targetRemote.refs.fetch || '';

        const newUrl = await vscode.window.showInputBox({
          prompt: `修改底层远程仓库 [${targetRemote.name}] 地址`,
          value: currentUrl,
          validateInput: (text) => {
            const val = text.trim();
            if (!val) return '地址不能为空';
            // 严谨正则：必须是合法的 http/https 网址，或者是 SSH 格式 (包含 ssh:// 或是 git@...)
            const isValid = /^(https?:\/\/|ssh:\/\/|git@[^:]+:.+)/i.test(val);
            return isValid ? null : '地址格式不正确，必须是有效的 HTTP 或 SSH 格式';
          },
        });

        if (newUrl !== undefined) {
          const trimmedUrl = newUrl.trim();
          if (trimmedUrl !== currentUrl) {
            try {
              // 🌟 真正执行 Git 命令来修改本地配置
              await git.remote(['set-url', targetRemote.name, trimmedUrl]);
              vscode.window.showInformationMessage(`✅ 已成功将 ${targetRemote.name} 地址修改为: ${trimmedUrl}`);

              // 刷新 Git 面板视图，让底层 Provider 也知道地址变了
              this.gitProvider.setCustomWorkspace(currentPath);
            } catch (e: any) {
              vscode.window.showErrorMessage(`修改远程仓库地址失败: ${e.message}`);
            }
          }
        }
      }),
    );
  }

  private registerReturnToWorkspaceCommand(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
      vscode.commands.registerCommand('quickOps.returnToWorkspace', async () => {
        const defaultWorkspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

        if (!defaultWorkspace) {
          vscode.window.showInformationMessage('当前没有打开任何工作区。');
          return;
        }

        let currentFsPath = this._currentPreviewPath || '';
        if (currentFsPath.startsWith('file://')) {
          currentFsPath = vscode.Uri.parse(currentFsPath).fsPath;
        }

        if (currentFsPath === defaultWorkspace) {
          vscode.window.showInformationMessage('当前已经在默认工作区的 Git 视图中。');
          return;
        }

        this.updateCurrentPreviewPath(defaultWorkspace);
        vscode.window.showInformationMessage('🎯 已返回当前工作区。');
      }),
    );
  }

  private registerCloneGitProjectCommand(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
      vscode.commands.registerCommand('quickOps.cloneGitProject', async () => {
        const isGitReady = await this.checkGitInstalled();

        if (!isGitReady) {
          vscode.window.showErrorMessage('当前环境未检测到 Git，请先安装 Git 后再克隆仓库。');
          return;
        }

        const inputUrl = await vscode.window.showInputBox({
          title: '克隆 Git 仓库',
          prompt: '请输入 Git 仓库地址，支持 HTTPS 或 SSH',
          placeHolder: '例如：https://github.com/user/repo.git 或 git@github.com:user/repo.git',
          ignoreFocusOut: true,
          validateInput: (value) => {
            const url = value
              .trim()
              .replace(/^git\s+clone\s+/i, '')
              .trim();

            if (!url) return '仓库地址不能为空';

            const isValid = /^(https?:\/\/|ssh:\/\/|git@[^:]+:.+)/i.test(url);

            return isValid ? null : '请输入有效的 Git HTTPS 或 SSH 地址';
          },
        });

        if (!inputUrl) return;

        const repoUrl = inputUrl
          .trim()
          .replace(/^git\s+clone\s+/i, '')
          .trim();
        let parentPath = '';

        // 🌟 1. 优化：记忆上一次克隆的目录
        const lastClonePath = context.globalState.get<string>(this.LAST_CLONE_PATH_KEY);

        if (lastClonePath) {
          const choice = await vscode.window.showQuickPick(
            [
              { label: '$(folder) 存放在上一次目录', description: lastClonePath, targetPath: lastClonePath },
              { label: '$(folder-opened) 选择新的存放目录...', description: '', targetPath: 'NEW' },
            ],
            {
              placeHolder: '请选择克隆存放的目录',
              ignoreFocusOut: true,
            },
          );

          if (!choice) return;

          if (choice.targetPath === 'NEW') {
            const folderUris = await vscode.window.showOpenDialog({
              title: '选择新仓库存放文件夹',
              openLabel: '克隆到此文件夹',
              canSelectFiles: false,
              canSelectFolders: true,
              canSelectMany: false,
            });
            if (!folderUris || !folderUris[0]) return;
            parentPath = folderUris[0].fsPath;
            // 更新缓存
            await context.globalState.update(this.LAST_CLONE_PATH_KEY, parentPath);
          } else {
            parentPath = choice.targetPath;
          }
        } else {
          // 没有历史记录，直接弹出选择框
          const folderUris = await vscode.window.showOpenDialog({
            title: '选择仓库存放文件夹',
            openLabel: '克隆到此文件夹',
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
          });
          if (!folderUris || !folderUris[0]) return;
          parentPath = folderUris[0].fsPath;
          // 记录本次选择
          await context.globalState.update(this.LAST_CLONE_PATH_KEY, parentPath);
        }

        const repoName = this.getRepoFolderName(repoUrl);
        const targetPath = path.join(parentPath, repoName);

        // 🌟 1. 检查目录是否已存在并确认覆盖
        let isTargetExist = false;
        try {
          await vscode.workspace.fs.stat(vscode.Uri.file(targetPath));
          isTargetExist = true;
        } catch {
          isTargetExist = false;
        }

        if (isTargetExist) {
          // 这里使用 warningMessage 更加规范，因为它涉及到删除操作，视觉上更清晰
          const confirmOverwrite = await vscode.window.showWarningMessage(`当前目录下已存在名为 [ ${repoName} ] 的文件夹。\n是否要删除原有文件夹并覆盖克隆？`, { modal: true }, '覆盖克隆');
          if (confirmOverwrite !== '覆盖克隆') return;
        }

        // 🌟 2. 获取远程分支列表 & 识别默认分支
        let targetBranch: string | undefined = undefined;
        let remoteBranches: string[] = [];
        let defaultBranch: string | undefined = undefined;

        try {
          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: '正在解析远程分支...',
              cancellable: false,
            },
            async () => {
              // 使用 --symref 可以直接拿到 HEAD 指向的默认分支信息
              const remoteOutput = await simpleGit().listRemote(['--symref', repoUrl]);

              // 提取默认分支
              const defaultMatch = remoteOutput.match(/ref:\s+refs\/heads\/(.+?)\s+HEAD/);
              if (defaultMatch) {
                defaultBranch = defaultMatch[1];
              }

              // 提取所有分支
              remoteBranches = remoteOutput
                .split('\n')
                .map((line) => {
                  const match = line.match(/^[0-9a-fA-F]+\s+refs\/heads\/(.+)$/);
                  return match ? match[1] : null;
                })
                .filter(Boolean) as string[];

              // 去重
              remoteBranches = [...new Set(remoteBranches)];
            },
          );
        } catch (error) {
          // 如果获取失败（如无权限/网络问题），静默跳过，按常规无参数 clone 兜底
        }

        // 🌟 3. 弹出分支选择（设置 activeItems 默认选中默认分支）
        if (remoteBranches.length === 1) {
          targetBranch = remoteBranches[0];
        } else if (remoteBranches.length > 1) {
          targetBranch = await new Promise<string | undefined>((resolve) => {
            const qp = vscode.window.createQuickPick();
            qp.title = `选择克隆分支 - ${repoName}`;
            qp.placeholder = '请选择要克隆的远程分支 (取消则放弃克隆)';
            qp.ignoreFocusOut = true;

            qp.items = remoteBranches.map((b) => ({
              label: b,
              description: b === defaultBranch ? '默认分支' : '',
            }));

            // 设置默认焦点
            if (defaultBranch) {
              const active = qp.items.find((i) => i.label === defaultBranch);
              if (active) qp.activeItems = [active];
            }

            qp.onDidAccept(() => {
              resolve(qp.selectedItems[0]?.label);
              qp.hide();
            });
            qp.onDidHide(() => {
              qp.dispose();
              resolve(undefined);
            });

            qp.show();
          });

          if (!targetBranch) return; // 用户取消了分支选择，终止流程
        }

        try {
          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: targetBranch ? `正在克隆 ${repoName} (分支: ${targetBranch})...` : `正在克隆 ${repoName}...`,
              cancellable: false,
            },
            async () => {
              // 🌟 4. 如果用户同意了覆盖，在开始克隆前将其删除 (useTrash: true 移入回收站防止误删无法挽回)
              if (isTargetExist) {
                await vscode.workspace.fs.delete(vscode.Uri.file(targetPath), { recursive: true, useTrash: true });
              }

              const cloneOptions = targetBranch ? ['-b', targetBranch] : [];
              await simpleGit().clone(repoUrl, targetPath, cloneOptions);
            },
          );

          // 🌟 4. 克隆完成后的操作选项
          const action = await vscode.window.showInformationMessage(`✅ 仓库已成功克隆到：${targetPath}`, '在当前窗口打开', '在新窗口打开');

          if (action === '在新窗口打开') {
            await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(targetPath), true);
          } else if (action === '在当前窗口打开') {
            // 🌟 5. 当前窗口打开时的覆盖警告（同截图设计）
            const confirm = await vscode.window.showWarningMessage(`确定要在当前窗口打开 [ ${repoName} ] 吗？\n这将会关闭您当前正在工作的工作区！`, { modal: true }, '确认覆盖打开');

            if (confirm === '确认覆盖打开') {
              await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(targetPath), false);
            }
          }
        } catch (error: any) {
          vscode.window.showErrorMessage(`克隆仓库失败: ${error?.message ?? String(error)}`);
        }
      }),
    );
  }

  private registerGitSwitchCommand(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
      vscode.commands.registerCommand('quickOps.switchGitProject', async () => {
        const quickPick = vscode.window.createQuickPick<vscode.QuickPickItem & { targetPath: string }>();
        quickPick.placeholder = '输入关键字搜索历史项目...';
        quickPick.title = '切换 / 预览 Git 项目';
        quickPick.matchOnDescription = true;

        const addProjectBtn: vscode.QuickInputButton = {
          iconPath: new vscode.ThemeIcon('add'),
          tooltip: '添加本地文件夹到 Git 记录中',
        };
        quickPick.buttons = [addProjectBtn];

        const deleteBtn: vscode.QuickInputButton = {
          iconPath: new vscode.ThemeIcon('trash'),
          tooltip: '删除此记录',
        };

        let activeItemToFocus: (vscode.QuickPickItem & { targetPath: string }) | undefined;

        const refreshItems = async () => {
          let projects: any[] = context.globalState.get(this.GIT_PROJECTS_STATE_KEY) || [];
          let stateNeedsUpdate = false;

          if (projects.length === 0) {
            const recentProjects: any[] = context.globalState.get(this.RECENT_PROJECTS_STATE_KEY) || [];
            if (recentProjects.length > 0) {
              projects = recentProjects;
              stateNeedsUpdate = true;
            }
          }

          const defaultWorkspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
          if (defaultWorkspace) {
            const existIndex = projects.findIndex((p) => {
              let targetFsPath = p.fsPath;
              if (targetFsPath.startsWith('file://')) {
                targetFsPath = vscode.Uri.parse(targetFsPath).fsPath;
              }
              return targetFsPath === defaultWorkspace;
            });

            if (existIndex === -1) {
              projects.unshift({
                name: path.basename(defaultWorkspace),
                fsPath: defaultWorkspace,
                branch: '',
              });
              stateNeedsUpdate = true;
            }
          }

          if (stateNeedsUpdate) {
            await context.globalState.update(this.GIT_PROJECTS_STATE_KEY, projects);
          }

          const items: (vscode.QuickPickItem & { targetPath: string })[] = [];
          activeItemToFocus = undefined;

          if (projects.length > 0) {
            items.push({
              label: '最近项目',
              kind: vscode.QuickPickItemKind.Separator,
              targetPath: '',
            });
          }

          projects.forEach((p) => {
            const isRemote = /^(vscode-vfs:\/\/|https?:\/\/|ssh:\/\/|git@)/i.test(p.fsPath);
            const icon = isRemote ? '$(repo)' : '$(folder)';

            let targetFsPath = p.fsPath;
            if (targetFsPath.startsWith('file://')) {
              targetFsPath = vscode.Uri.parse(targetFsPath).fsPath;
            }

            let currentFsPath = this._currentPreviewPath || '';
            if (currentFsPath.startsWith('file://')) {
              currentFsPath = vscode.Uri.parse(currentFsPath).fsPath;
            }

            const isCurrent = targetFsPath === currentFsPath;
            const projectName = p.customName || p.name;
            const branchDisplay = p.branch ? ` : ${p.branch}` : '';
            const currentTag = isCurrent ? ' 【当前预览】' : '';

            let decodedPath = targetFsPath;
            try {
              decodedPath = decodeURIComponent(targetFsPath);
            } catch (e) {
              console.log('e', e);
            }

            const projectItem = {
              label: `${icon} ${projectName}`,
              description: `${projectName}${branchDisplay}${currentTag}`,
              detail: decodedPath,
              targetPath: p.fsPath,
              buttons: isCurrent ? [] : [deleteBtn],
            };

            items.push(projectItem);

            if (isCurrent) {
              activeItemToFocus = projectItem;
            }
          });

          quickPick.items = items;

          if (activeItemToFocus) {
            quickPick.activeItems = [activeItemToFocus];
          }
        };

        await refreshItems();

        quickPick.onDidChangeValue((value) => {
          if (value === '' && activeItemToFocus) {
            quickPick.activeItems = [activeItemToFocus];
          }
        });

        quickPick.onDidTriggerButton(async (btn) => {
          if (btn === addProjectBtn) {
            quickPick.hide();

            const uriArray = await vscode.window.showOpenDialog({
              canSelectFiles: false,
              canSelectFolders: true,
              canSelectMany: false,
              openLabel: '添加到 Git 预览',
            });

            if (uriArray && uriArray[0]) {
              const newPath = uriArray[0].fsPath;
              let projects: any[] = context.globalState.get(this.GIT_PROJECTS_STATE_KEY) || [];

              const existIndex = projects.findIndex((p) => {
                let targetFsPath = p.fsPath;
                if (targetFsPath.startsWith('file://')) {
                  targetFsPath = vscode.Uri.parse(targetFsPath).fsPath;
                }
                return targetFsPath === newPath;
              });

              if (existIndex > -1) projects.splice(existIndex, 1);

              projects.unshift({
                name: path.basename(newPath),
                fsPath: newPath,
                branch: '',
              });
              await context.globalState.update(this.GIT_PROJECTS_STATE_KEY, projects);

              this.updateCurrentPreviewPath(newPath);
              vscode.window.showInformationMessage('✅ 已添加并切换到该项目的 Git 预览。');
            }
          }
        });

        quickPick.onDidTriggerItemButton(async (e) => {
          if (e.button === deleteBtn) {
            const item = e.item;
            const confirm = await vscode.window.showWarningMessage(`确定要从 Git 记录中删除项目 [ ${item.label.replace(/\$\(.*?\) /, '')} ] 吗？`, { modal: true }, '删除');

            if (confirm === '删除') {
              let projects: any[] = context.globalState.get(this.GIT_PROJECTS_STATE_KEY) || [];
              projects = projects.filter((p) => {
                let targetFsPath = p.fsPath;
                if (targetFsPath.startsWith('file://')) {
                  targetFsPath = vscode.Uri.parse(targetFsPath).fsPath;
                }
                return targetFsPath !== item.targetPath;
              });

              await context.globalState.update(this.GIT_PROJECTS_STATE_KEY, projects);
              vscode.window.showInformationMessage('🗑️ 已删除记录。');

              if (this._currentPreviewPath === item.targetPath) {
                const defaultWorkspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
                this.updateCurrentPreviewPath(defaultWorkspace);
              }

              await refreshItems();
            }
            return;
          }
        });

        quickPick.onDidAccept(async () => {
          const selected = quickPick.selectedItems[0];
          if (!selected) return;

          if (selected.kind === vscode.QuickPickItemKind.Separator) return;

          quickPick.hide();

          const targetPath = selected.targetPath;
          const isRemote = /^(vscode-vfs:\/\/|https?:\/\/|ssh:\/\/|git@)/i.test(targetPath);

          if (isRemote) {
            try {
              let finalUriStr = targetPath;
              if (targetPath.startsWith('git@')) {
                vscode.window.showWarningMessage('纯 SSH 格式不支持直接打开，请将其作为本地仓库克隆后操作。');
                return;
              }

              const uri = vscode.Uri.parse(finalUriStr);
              const choice = await vscode.window.showInformationMessage(
                `远程仓库 [ ${selected.label.replace(/\$\(.*?\) /, '')} ] 无法直接进行本地预览，是否将其作为工作区打开？`,
                { modal: true },
                '在当前窗口打开',
                '在新窗口打开',
              );

              if (choice === '在当前窗口打开') {
                await vscode.commands.executeCommand('vscode.openFolder', uri, false);
              } else if (choice === '在新窗口打开') {
                await vscode.commands.executeCommand('vscode.openFolder', uri, true);
              }
            } catch (e) {
              vscode.window.showErrorMessage('打开远程项目失败，路径可能无效。');
            }
          } else {
            let rawPath = targetPath;
            if (rawPath.startsWith('file://')) {
              rawPath = vscode.Uri.parse(rawPath).fsPath;
            }
            this.updateCurrentPreviewPath(rawPath);
          }
        });

        quickPick.onDidHide(() => quickPick.dispose());
        quickPick.show();
      }),
    );
  }

  public activate(context: vscode.ExtensionContext): void {
    this.gitProvider = new GitWebviewProvider(context.extensionUri);

    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider('quickOps.gitView', this.gitProvider, {
        webviewOptions: { retainContextWhenHidden: true },
      }),
    );

    // 初始化时加载默认工作区，并触发探测
    const defaultWorkspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    void this.updateCurrentPreviewPath(defaultWorkspace);

    void this.initializeConfigSync(context).catch((error) => {
      console.error(`[${this.id}] initializeConfigSync failed:`, error);
    });

    this.registerGitSwitchCommand(context);
    this.registerReturnToWorkspaceCommand(context);
    this.registerCloneGitProjectCommand(context);
    this.registerEditRemoteUrlCommand(context);

    ColorLog.black(`[${this.id}]`, 'Activated.');
  }
}
