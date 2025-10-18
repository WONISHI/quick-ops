import * as vscode from 'vscode';
import type { ActionTextEditor, ActionEditorInfoOption } from '../types/utils';

export default class VSCodeService {
  static getActiveEditor(cb?: (editor: vscode.TextEditor) => any): ActionTextEditor | any {
    const editor = vscode.window.activeTextEditor ?? null;
    return cb && editor ? cb(editor) : (editor as ActionTextEditor | void);
  }

  static getActiveEditorInfo(cb?: (option: ActionEditorInfoOption) => any): any {
    VSCodeService.getActiveEditor((editor) => {
      const document = editor.document;
      const cursorPos = editor.selection.active;
      const lineText = document.lineAt(cursorPos.line).text;
      const text = document.getText();
      const offset = document.offsetAt(cursorPos);
      cb && editor ? cb({ editor, document, cursorPos, lineText, text, offset }) : false;
    });
  }
}
