import * as vscode from 'vscode';
import * as path from 'path'; // path 模块仅用于字符串处理，可以保留
import { IFeature } from '../core/interfaces/IFeature';
import ColorLog from '../utils/ColorLog';
import { RecentProjectsProvider } from '../providers/RecentProjectsProvider';
import { ReadOnlyFileSystemProvider } from '../providers/ReadOnlyFileSystemProvider';

export class RecentProjectsFeature implements IFeature {
  public readonly id = 'RecentProjectsFeature';

  public activate(context: vscode.ExtensionContext): void {
    const provider = new RecentProjectsProvider(context);

    const roProvider = new ReadOnlyFileSystemProvider();
    const roDocRegistration = vscode.workspace.registerFileSystemProvider('quickops-ro', roProvider, { isReadonly: true });

    // 注册 Webview 视图
    const webviewView = vscode.window.registerWebviewViewProvider('quickOps.recentProjectsView', provider, {
      webviewOptions: { retainContextWhenHidden: true },
    });

    // 输入+选择双模式的添加逻辑
    const addCmd = vscode.commands.registerCommand('quickOps.addRecentProject', async () => {
      const quickPick = vscode.window.createQuickPick();
      quickPick.placeholder = '直接输入本地绝对路径或远程URL按回车，或在下方选择';
      quickPick.items = [
        { label: '$(folder) 浏览本地项目...', description: '打开系统文件夹选择器', alwaysShow: true },
        { label: '$(repo) 填写远程仓库...', description: '手动输入添加 GitHub / GitLab 链接', alwaysShow: true },
      ];

      quickPick.onDidChangeValue((value) => {
        if (value.trim()) {
          const isRemote = /^(https?:\/\/|git@|vscode-vfs:\/\/)/i.test(value.trim()) || /^([^/]+\/[^/]+)$/.test(value.trim());
          quickPick.items = [
            {
              label: isRemote ? '$(repo) 识别为【远程仓库】并添加' : '$(folder) 识别为【本地项目】并添加',
              description: value,
              alwaysShow: true,
            },
            { label: '$(folder) 浏览本地项目...', description: '打开系统文件夹选择器', alwaysShow: true },
            { label: '$(repo) 填写远程仓库...', description: '手动输入添加 GitHub / GitLab 链接', alwaysShow: true },
          ];
        } else {
          // 清空输入时恢复默认选项
          quickPick.items = [
            { label: '$(folder) 浏览本地项目...', description: '打开系统文件夹选择器', alwaysShow: true },
            { label: '$(repo) 填写远程仓库...', description: '手动输入添加 GitHub / GitLab 链接', alwaysShow: true },
          ];
        }
      });

      quickPick.onDidAccept(async () => {
        const inputValue = quickPick.value.trim();
        const selected = quickPick.selectedItems[0];
        quickPick.hide();
        quickPick.dispose();
        if (inputValue && selected.description === inputValue) {
          const isRemote = /^(https?:\/\/|git@|vscode-vfs:\/\/)/i.test(inputValue) || /^([^/]+\/[^/]+)$/.test(inputValue);

          if (isRemote) {
            const parsed = (provider as any).parseRemoteUrlInput(inputValue);
            if (parsed) {
              const projectName = await vscode.window.showInputBox({
                prompt: '确认远程项目名称',
                value: parsed.repoFullName.split('/').pop() || parsed.repoFullName,
              });
              if (projectName) {
                await (provider as any).insertProjectToHistory(projectName, parsed.targetUriStr, parsed.platform, parsed.customDomain);
                vscode.window.showInformationMessage(`✅ 已添加远程项目: ${projectName}`);
              }
            } else {
              vscode.window.showErrorMessage('❌ 无效的远程地址格式，请检查。');
            }
          } else {
            try {
              const localUri = vscode.Uri.file(inputValue);
              const stat = await vscode.workspace.fs.stat(localUri);
              
              if ((stat.type & vscode.FileType.Directory) !== 0) {
                const folderName = path.basename(inputValue) || '本地项目';
                const uriStr = localUri.toString();
                await (provider as any).insertProjectToHistory(folderName, uriStr);
                vscode.window.showInformationMessage(`✅ 已添加本地项目: ${folderName}`);
              } else {
                vscode.window.showErrorMessage('❌ 输入的路径是一个文件，请提供文件夹路径。');
              }
            } catch (error) {
              vscode.window.showErrorMessage('❌ 找不到该本地路径，请检查拼写是否正确。');
            }
          }
        } else {
          // 用户没有输入内容，点击了默认的固定选项
          if (selected.label.includes('浏览本地项目')) {
            await provider.addLocalProject();
          } else if (selected.label.includes('填写远程仓库')) {
            await provider.addRemoteProject();
          }
        }
      });

      quickPick.show();
    });

    const refreshCmd = vscode.commands.registerCommand('quickOps.refreshRecentProjects', async () => {
      provider.refresh();
      await provider.syncAllBranches();
    });

    const clearCmd = vscode.commands.registerCommand('quickOps.clearRecentProjects', () => provider.clearAll());
    const syncCmd = vscode.commands.registerCommand('quickOps.syncBranches', async () => await provider.syncAllBranches());

    // 注册跨视图文件对比命令
    const selectForCompareCmd = vscode.commands.registerCommand('quickOps.selectForCompare', (uri: vscode.Uri) => {
      if (uri) provider.selectForCompare(uri.toString());
    });

    const compareWithSelectedCmd = vscode.commands.registerCommand('quickOps.compareWithSelected', (uri: vscode.Uri) => {
      if (uri) provider.compareWithSelected(uri.toString());
    });

    // 窗口焦点变化自动刷新
    const windowFocusWatcher = vscode.window.onDidChangeWindowState((e) => {
      if (e.focused) provider.refresh();
    });

    // 将所有注册推入订阅池 (移除了 roDecoRegistration)
    context.subscriptions.push(webviewView, roDocRegistration, addCmd, refreshCmd, syncCmd, windowFocusWatcher, clearCmd, selectForCompareCmd, compareWithSelectedCmd);

    ColorLog.black(`[${this.id}]`, 'Activated.');
  }
}