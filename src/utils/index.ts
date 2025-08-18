import * as vscode from 'vscode';
export function generateUUID(length: number = 32): string {
  const chars = '0123456789abcdef'; // 十六进制字符
  let uuid = '';
  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * chars.length);
    uuid += chars[randomIndex];
  }
  return uuid;
}

export function getVisualColumn(text: string, character: number): number {
  let col = 0;
  for (let i = 0; i < character; i++) {
    const ch = text[i];
    if (/[\uD800-\uDBFF]/.test(ch)) {
      continue;
    }
    col++;
  }
  return col;
}

export function moveCursor(line: number, character: number) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  const position = new vscode.Position(line, character);
  editor.selection = new vscode.Selection(position, position);
  editor.revealRange(new vscode.Range(position, position));
}

export function scrollToTop() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  const topLine = new vscode.Position(0, 0);
  editor.revealRange(new vscode.Range(topLine, topLine), vscode.TextEditorRevealType.AtTop);
}

export function scrollToBottom() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const lastLineIndex = editor.document.lineCount - 1;
    const lastLine = new vscode.Position(lastLineIndex, 0);
    editor.selection = new vscode.Selection(lastLine, lastLine);
    editor.revealRange(
        new vscode.Range(lastLine, lastLine),
        vscode.TextEditorRevealType.InCenter
    );
}
