import * as vscode from 'vscode';
import { getReactWebviewHtml } from '../../utils/WebviewHelper';
import { ExtensionContextProvider } from '../../common/providers/extension-context.provider';

class CompareContentProvider implements vscode.TextDocumentContentProvider {
  private readonly contentMap = new Map<string, string>();

  public provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contentMap.get(uri.query) || '';
  }

  public setContent(id: string, content: string): void {
    this.contentMap.set(id, content);

    /**
     * 防止每次 diff 都一直堆积。
     */
    if (this.contentMap.size > 20) {
      const firstKey = this.contentMap.keys().next().value;

      if (firstKey) {
        this.contentMap.delete(firstKey);
      }
    }
  }

  public clear(): void {
    this.contentMap.clear();
  }
}

export class TextCompareService {
  public static inject = [ExtensionContextProvider];

  private readonly contentProvider = new CompareContentProvider();
  private currentPanel: vscode.WebviewPanel | undefined;

  constructor(private readonly extensionContextProvider: ExtensionContextProvider) {}

  public getContentProvider(): vscode.TextDocumentContentProvider {
    return this.contentProvider;
  }

  public async openCompareWebview(): Promise<void> {
    const context = this.extensionContextProvider.getContext();
    const initialText = this.getSelectedText();

    /**
     * 面板已经存在时只唤起，不重复创建。
     */
    if (this.currentPanel) {
      this.currentPanel.reveal();

      if (initialText) {
        this.currentPanel.webview.postMessage({
          type: 'updateOriginal',
          text: initialText,
        });
      }

      return;
    }

    this.currentPanel = vscode.window.createWebviewPanel(
      'quickOpsTextCompare',
      '文本差异对比',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [context.extensionUri],
      },
    );

    this.currentPanel.iconPath = vscode.Uri.joinPath(
      context.extensionUri,
      'resources',
      'icons',
      'compare.svg',
    );

    this.currentPanel.onDidDispose(() => {
      this.currentPanel = undefined;
    });

    this.currentPanel.webview.onDidReceiveMessage(async message => {
      await this.handleWebviewMessage(message, initialText);
    });

    this.currentPanel.webview.html = getReactWebviewHtml(
      context.extensionUri,
      this.currentPanel.webview,
      '/compare',
    );

    if (initialText) {
      setTimeout(() => {
        this.currentPanel?.webview.postMessage({
          type: 'updateOriginal',
          text: initialText,
        });
      }, 500);
    }
  }

  public async triggerNativeDiff(
    original: string,
    modified: string,
  ): Promise<void> {
    const timestamp = Date.now();
    const originalId = `original_${timestamp}`;
    const modifiedId = `modified_${timestamp}`;

    this.contentProvider.setContent(originalId, original || '');
    this.contentProvider.setContent(modifiedId, modified || '');

    const originalUri = vscode.Uri.from({
      scheme: 'quickops-diff',
      path: '原文本',
      query: originalId,
    });

    const modifiedUri = vscode.Uri.from({
      scheme: 'quickops-diff',
      path: '修改后',
      query: modifiedId,
    });

    await vscode.commands.executeCommand(
      'vscode.diff',
      originalUri,
      modifiedUri,
      '差异对比 (左: 原文本 ↔ 右: 修改后)',
      {
        preview: true,
        viewColumn: vscode.ViewColumn.Active,
      },
    );
  }

  public dispose(): void {
    this.currentPanel?.dispose();
    this.currentPanel = undefined;
    this.contentProvider.clear();
  }

  private async handleWebviewMessage(
    message: any,
    initialText: string,
  ): Promise<void> {
    if (!message) return;

    if (message.type === 'ready') {
      if (initialText) {
        this.currentPanel?.webview.postMessage({
          type: 'updateOriginal',
          text: initialText,
        });
      }

      return;
    }

    if (message.type === 'runDiff') {
      await this.triggerNativeDiff(message.original || '', message.modified || '');
      return;
    }

    if (message.type === 'toggleFullScreen') {
      await vscode.commands.executeCommand(
        'workbench.action.toggleMaximizeEditorGroup',
      );
    }
  }

  private getSelectedText(): string {
    const editor = vscode.window.activeTextEditor;

    if (!editor || editor.selection.isEmpty) {
      return '';
    }

    return editor.document.getText(editor.selection);
  }
}