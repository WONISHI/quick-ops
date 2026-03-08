import * as vscode from 'vscode';
import { IFeature } from '../core/interfaces/IFeature';
import ColorLog from '../utils/ColorLog';
import { RecentProjectsProvider } from '../providers/RecentProjectsProvider';

export class RecentProjectsFeature implements IFeature {
  public readonly id = 'RecentProjectsFeature';

  public activate(context: vscode.ExtensionContext): void {
    const provider = new RecentProjectsProvider(context);
    
    // 🌟 核心修改：这里变成了 registerWebviewViewProvider
    const webviewView = vscode.window.registerWebviewViewProvider('quickOps.recentProjectsView', provider);

    const addCmd = vscode.commands.registerCommand('quickOps.addRecentProject', async () => {
      const choice = await vscode.window.showQuickPick([
        { label: '$(folder) 添加本地项目', description: '从本地文件夹中选择', value: 'local' },
        { label: '$(github) 添加远程项目', description: '搜索 GitHub 仓库或输入远程地址', value: 'remote' }
      ], { placeHolder: '请选择要添加的项目类型' });

      if (choice?.value === 'local') {
        await provider.addLocalProject();
      } else if (choice?.value === 'remote') {
        await provider.addRemoteProject();
      }
    });

    const clearCmd = vscode.commands.registerCommand('quickOps.clearRecentProjects', () => {
      provider.clearAll();
    });

    // 因为不再有 TreeItem，移除单项相关的命令注册
    context.subscriptions.push(webviewView, addCmd, clearCmd);
    ColorLog.black(`[${this.id}]`, 'Activated.');
  }
}