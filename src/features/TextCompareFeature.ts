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
      // 🌟 优化 1：面板已存在时，原地唤起（不传 Beside，防止窗口乱分屏）
      this.currentPanel.reveal();
      
      // 🌟 优化 2：如果有新选中的文本，通过通信发给网页，而不是重载整个 HTML！
      if (initialText) {
        this.currentPanel.webview.postMessage({ type: 'updateOriginal', text: initialText });
      }
    } else {
      // 仅在首次打开时创建
      this.currentPanel = vscode.window.createWebviewPanel(
        'quickOpsTextCompare', 
        '文本差异对比', 
        vscode.ViewColumn.Beside, // 只有第一次放到侧边
        { 
          enableScripts: true,
          retainContextWhenHidden: true // 🌟 优化 3：切到别的代码文件时，对比页面不销毁（保活），实现秒开
        }
      );

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

      // 🌟 HTML 赋值只在首次创建时执行一次！
      this.currentPanel.webview.html = getTextCompareWebviewHtml(this.currentPanel.webview, initialText);
    }
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
