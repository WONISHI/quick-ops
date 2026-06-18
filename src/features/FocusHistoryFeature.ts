import * as vscode from 'vscode';
import { IFeature } from '../core/interfaces/feature.interface';
import ColorLog from '../utils/ColorLog';

interface FocusPosition {
  uri: string;
  line: number;
  character: number;
  timestamp: number;
}

export class FocusHistoryFeature implements IFeature {
  public readonly id = 'FocusHistoryFeature';

  private readonly MAX_FILES = 5;
  private readonly MAX_POSITIONS = 5;

  /**
   * Map<fileUri, FocusPosition[]>
   */
  private focusHistory = new Map<string, FocusPosition[]>();

  /**
   * 文件顺序
   */
  private fileOrder: string[] = [];

  /**
   * 防止 jump 时再次触发 selection change
   */
  private isNavigating = false;

  /**
   * 上一次记录的位置
   */
  private lastPositionKey = '';

  public activate(context: vscode.ExtensionContext): void {
    const selectionDisposable = vscode.window.onDidChangeTextEditorSelection((event) => {
      this.handleSelectionChange(event);
    });

    const closeDisposable = vscode.workspace.onDidCloseTextDocument((document) => {
      this.removeFileHistory(document.uri.toString());
    });

    const commandDisposable = vscode.commands.registerCommand('quick-ops.focusBack', async () => {
      await this.navigateBack();
    });

    context.subscriptions.push(selectionDisposable);
    context.subscriptions.push(closeDisposable);
    context.subscriptions.push(commandDisposable);

    ColorLog.black(`[${this.id}]`, 'Activated.');
  }

  private handleSelectionChange(event: vscode.TextEditorSelectionChangeEvent) {
    if (this.isNavigating) return;

    const editor = event.textEditor;

    if (!editor || event.selections.length === 0) {
      return;
    }

    const selection = event.selections[0];
    const position = selection.active;

    const uri = editor.document.uri.toString();

    const key = `${uri}:${position.line}:${position.character}`;

    if (this.lastPositionKey === key) {
      return;
    }

    this.lastPositionKey = key;

    const history = this.focusHistory.get(uri) || [];

    const existsIndex = history.findIndex((item) => {
      return item.line === position.line && item.character === position.character;
    });

    if (existsIndex > -1) {
      history.splice(existsIndex, 1);
    }

    history.push({
      uri,
      line: position.line,
      character: position.character,
      timestamp: Date.now(),
    });

    while (history.length > this.MAX_POSITIONS) {
      history.shift();
    }

    this.focusHistory.set(uri, history);

    this.updateFileOrder(uri);
  }

  private updateFileOrder(uri: string) {
    const existsIndex = this.fileOrder.indexOf(uri);

    if (existsIndex > -1) {
      this.fileOrder.splice(existsIndex, 1);
    }

    this.fileOrder.push(uri);

    while (this.fileOrder.length > this.MAX_FILES) {
      const removedUri = this.fileOrder.shift();

      if (removedUri) {
        this.focusHistory.delete(removedUri);
      }
    }
  }

  private async navigateBack() {
    const editor = vscode.window.activeTextEditor;

    if (!editor) return;

    const uri = editor.document.uri.toString();

    const history = this.focusHistory.get(uri);

    if (!history || history.length <= 1) {
      vscode.window.showInformationMessage('没有更多焦点记录');
      return;
    }

    /**
     * 删除当前记录
     */
    history.pop();

    const target = history.pop();

    if (!target) {
      return;
    }

    this.focusHistory.set(uri, history);

    this.isNavigating = true;

    try {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(target.uri));

      const targetEditor = await vscode.window.showTextDocument(document, {
        preview: false,
        preserveFocus: false,
      });

      const position = new vscode.Position(target.line, target.character);

      targetEditor.selection = new vscode.Selection(position, position);

      targetEditor.revealRange(
        new vscode.Range(position, position),
        vscode.TextEditorRevealType.InCenter,
      );
    } finally {
      setTimeout(() => {
        this.isNavigating = false;
      }, 100);
    }
  }

  private removeFileHistory(uri: string) {
    this.focusHistory.delete(uri);

    const index = this.fileOrder.indexOf(uri);

    if (index > -1) {
      this.fileOrder.splice(index, 1);
    }
  }
}
