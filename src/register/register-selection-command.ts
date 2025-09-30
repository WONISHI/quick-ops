import * as vscode from 'vscode';
import { fireTrigger } from '../module/mixin/mixin-selection-command';

let lastSelect = '';
let isStickySelected = false;
let timer: ReturnType<typeof setInterval> | null = null;

export function registerSelectionCommand(context: vscode.ExtensionContext) {
  const disposable = vscode.window.onDidChangeTextEditorSelection(() => {
    // 监听最后一次选中
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const selection = editor.selection;
    const selectedText = editor.document.getText(selection).trim();
    if (selectedText !== lastSelect) {
      isStickySelected = false;
      lastSelect = selectedText;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      if (selectedText) {
        timer = setInterval(() => {
          const currentText = editor.document.getText(editor.selection).trim();
          if (currentText === lastSelect && currentText !== '') {
            isStickySelected = true;
            fireTrigger(context);
            if (timer) {
              clearInterval(timer);
              timer = null;
            }
          }
        }, 1000);
      }
    }
  });
  context.subscriptions.push(disposable);
}
