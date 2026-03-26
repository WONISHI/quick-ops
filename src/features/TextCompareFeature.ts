import * as vscode from 'vscode';
import { IFeature } from '../core/interfaces/IFeature';
import ColorLog from '../utils/ColorLog';
import { getTextCompareWebviewHtml } from '../views/TextCompareWebviewHtml'; // 🌟 导入视图模块

class CompareContentProvider implements vscode.TextDocumentContentProvider {
  private contentMap = new Map<string, string>();

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contentMap.get(uri.query) || '';
  }

  setContent(id: string, content: string) {
    this.contentMap.set(id, content);
  }
}

export class TextCompareFeature implements IFeature {
  public readonly id = 'TextCompareFeature';
  private contentProvider = new CompareContentProvider();
  private currentPanel: vscode.WebviewPanel | undefined;

  public activate(context: vscode.ExtensionContext): void {
    context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('quickops-diff', this.contentProvider));

    const compareCmd = vscode.commands.registerCommand('quick-ops.openTextCompare', () => {
      this.openCompareWebview(context);
    });

    context.subscriptions.push(compareCmd);
    ColorLog.black(`[${this.id}]`, 'Activated.');
  }

  private openCompareWebview(context: vscode.ExtensionContext) {
    let initialText = '';
    const editor = vscode.window.activeTextEditor;
    if (editor && !editor.selection.isEmpty) {
      initialText = editor.document.getText(editor.selection);
    }

    if (this.currentPanel) {
      this.currentPanel.reveal(vscode.ViewColumn.Beside);
      // 如果用户再次唤起该面板且选中文本有变，可以通过 postMessage 给 Webview 发送新文本
      // 这里为了简单，仅聚焦面板
    } else {
      this.currentPanel = vscode.window.createWebviewPanel('quickOpsTextCompare', '文本差异对比', vscode.ViewColumn.Beside, { enableScripts: true });

      this.currentPanel.onDidDispose(() => {
        this.currentPanel = undefined;
      });

      this.currentPanel.webview.onDidReceiveMessage(async (message) => {
        if (message.type === 'runDiff') {
          await this.triggerNativeDiff(message.original, message.modified);
        } else if (message.type === 'toggleFullScreen') {
          await vscode.commands.executeCommand('workbench.action.toggleMaximizeEditorGroup');
        }
      });
    }

    // 🌟 将 Webview 的生成逻辑抽离至外部文件
    this.currentPanel.webview.html = getTextCompareWebviewHtml(this.currentPanel.webview, initialText);
  }

  private async triggerNativeDiff(original: string, modified: string) {
    const timestamp = Date.now();
    const originalId = `original_${timestamp}`;
    const modifiedId = `modified_${timestamp}`;

    this.contentProvider.setContent(originalId, original);
    this.contentProvider.setContent(modifiedId, modified);

    const originalUri = vscode.Uri.parse(`quickops-diff:原文本?${originalId}`);
    const modifiedUri = vscode.Uri.parse(`quickops-diff:修改后?${modifiedId}`);

    await vscode.commands.executeCommand('vscode.diff', originalUri, modifiedUri, '🔍 差异对比 (左: 原文本 ↔ 右: 修改后)', { preview: true, viewColumn: vscode.ViewColumn.Active });
  }
}
