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

  // 🌟 核心更新：深层探测 Git 仓库是否具有 Remote 属性
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

  // 🌟 核心更新：读取并修改底层的真实 Git 远程地址
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
        const targetRemote = remotes.find(r => r.name === 'origin') || remotes[0];
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
          }
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
      })
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
      })
    );
  }

  // 🌟 注册切换 Git 预览项目的命令 (高级 QuickPick 面板)
  private registerGitSwitchCommand(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
      vscode.commands.registerCommand('quickOps.switchGitProject', async () => {
        
        const quickPick = vscode.window.createQuickPick<vscode.QuickPickItem & { targetPath: string }>();
        quickPick.placeholder = '输入关键字搜索历史项目...';
        quickPick.title = '切换 / 预览 Git 项目'; 
        quickPick.matchOnDescription = true;

        // 🌟 核心破局点：使用 VS Code 原生标题栏按钮，彻底脱离列表排序机制！
        const addProjectBtn: vscode.QuickInputButton = {
          iconPath: new vscode.ThemeIcon('add'),
          tooltip: '添加本地文件夹到 Git 记录中'
        };
        // 将“添加项目”挂载到面板右上角
        quickPick.buttons = [addProjectBtn];

        const deleteBtn: vscode.QuickInputButton = {
          iconPath: new vscode.ThemeIcon('trash'),
          tooltip: '删除此记录'
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
            const existIndex = projects.findIndex(p => {
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
                branch: '' 
              });
              stateNeedsUpdate = true;
            }
          }

          if (stateNeedsUpdate) {
            await context.globalState.update(this.GIT_PROJECTS_STATE_KEY, projects);
          }

          const items: (vscode.QuickPickItem & { targetPath: string })[] = [];
          activeItemToFocus = undefined; 

          items.push({
            label: '操作',
            kind: vscode.QuickPickItemKind.Separator,
            targetPath: '' 
          });

          items.push({
            label: '$(add) 添加项目',
            description: '选择一个本地文件夹并添加到 Git 记录中',
            targetPath: 'ADD',
            alwaysShow: true, 
            buttons: [] 
          });

          if (projects.length > 0) {
            items.push({
              label: '最近项目',
              kind: vscode.QuickPickItemKind.Separator,
              targetPath: '' 
            });
          }

          projects.forEach(p => {
            const isRemote = /^(vscode-vfs:\/\/|https?:\/\/|ssh:\/\/|git@)/i.test(p.fsPath);
            const icon = isRemote ? '$(repo)' : '$(folder)';
            const branchInfo = p.branch ? ` [${p.branch}]` : '';
            
            let targetFsPath = p.fsPath;
            if (targetFsPath.startsWith('file://')) {
              targetFsPath = vscode.Uri.parse(targetFsPath).fsPath;
            }
            
            let currentFsPath = this._currentPreviewPath || '';
            if (currentFsPath.startsWith('file://')) {
              currentFsPath = vscode.Uri.parse(currentFsPath).fsPath;
            }

            const isCurrent = targetFsPath === currentFsPath;

            const projectItem = {
              label: `${icon} ${p.customName || p.name}`,
              description: `${p.fsPath}${branchInfo}${isCurrent ? ' (当前预览)' : ''}`,
              detail: isRemote ? '远程仓库 (需作为工作区打开)' : '本地项目 (点击无缝预览)',
              targetPath: p.fsPath,
              buttons: isCurrent ? [] : [deleteBtn] 
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

        // 🌟 监听右上角的全局按钮 (添加项目)
        quickPick.onDidTriggerButton(async (btn) => {
          if (btn === addProjectBtn) {
            quickPick.hide();
            
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
              
              this.updateCurrentPreviewPath(newPath);
              vscode.window.showInformationMessage('✅ 已添加并切换到该项目的 Git 预览。');
            }
          }
        });

        // 监听列表右侧的垃圾桶点击事件
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

              if (this._currentPreviewPath === item.targetPath) {
                const defaultWorkspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
                this.updateCurrentPreviewPath(defaultWorkspace);
              }
              
              await refreshItems();
            }
            return;
          }
        });

        // 监听主体项目选择事件
        quickPick.onDidAccept(async () => {
          const selected = quickPick.selectedItems[0];
          if (!selected) return;

          if (selected.kind === vscode.QuickPickItemKind.Separator) return;

          quickPick.hide();

          if (selected.targetPath === 'ADD') {
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
              
              this.updateCurrentPreviewPath(newPath);
              vscode.window.showInformationMessage('✅ 已添加并切换到该项目的 Git 预览。');
            }
            return;
          }

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
            this.updateCurrentPreviewPath(rawPath);
          }
        });

        quickPick.onDidHide(() => quickPick.dispose());
        quickPick.show();
      })
    );
  }

  public activate(context: vscode.ExtensionContext): void {
    this.gitProvider = new GitWebviewProvider(context.extensionUri);

    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider('quickOps.gitView', this.gitProvider, {
        webviewOptions: { retainContextWhenHidden: true }
      })
    );

    // 初始化时加载默认工作区，并触发探测
    const defaultWorkspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    void this.updateCurrentPreviewPath(defaultWorkspace);

    void this.initializeConfigSync(context).catch((error) => {
      console.error(`[${this.id}] initializeConfigSync failed:`, error);
    });

    this.registerGitSwitchCommand(context);
    this.registerReturnToWorkspaceCommand(context);
    this.registerEditRemoteUrlCommand(context);

    ColorLog.black(`[${this.id}]`, 'Activated.');
  }
}