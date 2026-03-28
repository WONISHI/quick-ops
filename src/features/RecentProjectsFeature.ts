import * as vscode from 'vscode';
import { IFeature } from '../core/interfaces/IFeature';
import ColorLog from '../utils/ColorLog';
import { RecentProjectsProvider, ReadOnlyContentProvider, ReadOnlyDecorationProvider } from '../providers/RecentProjectsProvider';

export class RecentProjectsFeature implements IFeature {
  public readonly id = 'RecentProjectsFeature';

  public activate(context: vscode.ExtensionContext): void {
    const provider = new RecentProjectsProvider(context);

    // 注册只读文件及装饰器
    const roProvider = new ReadOnlyContentProvider();
    const roDecorationProvider = new ReadOnlyDecorationProvider();
    const roDocRegistration = vscode.workspace.registerTextDocumentContentProvider('quickops-ro', roProvider);
    const roDecoRegistration = vscode.window.registerFileDecorationProvider(roDecorationProvider);

    // 注册 Webview 视图
    const webviewView = vscode.window.registerWebviewViewProvider('quickOps.recentProjectsView', provider, {
      webviewOptions: { retainContextWhenHidden: true },
    });

    // 注册基础命令
    const addCmd = vscode.commands.registerCommand('quickOps.addRecentProject', async () => { /* 你的逻辑 */ });
    const clearCmd = vscode.commands.registerCommand('quickOps.clearRecentProjects', () => provider.clearAll());
    const refreshCmd = vscode.commands.registerCommand('quickOps.refreshRecentProjects', () => { provider.refresh(); });
    const syncCmd = vscode.commands.registerCommand('quickOps.syncBranches', async () => await provider.syncAllBranches());

    // ================= 🌟 【新增核心】：注册跨视图文件对比命令 =================
    const selectForCompareCmd = vscode.commands.registerCommand('quickOps.selectForCompare', (uri: vscode.Uri) => {
      // 从 VS Code 原生右键菜单调用时，参数是该文件的 Uri
      if (uri) provider.selectForCompare(uri.toString());
    });

    const compareWithSelectedCmd = vscode.commands.registerCommand('quickOps.compareWithSelected', (uri: vscode.Uri) => {
      // 从 VS Code 原生右键菜单调用时，参数是该文件的 Uri
      if (uri) provider.compareWithSelected(uri.toString());
    });
    // =====================================================================

    // 窗口焦点变化自动刷新
    const windowFocusWatcher = vscode.window.onDidChangeWindowState((e) => {
      if (e.focused) provider.refresh();
    });

    // 🌟 将所有注册推入订阅池
    context.subscriptions.push(
      webviewView, roDocRegistration, roDecoRegistration, 
      addCmd, refreshCmd, syncCmd, windowFocusWatcher, clearCmd,
      selectForCompareCmd, compareWithSelectedCmd // 把新增的两个命令也推入
    );

    ColorLog.black(`[${this.id}]`, 'Activated.');
  }
}