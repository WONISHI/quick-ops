import * as vscode from 'vscode';
import { EditorContextService } from '../../common/services/editor-context.service';

export class SmartScrollService {
  public static inject = [EditorContextService];

  constructor(private readonly editorContextService: EditorContextService) {}

  public scrollToTop(): void {
    try {
      this.editorContextService.revealLine(0, vscode.TextEditorRevealType.AtTop);
    } catch (error) {
      vscode.window.showWarningMessage('无法滚动：当前没有活跃的编辑器');
    }
  }

  public scrollToBottom(): void {
    try {
      const editor = this.editorContextService.getActiveEditor();
      const lastLine = editor.document.lineCount - 1;

      this.editorContextService.revealLine(
        lastLine,
        vscode.TextEditorRevealType.InCenter,
      );
    } catch (error) {
      vscode.window.showWarningMessage('无法滚动：当前没有活跃的编辑器');
    }
  }
}