import * as vscode from 'vscode';
import { IFeature } from '../core/interfaces/IFeature';
import { GitWebviewProvider } from '../providers/GitWebviewProvider';
import ColorLog from '../utils/ColorLog';
import simpleGit from 'simple-git'; 
import { exec } from 'child_process'; 

export class GitFeature implements IFeature {
  public readonly id = 'GitFeature';
  // 🌟 将锁提升为类属性，确保在异步初始化和监听器之间共享
  private _isUpdating = false;

  private checkGitInstalled(): Promise<boolean> {
    return new Promise((resolve) => {
      exec('git --version', (error) => {
        resolve(!error);
      });
    });
  }

  private async initializeConfigSync(context: vscode.ExtensionContext) {
    const isInstalled = await this.checkGitInstalled();
    if (!isInstalled) return;

    const git = simpleGit();
    let globalName = '';
    let globalEmail = '';
    
    try {
      globalName = (await git.raw(['config', '--global', 'user.name'])).trim();
      globalEmail = (await git.raw(['config', '--global', 'user.email'])).trim();
    } catch (e) {}

    const config = vscode.workspace.getConfiguration('quick-ops.git');

    // 1. 初始化回填
    if (globalName || globalEmail) {
      this._isUpdating = true; // 开启同步锁
      const promises = [];
      if (globalName && config.get('userName') !== globalName) {
        promises.push(config.update('userName', globalName, vscode.ConfigurationTarget.Global));
      }
      if (globalEmail && config.get('userEmail') !== globalEmail) {
        promises.push(config.update('userEmail', globalEmail, vscode.ConfigurationTarget.Global));
      }
      
      await Promise.all(promises);
      
      // 🌟 关键优化：延迟释放锁。
      // 因为 config.update 后，VS Code 的配置变更事件是异步广播的，
      // 立即释放锁会导致监听器捕获到刚才自己触发的变更。
      setTimeout(() => { this._isUpdating = false; }, 500);
    }

    // 2. 挂载监听器
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(async (e) => {
            // 🌟 锁中或变更的不是账号信息，则忽略
            if (this._isUpdating) return;
            if (!e.affectsConfiguration('quick-ops.git.userName') && !e.affectsConfiguration('quick-ops.git.userEmail')) return;

            const isGitReady = await this.checkGitInstalled();
            if (!isGitReady) return;

            const currentConfig = vscode.workspace.getConfiguration('quick-ops.git');
            const newName = currentConfig.get<string>('userName');
            const newEmail = currentConfig.get<string>('userEmail');

            let oldName = '';
            let oldEmail = '';
            try {
                const liveGit = simpleGit();
                oldName = (await liveGit.raw(['config', '--global', 'user.name'])).trim();
                oldEmail = (await liveGit.raw(['config', '--global', 'user.email'])).trim();
            } catch (err) {}

            // 如果 VS Code 设置的值和 Git 里的值已经一致了，说明是自动同步，直接返回
            if (newName === oldName && newEmail === oldEmail) return;

            const action = await vscode.window.showInformationMessage(
                `检测到 Git 账号信息更改，是否同步设置为 Git 的【全局 (Global)】配置？\n\n[用户名] ${oldName || '未设置'}  ➡️  ${newName || '未设置'}\n[邮箱] ${oldEmail || '未设置'}  ➡️  ${newEmail || '未设置'}`,
                { modal: true },
                '确认设置为全局'
            );

            if (action === '确认设置为全局') {
                try {
                    const liveGit = simpleGit();
                    if (newName !== undefined && newName !== oldName) await liveGit.raw(['config', '--global', 'user.name', newName]);
                    if (newEmail !== undefined && newEmail !== oldEmail) await liveGit.raw(['config', '--global', 'user.email', newEmail]);
                    vscode.window.showInformationMessage('✅ Git 全局用户信息已成功更新！');
                } catch (error: any) {
                    vscode.window.showErrorMessage(`设置全局 Git 配置失败: ${error.message}`);
                }
            } else {
                // 用户取消，回滚
                this._isUpdating = true;
                await currentConfig.update('userName', oldName, vscode.ConfigurationTarget.Global);
                await currentConfig.update('userEmail', oldEmail, vscode.ConfigurationTarget.Global);
                setTimeout(() => { this._isUpdating = false; }, 500);
            }
        })
    );
  }

  public activate(context: vscode.ExtensionContext): void {
    const gitProvider = new GitWebviewProvider(context.extensionUri);
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider('quickOps.gitView', gitProvider, {
        webviewOptions: { retainContextWhenHidden: true }
      })
    );
    this.initializeConfigSync(context);
    ColorLog.black(`[${this.id}]`, 'Activated.');
  }
}