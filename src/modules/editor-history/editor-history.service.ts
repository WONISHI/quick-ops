import * as path from 'path';
import * as vscode from 'vscode';
import type { HistoryDirection } from '@modules/editor-history/src/type';
import type { EditorHistoryLocation, EditorHistoryOptions, EditorHistoryRecord, SwitchPreviousEditorOptions } from '@modules/editor-history/editor-history.type';

export class EditorHistoryService {
  /**
   * 5 + 5 记忆模式：
   * - 最多记录 5 个文件；
   * - 每个文件最多记录 5 个光标聚焦位置。
   */
  private readonly options: EditorHistoryOptions = {
    maxFiles: 5,
    maxLocationsPerFile: 5,
    selectionDebounceMs: 350,
  };

  /**
   * @description 文件记录按最早访问到最近访问排序
   */
  private historyStack: EditorHistoryRecord[] = [];

  /**
   * @description 当前文件在 historyStack 中的位置
   */
  private currentFileIndex = -1;

  /**
   * @description 光标位置防抖定时器
   */
  private selectionTimer: ReturnType<typeof setTimeout> | undefined;

  /**
   * @description 等待写入的位置对应的编辑器
   */
  private pendingSelectionEditor: vscode.TextEditor | undefined;

  /**
   * @description 快捷键导航期间不重新写入历史，避免破坏前进/后退顺序
   */
  private navigationDepth = 0;

  /**
   * @description 记录一次文件访问和当前文件内聚焦位置
   */
  public pushEditor(editor: vscode.TextEditor): void {
    if (this.isNavigating()) return;
    if (editor.viewColumn === undefined) return;
    if (!this.isActiveEditor(editor)) return;

    const uri = editor.document.uri;
    const uriString = uri.toString();
    const previousRecord = this.historyStack.find((item) => item.uri === uriString);
    const record = previousRecord ? this.updateRecord(previousRecord, editor) : this.createRecord(editor);

    this.pushLocation(record, editor.selection.active);

    /**
     * 文件再次访问时不重复添加，而是移动到最近访问位置。
     */
    this.historyStack = this.historyStack.filter((item) => item.uri !== uriString);
    this.historyStack.push(record);

    /**
     * 超过 5 个文件时，移除最早访问的文件。
     * 文件被移除后，其 locations 会随记录一起删除。
     */
    if (this.historyStack.length > this.options.maxFiles) {
      this.historyStack.splice(0, this.historyStack.length - this.options.maxFiles);
    }

    this.currentFileIndex = this.historyStack.length - 1;
  }

  /**
   * @description 防抖记录当前文件的光标聚焦位置
   */
  public scheduleEditorPosition(editor: vscode.TextEditor): void {
    if (this.isNavigating()) return;
    if (!this.isActiveEditor(editor)) return;

    this.clearSelectionTimer();
    this.pendingSelectionEditor = editor;

    this.selectionTimer = setTimeout(() => {
      const pendingEditor = this.pendingSelectionEditor;

      this.selectionTimer = undefined;
      this.pendingSelectionEditor = undefined;

      if (!pendingEditor) return;
      if (!this.isActiveEditor(pendingEditor)) return;

      this.pushEditor(pendingEditor);
    }, this.options.selectionDebounceMs);
  }

  /**
   * @description 循环返回上一个访问文件
   */
  public async switchToPreviousEditor(options: SwitchPreviousEditorOptions = {}): Promise<void> {
    await this.switchEditor(-1, options);
  }

  /**
   * @description 循环前进到下一个访问文件
   */
  public async switchToNextEditor(options: SwitchPreviousEditorOptions = {}): Promise<void> {
    await this.switchEditor(1, options);
  }

  /**
   * @description 循环返回当前文件的上一个聚焦位置
   */
  public async switchToPreviousLocation(): Promise<void> {
    await this.switchLocation(-1);
  }

  /**
   * @description 循环前进到当前文件的下一个聚焦位置
   */
  public async switchToNextLocation(): Promise<void> {
    await this.switchLocation(1);
  }

