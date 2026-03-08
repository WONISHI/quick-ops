import * as vscode from 'vscode';
import { IFeature } from '../core/interfaces/IFeature';
import ColorLog from '../utils/ColorLog';
import { RecentProjectsProvider, RecentProjectItem } from '../providers/RecentProjectsProvider';

export class RecentProjectsFeature implements IFeature {
  public readonly id = 'RecentProjectsFeature';

  public activate(context: vscode.ExtensionContext): void {
    const provider = new RecentProjectsProvider(context);
    
    // 注册视图
    const treeView = vscode.window.registerTreeDataProvider('quickOps.recentProjectsView', provider);

    // 注册打开命令
    const openCmd = vscode.commands.registerCommand('quickOps.openRecentProject', (fsPath: string) => {
      provider.openProject(fsPath);
    });

    // 注册删除单条命令
    const removeCmd = vscode.commands.registerCommand('quickOps.removeRecentProject', (item: RecentProjectItem) => {
      provider.removeProject(item);
    });

    // 注册清空全部命令
    const clearCmd = vscode.commands.registerCommand('quickOps.clearRecentProjects', () => {
      provider.clearAll();
    });

    // 🌟 新增：添加项目命令 (弹出本地/远程选择)
    const addCmd = vscode.commands.registerCommand('quickOps.addRecentProject', async () => {
      const choice = await vscode.window.showQuickPick([
        { label: '$(folder) 添加本地项目', description: '从本地文件夹中选择', value: 'local' },
        { label: '$(globe) 添加远程项目', description: '输入 SSH / WSL 或远程仓库地址', value: 'remote' }
      ], { placeHolder: '请选择要添加的项目类型' });

      if (choice?.value === 'local') {
        await provider.addLocalProject();
      } else if (choice?.value === 'remote') {
        await provider.addRemoteProject();
      }
    });

    context.subscriptions.push(treeView, openCmd, removeCmd, clearCmd, addCmd);
    ColorLog.black(`[${this.id}]`, 'Activated.');
  }
}