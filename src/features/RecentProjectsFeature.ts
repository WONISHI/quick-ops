import * as vscode from 'vscode';
import { IFeature } from '../core/interfaces/IFeature';
import ColorLog from '../utils/ColorLog';
// 🌟 确保把需要用到的三个类都导入进来
import { RecentProjectsProvider, ReadOnlyContentProvider, ReadOnlyDecorationProvider } from '../providers/RecentProjectsProvider';

export class RecentProjectsFeature implements IFeature {
  public readonly id = 'RecentProjectsFeature';

  public activate(context: vscode.ExtensionContext): void {
    const provider = new RecentProjectsProvider(context);

    // ================= 🌟 核心修复：注册只读文件及装饰器提供程序 =================
    const roProvider = new ReadOnlyContentProvider();
    const roDecorationProvider = new ReadOnlyDecorationProvider();

    const roDocRegistration = vscode.workspace.registerTextDocumentContentProvider('quickops-ro', roProvider);
    const roDecoRegistration = vscode.window.registerFileDecorationProvider(roDecorationProvider);

    // ================= 🌟 注册 Webview 视图 =================
    const webviewView = vscode.window.registerWebviewViewProvider('quickOps.recentProjectsView', provider, {
      webviewOptions: {
        retainContextWhenHidden: true, // 保持页面状态不重置
      },
    });

    // ================= 🌟 恢复原有命令：添加项目 =================
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

    // ================= 🌟 恢复原有命令：清空项目记录 =================
    const clearCmd = vscode.commands.registerCommand('quickOps.clearRecentProjects', () => {
      provider.clearAll();
    });

    // ================= 🌟 新增：手动刷新命令 =================
    const refreshCmd = vscode.commands.registerCommand('quickOps.refreshRecentProjects', () => {
      provider.refresh();
      vscode.window.setStatusBarMessage('QuickOps: 项目列表已刷新', 2000);
    });

    // ================= 🌟 新增：窗口焦点变化自动刷新 =================
    // 当用户从其他窗口（修改了 globalState）切回到当前窗口时，自动同步最新数据
    const windowFocusWatcher = vscode.window.onDidChangeWindowState((e) => {
      if (e.focused) {
        provider.refresh();
      }
    });

    // 将所有注册的服务和命令推入订阅池中，防止内存泄漏
    context.subscriptions.push(webviewView, roDocRegistration, roDecoRegistration, addCmd, refreshCmd, windowFocusWatcher, clearCmd);

    ColorLog.black(`[${this.id}]`, 'Activated.');
  }
}
