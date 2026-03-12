import * as vscode from 'vscode';
import { IFeature } from '../core/interfaces/IFeature';
import ColorLog from '../utils/ColorLog';

export class EditorHistoryFeature implements IFeature {
  public readonly id = 'EditorHistoryFeature';
  private historyStack: string[] = [];
  public activate(context: vscode.ExtensionContext): void {
    if (vscode.window.activeTextEditor) {
      this.pushToHistory(vscode.window.activeTextEditor);
    }
    context.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) {
          this.pushToHistory(editor);
        }
      }),
    );
    context.subscriptions.push(
      vscode.commands.registerCommand('quick-ops.switchPreviousEditor', () => {
        this.switchToPrevious();
      }),
    );

    ColorLog.black(`[${this.id}]`, 'Activated.');
  }
  private pushToHistory(editor: vscode.TextEditor) {
    if (editor.viewColumn === undefined) return;
    const uri = editor.document.uri.toString();
    if (this.historyStack[0] === uri) return;
    this.historyStack = this.historyStack.filter((u) => u !== uri);
    this.historyStack.unshift(uri);
    if (this.historyStack.length > 20) {
      this.historyStack.pop();
    }
  }
  private async switchToPrevious() {
    if (this.historyStack.length < 2) return;
    const targetUriStr = this.historyStack[1];
    try {
      const uri = vscode.Uri.parse(targetUriStr);
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, { preview: false });
    } catch (e) {
      this.historyStack = this.historyStack.filter((u) => u !== targetUriStr);
    }
  }
}
