import * as vscode from 'vscode';
import { IFeature } from '../core/interfaces/IFeature';
import ColorLog from '../utils/ColorLog';
// 🌟 1. 导入 React Webview 辅助函数
import { getReactWebviewHtml } from '../utils/WebviewHelper';

class CompareContentProvider implements vscode.TextDocumentContentProvider {
  private contentMap = new Map<string, string>();

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contentMap.get(uri.query) || '';
  }

  setContent(id: string, content: string) {
    this.contentMap.set(id, content);
    if (this.contentMap.size > 20) { 
      const firstKey = this.contentMap.keys().next().value;
      if (firstKey) {
        this.contentMap.delete(firstKey);
      }
    }
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
      // 面板已存在时，原地唤起（不传 Beside，防止窗口乱分屏）
      this.currentPanel.reveal();
      
      // 如果有新选中的文本，通过通信发给网页
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
          retainContextWhenHidden: true, // 切换时保活，实现秒开
          // 🌟 2. 允许加载本地静态资源
          localResourceRoots: [context.extensionUri]
        }
      );

      this.currentPanel.onDidDispose(() => {
        this.currentPanel = undefined;
      });

      this.currentPanel.webview.onDidReceiveMessage(async (message) => {
        if (message.type === 'ready') {
          if (initialText) {
            this.currentPanel?.webview.postMessage({ type: 'updateOriginal', text: initialText });
          }
        } else if (message.type === 'runDiff') {
          await this.triggerNativeDiff(message.original, message.modified);
        } else if (message.type === 'toggleFullScreen') {
          await vscode.commands.executeCommand('workbench.action.toggleMaximizeEditorGroup');
        }
      });

      this.currentPanel.webview.html = getReactWebviewHtml(context.extensionUri, this.currentPanel.webview, '/compare');

      if (initialText) {
        setTimeout(() => {
          this.currentPanel?.webview.postMessage({ type: 'updateOriginal', text: initialText });
        }, 500);
      }
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