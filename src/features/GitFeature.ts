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

  private gitProvider!: GitWebviewProvider;
  
  // 记录当前正在预览的本地路径，方便判断哪个选项不需要删除按钮
  private _currentPreviewPath: string | undefined;

  private createGit() {
    return simpleGit();
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
      '确认设置为全局'
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
    if (
      !e.affectsConfiguration('quick-ops.git.userName') &&
      !e.affectsConfiguration('quick-ops.git.userEmail')
    ) {
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
      })
    );
  }

  // 🌟 注册切换 Git 预览项目的命令 (高级 QuickPick 面板)
  private registerGitSwitchCommand(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
      vscode.commands.registerCommand('quickOps.switchGitProject', async () => {
        
        const quickPick = vscode.window.createQuickPick<vscode.QuickPickItem & { targetPath: string, isAddBtn?: boolean }>();
        quickPick.placeholder = '请选择要预览 Git 记录的项目 / 添加新项目';
        quickPick.matchOnDescription = true;

        const deleteBtn: vscode.QuickInputButton = {
          iconPath: new vscode.ThemeIcon('trash'),
          tooltip: '删除此记录'
        };

        const refreshItems = async () => {
          let projects: any[] = context.globalState.get(this.GIT_PROJECTS_STATE_KEY) || [];
          let stateNeedsUpdate = false;

          // 1. 如果 Git 记录为空，从总项目记录里捞一份兜底
          if (projects.length === 0) {
            const recentProjects: any[] = context.globalState.get(this.RECENT_PROJECTS_STATE_KEY) || [];
            if (recentProjects.length > 0) {
              projects = recentProjects;
              stateNeedsUpdate = true;
            }
          }

          // 2. 🌟 核心新增：确保当前真实的 VS Code 工作区一定在列表中
          const defaultWorkspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
          if (defaultWorkspace) {
            const existIndex = projects.findIndex(p => {
              let targetFsPath = p.fsPath;
              if (targetFsPath.startsWith('file://')) {
                targetFsPath = vscode.Uri.parse(targetFsPath).fsPath;
              }
              return targetFsPath === defaultWorkspace;
            });

            // 如果当前工作区不在记录里，把它插到最前面
            if (existIndex === -1) {
              projects.unshift({
                name: path.basename(defaultWorkspace),
                fsPath: defaultWorkspace,
                branch: '' 
              });
              stateNeedsUpdate = true;
            }
          }

          // 如果发生过补偿添加，统一写入存储
          if (stateNeedsUpdate) {
            await context.globalState.update(this.GIT_PROJECTS_STATE_KEY, projects);
          }

          const items: (vscode.QuickPickItem & { targetPath: string, isAddBtn?: boolean })[] = [];

          // 置顶：“添加项目”按钮
          items.push({
            label: '$(add) 添加项目',
            description: '选择一个本地文件夹并添加到 Git 记录中',
            targetPath: 'ADD',
            isAddBtn: true,
            buttons: [] 
          });

          // 载入历史项目
          projects.forEach(p => {
            const isRemote = p.fsPath.startsWith('vscode-vfs') || p.fsPath.startsWith('http');
            const icon = isRemote ? '$(repo)' : '$(folder)';
            const branchInfo = p.branch ? ` [${p.branch}]` : '';
            
            // 🌟 核心修复：抹平路径差异，将 file:// 前缀的 URI 转为原生文件路径进行比对
            let targetFsPath = p.fsPath;
            if (targetFsPath.startsWith('file://')) {
              targetFsPath = vscode.Uri.parse(targetFsPath).fsPath;
            }
            
            let currentFsPath = this._currentPreviewPath || '';
            if (currentFsPath.startsWith('file://')) {
              currentFsPath = vscode.Uri.parse(currentFsPath).fsPath;
            }

            const isCurrent = targetFsPath === currentFsPath;

            items.push({
              label: `${icon} ${p.customName || p.name}`,
              description: `${p.fsPath}${branchInfo}${isCurrent ? ' (当前预览)' : ''}`,
              detail: isRemote ? '远程仓库 (需作为工作区打开)' : '本地项目 (点击无缝预览)',
              targetPath: p.fsPath,
              // 匹配上当前预览项目的记录，隐藏垃圾桶按钮
              buttons: isCurrent ? [] : [deleteBtn] 
            });
          });

          quickPick.items = items;
        };

        await refreshItems();

        // 监听右侧垃圾桶点击事件
        quickPick.onDidTriggerItemButton(async (e) => {
          if (e.button === deleteBtn) {
            const item = e.item;
            const confirm = await vscode.window.showWarningMessage(
              `确定要从 Git 记录中删除项目 [ ${item.label.replace(/\$\(.*?\) /, '')} ] 吗？`,
              { modal: true },
              '删除'
            );

            if (confirm === '删除') {
              let projects: any[] = context.globalState.get(this.GIT_PROJECTS_STATE_KEY) || [];
              projects = projects.filter(p => {
                let targetFsPath = p.fsPath;
                if (targetFsPath.startsWith('file://')) {
                  targetFsPath = vscode.Uri.parse(targetFsPath).fsPath;
                }
                return targetFsPath !== item.targetPath;
              });
              
              await context.globalState.update(this.GIT_PROJECTS_STATE_KEY, projects);
              vscode.window.showInformationMessage('🗑️ 已删除记录。');

              // 兜底逻辑：如果删的恰好是当前正在预览的项目
              if (this._currentPreviewPath === item.targetPath) {
                const defaultWorkspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
                this._currentPreviewPath = defaultWorkspace;
                this.gitProvider.setCustomWorkspace(defaultWorkspace || null);
              }
              
              // 实时刷新面板项
              await refreshItems();
            }
          }
        });

        // 监听主体项目选择事件
        quickPick.onDidAccept(async () => {
          const selected = quickPick.selectedItems[0];
          if (!selected) return;

          quickPick.hide();

          if (selected.isAddBtn) {
            const uriArray = await vscode.window.showOpenDialog({
              canSelectFiles: false,
              canSelectFolders: true,
              canSelectMany: false,
              openLabel: '添加到 Git 预览'
            });

            if (uriArray && uriArray[0]) {
              const newPath = uriArray[0].fsPath;
              let projects: any[] = context.globalState.get(this.GIT_PROJECTS_STATE_KEY) || [];
              
              const existIndex = projects.findIndex(p => {
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
                branch: '' 
              });
              await context.globalState.update(this.GIT_PROJECTS_STATE_KEY, projects);
              
              this._currentPreviewPath = newPath;
              this.gitProvider.setCustomWorkspace(newPath);
              vscode.window.showInformationMessage('✅ 已添加并切换到该项目的 Git 预览。');
            }
            return;
          }

          const targetPath = selected.targetPath;
          const isRemote = targetPath.startsWith('vscode-vfs') || targetPath.startsWith('http');

          if (isRemote) {
            try {
              const uri = vscode.Uri.parse(targetPath);
              const choice = await vscode.window.showInformationMessage(
                `远程仓库 [ ${selected.label.replace(/\$\(.*?\) /, '')} ] 无法直接进行本地预览，是否将其作为工作区打开？`,
                { modal: true },
                '在当前窗口打开',
                '在新窗口打开'
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
            this._currentPreviewPath = rawPath;
            this.gitProvider.setCustomWorkspace(rawPath);
          }
        });

        quickPick.onDidHide(() => quickPick.dispose());
        quickPick.show();
      })
    );
  }

  public activate(context: vscode.ExtensionContext): void {
    // 默认赋值为当前 VS Code 工作区路径
    this._currentPreviewPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    this.gitProvider = new GitWebviewProvider(context.extensionUri);

    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider('quickOps.gitView', this.gitProvider, {
        webviewOptions: { retainContextWhenHidden: true }
      })
    );

    void this.initializeConfigSync(context).catch((error) => {
      console.error(`[${this.id}] initializeConfigSync failed:`, error);
    });

    this.registerGitSwitchCommand(context);

    ColorLog.black(`[${this.id}]`, 'Activated.');
  }
}