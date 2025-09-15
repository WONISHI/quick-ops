import * as vscode from 'vscode';

let statusBarItem: vscode.StatusBarItem;

function createCursorStatusBar() {
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.show();

  // 每次光标移动更新状态栏
  vscode.window.onDidChangeTextEditorSelection(updateStatusBar);
  vscode.window.onDidChangeActiveTextEditor(updateStatusBar);
}

function getCursorInfo() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return '';

  const document = editor.document;
  const selection = editor.selection;

  let totalChars = 0;
  for (let lineNum = 0; lineNum < selection.start.line; lineNum++) {
    totalChars += document.lineAt(lineNum).text.length + 1; // +1 代表换行
  }
  totalChars += selection.start.character;

  const currentLine = selection.start.line + 1; // VS Code 行号从 1 开始
  const currentCol = selection.start.character + 1;

  const tabSize = editor.options.tabSize || 4;
  return `行 ${currentLine}, 列 ${currentCol}, 多上行字符 ${totalChars}, 空格 ${tabSize}`;
}

function updateStatusBar() {
  if (!statusBarItem) return;
  statusBarItem.text = getCursorInfo();
}

export function registerSelectionCommand(context: vscode.ExtensionContext) {
  // html to scss
  // 转ts
  // 统计选中字符，行数
  createCursorStatusBar();
  const disposable = vscode.window.onDidChangeTextEditorSelection((e) => {
    const editor = e.textEditor;
    const selection = editor.selection;
    // 获取选中的文本
    const selectedText = editor.document.getText(selection).trim();
    if (selectedText) {

    }
  });

  context.subscriptions.push(disposable, statusBarItem);
}
