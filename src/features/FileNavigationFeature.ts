import * as vscode from 'vscode';
import { IFeature } from '../core/interfaces/IFeature';

export class FileNavigationFeature implements IFeature {
  public readonly id = 'FileNavigationFeature';

  public activate(context: vscode.ExtensionContext): void {
    const disposable = vscode.commands.registerCommand('extension.revealCurrentFile', () => {
      const activeEditor = vscode.window.activeTextEditor;
      if (!activeEditor) {
        vscode.window.showInformationMessage('当前没有打开的文件');
        return;
      }
      // 核心逻辑：调用 VS Code 内置命令
      vscode.commands.executeCommand('revealInExplorer', activeEditor.document.uri);
    });

    context.subscriptions.push(disposable);
    console.log(`[${this.id}] Activated.`);
  }
}
