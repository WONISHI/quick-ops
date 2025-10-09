import * as vscode from 'vscode';
import type { ActionTextEditor } from '../types/utils';

export default class VSCodeService {
  static getActiveEditor(cb?: (editor: vscode.TextEditor) => void): ActionTextEditor | void {
    const editor = vscode.window.activeTextEditor ?? null;
    return cb && editor ? cb(editor) : (editor as ActionTextEditor | void);
  }
}
