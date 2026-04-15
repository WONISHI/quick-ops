import * as vscode from 'vscode';
import { IFeature } from '../core/interfaces/IFeature';
import { GitWebviewProvider } from '../providers/GitWebviewProvider';
import ColorLog from '../utils/ColorLog';
import simpleGit from 'simple-git'; 
import { exec } from 'child_process'; 

export class GitFeature implements IFeature {
  public readonly id = 'GitFeature';

  // 🌟 检测系统是否安装了 Git
  private checkGitInstalled(): Promise<boolean> {
    return new Promise((resolve) => {
      exec('git --version', (error) => {
        resolve(!error);
      });
    });
  }

  // 🌟 核心逻辑：启动时从底层 Git 读取真实配置，并反向同步给 VS Code 的输入框
  private async syncGitConfigToSettings() {
    try {
      const isInstalled = await this.checkGitInstalled();
      if (!isInstalled) return;

      const git = simpleGit();
      const currentName = (await git.raw(['config', '--global', 'user.name'])).trim();
      const currentEmail = (await git.raw(['config', '--global', 'user.email'])).trim();

      const config = vscode.workspace.getConfiguration('quick-ops.git');
      
      // 如果真实的 Git 配置有值，且和当前 VS Code 输入框里的不一样，就更新输入框
      if (currentName && config.get('userName') !== currentName) {
          await config.update('userName', currentName, vscode.ConfigurationTarget.Global);
      }
      if (currentEmail && config.get('userEmail') !== currentEmail) {
          await config.update('userEmail', currentEmail, vscode.ConfigurationTarget.Global);
      }
    } catch (e) {
      // 忽略报错，通常是因为电脑上还没设置过全局 config
    }
  }

  public activate(context: vscode.ExtensionContext): void {
    const gitProvider = new GitWebviewProvider(context.extensionUri);

    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(
        'quickOps.gitView', 
        gitProvider,
        {
          webviewOptions: { retainContextWhenHidden: true }
        }
      )
    );

    // 🌟 插件激活时，立刻读取底层 Git 配置并填充到设置面板！
    this.syncGitConfigToSettings();

    let isUpdating = false; // 防抖锁：防止自动还原值时再次触发 onChange

    // 🌟 监听设置修改
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(async (e) => {
            if (isUpdating) return;

            if (e.affectsConfiguration('quick-ops.git.userName') || e.affectsConfiguration('quick-ops.git.userEmail')) {
                
                const isInstalled = await this.checkGitInstalled();
                if (!isInstalled) {
                    vscode.window.showWarningMessage('未检测到 Git 环境，无法设置全局用户名和邮箱。');
                    return;
                }

                // 1. 获取用户在 VS Code 输入框里填写的“新值”
                const config = vscode.workspace.getConfiguration('quick-ops.git');
                const newName = config.get<string>('userName');
                const newEmail = config.get<string>('userEmail');

                // 2. 获取底层 Git 里面真正的“旧值”
                const git = simpleGit();
                let oldName = '';
                let oldEmail = '';
                try {
                    oldName = (await git.raw(['config', '--global', 'user.name'])).trim();
                    oldEmail = (await git.raw(['config', '--global', 'user.email'])).trim();
                } catch (e) {}

                // 3. 如果没有任何实质性改变，直接返回
                if (newName === oldName && newEmail === oldEmail) return;

                // 4. 弹出确认框，展示新旧对比
                const action = await vscode.window.showInformationMessage(
                    `检测到 Git 账号信息更改，是否同步设置为 Git 的【全局 (Global)】配置？\n\n[用户名] ${oldName || '未设置'}  ➡️  ${newName || '未设置'}\n[邮箱] ${oldEmail || '未设置'}  ➡️  ${newEmail || '未设置'}`,
                    { modal: true },
                    '确认设置为全局'
                );

                if (action === '确认设置为全局') {
                    // 执行底层 Git 修改
                    try {
                        if (newName !== undefined && newName !== oldName) {
                            await git.raw(['config', '--global', 'user.name', newName]);
                        }
                        if (newEmail !== undefined && newEmail !== oldEmail) {
                            await git.raw(['config', '--global', 'user.email', newEmail]);
                        }
                        vscode.window.showInformationMessage('✅ Git 全局用户信息已成功更新！');
                    } catch (error: any) {
                        vscode.window.showErrorMessage(`设置全局 Git 配置失败: ${error.message}`);
                    }
                } else {
                    // 🌟 重点：如果用户点击了取消/关掉了弹窗，我们需要把输入框里的值“拨回”底层的真实状态
                    isUpdating = true;
                    await config.update('userName', oldName, vscode.ConfigurationTarget.Global);
                    await config.update('userEmail', oldEmail, vscode.ConfigurationTarget.Global);
                    isUpdating = false;
                }
            }
        })
    );

    ColorLog.black(`[${this.id}]`, 'Activated.');
  }
}