  /**
   * @description 获取文件历史的安全副本
   */
  public getHistory(): EditorHistoryRecord[] {
    return this.historyStack.map((record) => ({
      ...record,
      locations: record.locations.map((location) => ({
        ...location,
      })),
    }));
  }

  public clear(): void {
    this.clearSelectionTimer();
    this.pendingSelectionEditor = undefined;
    this.historyStack = [];
    this.currentFileIndex = -1;
  }

  public remove(uri: string): void {
    const removeIndex = this.historyStack.findIndex((item) => item.uri === uri);

    if (removeIndex < 0) return;

    this.historyStack.splice(removeIndex, 1);

    if (this.historyStack.length === 0) {
      this.currentFileIndex = -1;
      return;
    }

    if (removeIndex < this.currentFileIndex) {
      this.currentFileIndex--;
    } else if (this.currentFileIndex >= this.historyStack.length) {
      this.currentFileIndex = this.historyStack.length - 1;
    }
  }

  public dispose(): void {
    this.clear();
  }

  /**
   * @description 按方向循环切换文件
   */
  private async switchEditor(direction: HistoryDirection, options: SwitchPreviousEditorOptions): Promise<void> {
    this.flushPendingSelection();

    if (this.historyStack.length === 0) {
      return;
    }

    const maxAttempts = this.historyStack.length;

    for (let attempt = 0; attempt < maxAttempts && this.historyStack.length > 0; attempt++) {
      const activeUri = vscode.window.activeTextEditor?.document.uri.toString();
      const activeIndex = activeUri ? this.historyStack.findIndex((item) => item.uri === activeUri) : -1;

      if (activeIndex >= 0) {
        this.currentFileIndex = activeIndex;
      } else if (this.currentFileIndex < 0 || this.currentFileIndex >= this.historyStack.length) {
        this.currentFileIndex = this.historyStack.length - 1;
      }

      const targetIndex = this.wrapIndex(this.currentFileIndex + direction, this.historyStack.length);
      const target = this.historyStack[targetIndex];

      try {
        await this.openRecord(target, options);
        this.currentFileIndex = targetIndex;
        return;
      } catch {
        this.remove(target.uri);
      }
    }
  }

  /**
   * @description 按方向循环切换当前文件中的聚焦位置
   */
  private async switchLocation(direction: HistoryDirection): Promise<void> {
    this.flushPendingSelection();

    const activeEditor = vscode.window.activeTextEditor;

    if (!activeEditor) {
      return;
    }

    const uriString = activeEditor.document.uri.toString();
    let recordIndex = this.historyStack.findIndex((item) => item.uri === uriString);

    /**
     * 当前文件还没有历史记录时，先记录当前文件和当前位置。
     */
    if (recordIndex < 0) {
      this.pushEditor(activeEditor);
      recordIndex = this.historyStack.findIndex((item) => item.uri === uriString);
    }

    if (recordIndex < 0) {
      return;
    }

    const record = this.historyStack[recordIndex];

    if (record.locations.length === 0) {
      return;
    }

    const currentLocationIndex = record.activeLocationIndex >= 0 && record.activeLocationIndex < record.locations.length ? record.activeLocationIndex : record.locations.length - 1;

    const targetLocationIndex = this.wrapIndex(currentLocationIndex + direction, record.locations.length);

    record.activeLocationIndex = targetLocationIndex;
    record.viewColumn = activeEditor.viewColumn;

    await this.revealLocation(activeEditor, record.locations[targetLocationIndex]);
  }

  /**
   * @description 打开文件并恢复该文件记忆的聚焦位置
   */
  private async openRecord(record: EditorHistoryRecord, options: SwitchPreviousEditorOptions): Promise<void> {
    const uri = vscode.Uri.parse(record.uri);
    const document = await vscode.workspace.openTextDocument(uri);
    const location = this.getActiveLocation(record);
    const position = this.resolveDocumentPosition(document, location);
    const selection = new vscode.Range(position, position);

    await this.runWithoutRecording(async () => {
      const editor = await vscode.window.showTextDocument(document, {
        preview: options.preview ?? false,
        viewColumn: options.viewColumn ?? record.viewColumn,
        selection,
      });

      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    });
  }

