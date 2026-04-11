import * as vscode from 'vscode';
import { IFeature } from '../core/interfaces/IFeature';
import ColorLog from '../utils/ColorLog';

export class FileNavigationFeature implements IFeature {
  public readonly id = 'FileNavigationFeature';

  public activate(context: vscode.ExtensionContext): void {
    // 定位文件
    const disposable = vscode.commands.registerCommand('quick-ops.revealInExplorer', async () => {
      const activeEditor = vscode.window.activeTextEditor;
      if (!activeEditor) {
        vscode.window.showInformationMessage('当前没有打开的文件');
        return;
      }

      const uri = activeEditor.document.uri;

      if (uri.scheme !== 'file' && uri.scheme !== 'vscode-remote') {
        vscode.window.setStatusBarMessage('Quick Ops: 该文件无法在资源管理器中定位', 3000);
        return;
      }

      try {
        await vscode.commands.executeCommand('revealInExplorer', uri);
      } catch (error) {
        console.warn('[QuickOps] Reveal failed:', error);
        vscode.window.showWarningMessage('无法在当前工作区找到该文件');
      }
    });


    const openInNewTab = vscode.commands.registerCommand('quick-ops.openInNewTab', async (uri: vscode.Uri) => {
      if (!uri) return;
      await vscode.window.showTextDocument(uri, {
        preview: false, // 设为 false 即可实现在“新标签页”打开（不覆盖现有的预览标签）
        viewColumn: vscode.ViewColumn.Active
      });
    });

    const splitRight = vscode.commands.registerCommand('quick-ops.openAndSplitRight', async (uri: vscode.Uri) => {
      if (!uri) return;
      // ViewColumn.Beside 会在当前组的右侧打开，如果右侧没组则创建
      await vscode.window.showTextDocument(uri, {
        viewColumn: vscode.ViewColumn.Beside,
        preview: false // 确保不是预览模式
      });
    });


    context.subscriptions.push(disposable, splitRight, openInNewTab);
    ColorLog.black(`[${this.id}]`, 'Activated.');
  }
}
