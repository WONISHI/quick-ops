import * as vscode from 'vscode';

let lastSelect = '';
let isStickySelected = false;
let timer: ReturnType<typeof setInterval> | null = null;
let callbacks: ((options: { vscode: vscode.ExtensionContext; isStickySelected: boolean }) => void)[] = [];

export function useEditorSelection(context: vscode.ExtensionContext) {
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
            // 触发回调
            callbacks.forEach((cb) => {
              try {
                cb({ vscode: context, isStickySelected });
              } catch (err) {
                console.error('useSelection callback error:', err);
              }
            });
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

export default function useSelection(callback: (options: { vscode: vscode.ExtensionContext; isStickySelected: boolean }) => void) {
  if (typeof callback === 'function') {
    callbacks.push(callback);
  }
}
