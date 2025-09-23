import * as vscode from 'vscode';
export function registerExtension(context: vscode.ExtensionContext) {
  const disposable = vscode.commands.registerCommand('extension.revealCurrentFile', () => {
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
      vscode.window.showInformationMessage('当前没有打开的文件');
      return;
    }

    const fileUri = activeEditor.document.uri;
    vscode.commands.executeCommand('revealInExplorer', fileUri);
  });

  context.subscriptions.push(disposable);
}
