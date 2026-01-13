import * as vscode from 'vscode';
import { IService } from '../core/interfaces/IService';

export class EditorContextService implements IService {
  public readonly serviceId = 'EditorContextService';
  private static _instance: EditorContextService;

  private constructor() {}

  public static getInstance(): EditorContextService {
    if (!this._instance) {
      this._instance = new EditorContextService();
    }
    return this._instance;
  }

  public init(): void {
    // 不需要特殊初始化
  }

  /**
   * 获取当前活跃的文本编辑器
   * @throws Error 如果没有打开的编辑器
   */
  public getActiveEditor(): vscode.TextEditor {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      throw new Error('No active text editor found.');
    }
    return editor;
  }

  /**
   * [新增] 获取当前编辑器信息（安全方法，不抛错）
   * 用于解构赋值，例如: const { editor, cursorPos } = service.getActiveEditorInfo();
   */
  public getActiveEditorInfo(): { 
    editor: vscode.TextEditor | undefined; 
    cursorPos: vscode.Position | undefined; 
    lineText: string | undefined 
  } {
    const editor = vscode.window.activeTextEditor;
    
    if (!editor) {
      return { editor: undefined, cursorPos: undefined, lineText: undefined };
    }

    const cursorPos = editor.selection.active;
    const lineText = editor.document.lineAt(cursorPos.line).text;

    return { editor, cursorPos, lineText };
  }

  /**
   * 滚动到指定行
   */
  public async revealLine(line: number, at: vscode.TextEditorRevealType = vscode.TextEditorRevealType.InCenter) {
    const editor = this.getActiveEditor();
    const position = new vscode.Position(line, 0);
    editor.revealRange(new vscode.Range(position, position), at);

    // 移动光标
    editor.selection = new vscode.Selection(position, position);
  }

  /**
   * 获取当前光标位置的偏移量
   */
  public getCursorOffset(): number {
    const editor = this.getActiveEditor();
    return editor.document.offsetAt(editor.selection.active);
  }
}