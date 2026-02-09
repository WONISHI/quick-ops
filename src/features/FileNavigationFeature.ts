import * as vscode from 'vscode';
import { IFeature } from '../core/interfaces/IFeature';

export class FileNavigationFeature implements IFeature {
  public readonly id = 'FileNavigationFeature';

  public activate(context: vscode.ExtensionContext): void {
    // 定位文件
    const disposable = vscode.commands.registerCommand('quickOps.revealInExplorer', async () => {
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

    context.subscriptions.push(disposable);
    console.log(`[${this.id}] Activated.`);
  }
}
