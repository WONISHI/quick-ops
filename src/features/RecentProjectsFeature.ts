import * as vscode from 'vscode';
import { IFeature } from '../core/interfaces/IFeature';
import ColorLog from '../utils/ColorLog';
import { RecentProjectsProvider, ReadOnlyContentProvider } from '../providers/RecentProjectsProvider';

export class RecentProjectsFeature implements IFeature {
  public readonly id = 'RecentProjectsFeature';

  public activate(context: vscode.ExtensionContext): void {
    const provider = new RecentProjectsProvider(context);

    // 🌟 注册只读虚拟文档协议 quickops-ro
    const roProvider = new ReadOnlyContentProvider();
    context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('quickops-ro', roProvider));

    const webviewView = vscode.window.registerWebviewViewProvider('quickOps.recentProjectsView', provider);

    const addCmd = vscode.commands.registerCommand('quickOps.addRecentProject', async () => {
      const choice = await vscode.window.showQuickPick(
        [
          { label: '$(folder) 添加本地项目', description: '从本地文件夹中选择', value: 'local' },
          { label: '$(github) 添加远程项目', description: '搜索 GitHub/GitLab 仓库或输入远程地址', value: 'remote' },
        ],
        { placeHolder: '请选择要添加的项目类型' },
      );

      if (choice?.value === 'local') {
        await provider.addLocalProject();
      } else if (choice?.value === 'remote') {
        await provider.addRemoteProject();
      }
    });

    const clearCmd = vscode.commands.registerCommand('quickOps.clearRecentProjects', () => {
      provider.clearAll();
    });

    context.subscriptions.push(webviewView, addCmd, clearCmd);
    ColorLog.black(`[${this.id}]`, 'Activated.');
  }
}
