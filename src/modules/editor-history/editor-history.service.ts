import * as vscode from 'vscode';
import * as path from 'path';
import type {
  EditorHistoryOptions,
  EditorHistoryRecord,
  SwitchPreviousEditorOptions,
} from './editor-history.type';

export class EditorHistoryService {
  private readonly options: EditorHistoryOptions = {
    maxSize: 20,
  };

  private historyStack: EditorHistoryRecord[] = [];

  public pushEditor(editor: vscode.TextEditor): void {
    if (editor.viewColumn === undefined) return;

    const uri = editor.document.uri;
    const uriString = uri.toString();

    if (this.historyStack[0]?.uri === uriString) {
      return;
    }

    const record = this.createRecord(editor);

    this.historyStack = this.historyStack.filter(item => item.uri !== uriString);
    this.historyStack.unshift(record);

    if (this.historyStack.length > this.options.maxSize) {
      this.historyStack = this.historyStack.slice(0, this.options.maxSize);
    }
  }

  public async switchToPreviousEditor(
    options: SwitchPreviousEditorOptions = {},
  ): Promise<void> {
    if (this.historyStack.length < 2) {
      return;
    }

    const target = this.historyStack[1];

    try {
      const uri = vscode.Uri.parse(target.uri);
      const document = await vscode.workspace.openTextDocument(uri);

      await vscode.window.showTextDocument(document, {
        preview: options.preview ?? false,
        viewColumn: options.viewColumn,
      });
    } catch {
      this.remove(target.uri);
      await this.switchToPreviousEditor(options);
    }
  }

  public getHistory(): EditorHistoryRecord[] {
    return [...this.historyStack];
  }

  public clear(): void {
    this.historyStack = [];
  }

  public remove(uri: string): void {
    this.historyStack = this.historyStack.filter(item => item.uri !== uri);
  }

  public dispose(): void {
    this.clear();
  }

  private createRecord(editor: vscode.TextEditor): EditorHistoryRecord {
    const uri = editor.document.uri;
    const fsPath = uri.scheme === 'file' ? uri.fsPath : undefined;

    return {
      uri: uri.toString(),
      fsPath,
      scheme: uri.scheme,
      fileName: fsPath ? path.basename(fsPath) : path.basename(uri.path),
      viewColumn: editor.viewColumn,
      visitedAt: Date.now(),
    };
  }
}