  /**
   * @description 在当前编辑器中恢复一个历史位置
   */
  private async revealLocation(editor: vscode.TextEditor, location: EditorHistoryLocation): Promise<void> {
    const position = this.resolveDocumentPosition(editor.document, location);

    await this.runWithoutRecording(async () => {
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    });
  }

  /**
   * @description 文件内位置采用 LRU 顺序，最早访问在前，最近访问在后
   */
  private pushLocation(record: EditorHistoryRecord, position: vscode.Position): void {
    const location: EditorHistoryLocation = {
      line: position.line,
      character: position.character,
      visitedAt: Date.now(),
    };

    /**
     * 同一行视为同一个聚焦位置：
     * - 不重复添加；
     * - 更新字符位置和访问时间；
     * - 移动到最近访问位置。
     */
    record.locations = record.locations.filter((item) => item.line !== location.line);
    record.locations.push(location);

    if (record.locations.length > this.options.maxLocationsPerFile) {
      record.locations.splice(0, record.locations.length - this.options.maxLocationsPerFile);
    }

    record.activeLocationIndex = record.locations.length - 1;
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
      locations: [],
      activeLocationIndex: -1,
    };
  }

  private updateRecord(record: EditorHistoryRecord, editor: vscode.TextEditor): EditorHistoryRecord {
    const uri = editor.document.uri;
    const fsPath = uri.scheme === 'file' ? uri.fsPath : undefined;

    return {
      ...record,
      fsPath,
      scheme: uri.scheme,
      fileName: fsPath ? path.basename(fsPath) : path.basename(uri.path),
      viewColumn: editor.viewColumn,
      visitedAt: Date.now(),
      locations: [...record.locations],
    };
  }

  private getActiveLocation(record: EditorHistoryRecord): EditorHistoryLocation {
    if (record.locations.length === 0) {
      return {
        line: 0,
        character: 0,
        visitedAt: record.visitedAt,
      };
    }

    const index = record.activeLocationIndex >= 0 && record.activeLocationIndex < record.locations.length ? record.activeLocationIndex : record.locations.length - 1;

    return record.locations[index];
  }

  /**
   * @description 文件内容改变后，确保旧位置不会超过当前文档范围
   */
  private resolveDocumentPosition(document: vscode.TextDocument, location: EditorHistoryLocation): vscode.Position {
    const maxLine = Math.max(0, document.lineCount - 1);
    const line = Math.min(Math.max(0, location.line), maxLine);
    const maxCharacter = document.lineAt(line).text.length;
    const character = Math.min(Math.max(0, location.character), maxCharacter);

    return new vscode.Position(line, character);
  }

  private isActiveEditor(editor: vscode.TextEditor): boolean {
    const activeEditor = vscode.window.activeTextEditor;

    if (!activeEditor) return false;

    return activeEditor.document.uri.toString() === editor.document.uri.toString() && activeEditor.viewColumn === editor.viewColumn;
  }

  /**
   * @description 执行快捷键导航时暂停历史写入
   */
  private async runWithoutRecording(action: () => Promise<void>): Promise<void> {
    this.clearSelectionTimer();
    this.pendingSelectionEditor = undefined;
    this.navigationDepth++;

    try {
      await action();

      /**
       * 等待 VS Code 将 active editor / selection 事件派发完成，
       * 避免快捷键跳转被当成新的手动访问。
       */
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
    } finally {
      this.navigationDepth = Math.max(0, this.navigationDepth - 1);
    }
  }

  /**
   * @description 快捷键执行前立即写入尚未结束防抖的手动位置
   */
  private flushPendingSelection(): void {
    const pendingEditor = this.pendingSelectionEditor;

    this.clearSelectionTimer();
    this.pendingSelectionEditor = undefined;

    if (!pendingEditor) return;
    if (!this.isActiveEditor(pendingEditor)) return;

    this.pushEditor(pendingEditor);
  }

  private clearSelectionTimer(): void {
    if (!this.selectionTimer) return;

    clearTimeout(this.selectionTimer);
    this.selectionTimer = undefined;
  }

  private isNavigating(): boolean {
    return this.navigationDepth > 0;
  }

  private wrapIndex(index: number, length: number): number {
    return ((index % length) + length) % length;
  }
}
