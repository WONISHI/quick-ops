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

  // 🌟 核心逻辑：将检查、回填、挂载监听串联为严格的先后顺序
  private async initializeConfigSync(context: vscode.ExtensionContext) {
    const isInstalled = await this.checkGitInstalled();
    if (!isInstalled) return;

    const git = simpleGit();
    let globalName = '';
    let globalEmail = '';
    
    // 1. 获取底层 Git 里的真实配置
    try {
      globalName = (await git.raw(['config', '--global', 'user.name'])).trim();
      globalEmail = (await git.raw(['config', '--global', 'user.email'])).trim();
    } catch (e) {
      // 忽略没配置的情况
    }

    const config = vscode.workspace.getConfiguration('quick-ops.git');
    let isUpdating = false; // 防抖锁

    // 2. 判断：如果 Git 有值，则回填到 VS Code 配置中
    if (globalName || globalEmail) {
      isUpdating = true; // 开启锁，以防万一
      const promises = [];
      if (globalName && config.get('userName') !== globalName) {
        promises.push(config.update('userName', globalName, vscode.ConfigurationTarget.Global));
      }
      if (globalEmail && config.get('userEmail') !== globalEmail) {
        promises.push(config.update('userEmail', globalEmail, vscode.ConfigurationTarget.Global));
      }
      
      // 🌟 关键：必须等待回填操作彻底完成！
      await Promise.all(promises);
      isUpdating = false; // 回填完毕，释放锁
    }

    // 3. 然后再开启监听 (此时初始化回填已结束，后续所有的变动都是用户的手动修改)
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(async (e) => {
            if (isUpdating) return;

            if (e.affectsConfiguration('quick-ops.git.userName') || e.affectsConfiguration('quick-ops.git.userEmail')) {
                
                const isGitReady = await this.checkGitInstalled();
                if (!isGitReady) {
                    vscode.window.showWarningMessage('未检测到 Git 环境，无法设置全局用户名和邮箱。');
                    return;
                }

                // 获取 VS Code 输入框里的“新值”
                const currentConfig = vscode.workspace.getConfiguration('quick-ops.git');
                const newName = currentConfig.get<string>('userName');
                const newEmail = currentConfig.get<string>('userEmail');

                // 再次获取底层 Git 里的“旧值”（防止在此期间被第三方工具改掉）
                let oldName = '';
                let oldEmail = '';
                try {
                    oldName = (await git.raw(['config', '--global', 'user.name'])).trim();
                    oldEmail = (await git.raw(['config', '--global', 'user.email'])).trim();
                } catch (err) {}

                // 如果实质内容没有改变，直接跳过
                if (newName === oldName && newEmail === oldEmail) return;

                const action = await vscode.window.showInformationMessage(
                    `检测到 Git 账号信息更改，是否同步设置为 Git 的【全局 (Global)】配置？\n\n[用户名] ${oldName || '未设置'}  ➡️  ${newName || '未设置'}\n[邮箱] ${oldEmail || '未设置'}  ➡️  ${newEmail || '未设置'}`,
                    { modal: true },
                    '确认设置为全局'
                );

                if (action === '确认设置为全局') {
                    // 用户确认，执行底层 Git 修改
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
                    // 用户取消，回退 VS Code 里的值到底层真实的值
                    isUpdating = true; // 上锁，防止还原操作再次触发弹窗死循环
                    await currentConfig.update('userName', oldName, vscode.ConfigurationTarget.Global);
                    await currentConfig.update('userEmail', oldEmail, vscode.ConfigurationTarget.Global);
                    isUpdating = false;
                }
            }
        })
    );
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

    // 🌟 直接调用异步的初始化流程
    this.initializeConfigSync(context);

    ColorLog.black(`[${this.id}]`, 'Activated.');
  }
}