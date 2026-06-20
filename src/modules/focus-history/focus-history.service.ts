import * as vscode from 'vscode';

interface FocusPosition {
  uri: string;
  line: number;
  character: number;
  timestamp: number;
}

export class FocusHistoryService {
  private readonly MAX_FILES = 5;
  private readonly MAX_POSITIONS = 5;

  /**
   * 每个文件对应一组焦点记录。
   */
  private readonly focusHistory = new Map<string, FocusPosition[]>();

  /**
   * 文件访问顺序，用于限制最多记录多少个文件。
   */
  private readonly fileOrder: string[] = [];

  /**
   * 防止 navigateBack 时触发 onDidChangeTextEditorSelection 后又重复记录。
   */
  private isNavigating = false;

  /**
   * 防止同一个光标位置重复记录。
   */
  private lastPositionKey = '';

  public handleSelectionChange(
    event: vscode.TextEditorSelectionChangeEvent,
  ): void {
    if (this.isNavigating) return;

    const editor = event.textEditor;

    if (!editor || event.selections.length === 0) {
      return;
    }

    const document = editor.document;

    /**
     * untitled / output / git 等虚拟文档不记录，避免跳转失败。
     */
    if (document.uri.scheme !== 'file') {
      return;
    }

    const selection = event.selections[0];
    const position = selection.active;
    const uri = document.uri.toString();
    const key = `${uri}:${position.line}:${position.character}`;

    if (this.lastPositionKey === key) {
      return;
    }

    this.lastPositionKey = key;

    const history = this.focusHistory.get(uri) || [];

    const existsIndex = history.findIndex(item => {
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

  public async navigateBack(): Promise<void> {
    const editor = vscode.window.activeTextEditor;

    if (!editor) return;

    const uri = editor.document.uri.toString();
    const history = this.focusHistory.get(uri);

    if (!history || history.length <= 1) {
      vscode.window.showInformationMessage('没有更多焦点记录');
      return;
    }

    /**
     * 删除当前焦点。
     */
    history.pop();

    /**
     * 拿到上一个焦点。
     */
    const target = history.pop();

    if (!target) {
      return;
    }

    this.focusHistory.set(uri, history);

    this.isNavigating = true;

    try {
      const document = await vscode.workspace.openTextDocument(
        vscode.Uri.parse(target.uri),
      );

      const targetEditor = await vscode.window.showTextDocument(document, {
        preview: false,
        preserveFocus: false,
      });

      const position = new vscode.Position(target.line, target.character);
      const selection = new vscode.Selection(position, position);
      const range = new vscode.Range(position, position);

      targetEditor.selection = selection;

      targetEditor.revealRange(range, vscode.TextEditorRevealType.InCenter);
    } finally {
      setTimeout(() => {
        this.isNavigating = false;
      }, 100);
    }
  }

  public removeFileHistory(uri: string): void {
    this.focusHistory.delete(uri);

    const index = this.fileOrder.indexOf(uri);

    if (index > -1) {
      this.fileOrder.splice(index, 1);
    }

    if (this.lastPositionKey.startsWith(`${uri}:`)) {
      this.lastPositionKey = '';
    }
  }

  public clear(): void {
    this.focusHistory.clear();
    this.fileOrder.length = 0;
    this.lastPositionKey = '';
    this.isNavigating = false;
  }

  public dispose(): void {
    this.clear();
  }

  private updateFileOrder(uri: string): void {
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
} 