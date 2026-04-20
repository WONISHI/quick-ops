import * as vscode from 'vscode';
import { IFeature } from '../core/interfaces/IFeature';
import { GitWebviewProvider } from '../providers/GitWebviewProvider';
import ColorLog from '../utils/ColorLog';
import simpleGit from 'simple-git';
import { execFile } from 'child_process';

export class GitFeature implements IFeature {
  public readonly id = 'GitFeature';
  private _syncDepth = 0;

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

  public activate(context: vscode.ExtensionContext): void {
    const gitProvider = new GitWebviewProvider(context.extensionUri);

    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider('quickOps.gitView', gitProvider, {
        webviewOptions: { retainContextWhenHidden: true }
      })
    );

    void this.initializeConfigSync(context).catch((error) => {
      console.error(`[${this.id}] initializeConfigSync failed:`, error);
    });

    ColorLog.black(`[${this.id}]`, 'Activated.');
  }
}