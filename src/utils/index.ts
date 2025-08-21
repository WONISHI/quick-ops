import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

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
  editor.revealRange(new vscode.Range(lastLine, lastLine), vscode.TextEditorRevealType.InCenter);
}

export function isDirLikePath(pathStr: string): boolean {
  return /(['"])(?:\.\.\/|\.\/)\1$/.test(pathStr.trim());
}

export function getAbsolutePath(baseAbsolutePath: string, relativePath: string): string {
  return path.resolve(baseAbsolutePath, relativePath);
}

export async function resolveImportDir(currentFilePath: string, relativeImportPath: string) {
  const currentDir = path.dirname(currentFilePath);
  // 取消引号
  let cleanImportPath = relativeImportPath.replace(/^['"]|['"]$/g, '');
  if (cleanImportPath === './' || cleanImportPath === '../' || /\/$/.test(cleanImportPath)) {
  } else {
    const statPath = getAbsolutePath(currentDir, cleanImportPath);
    if (fs.existsSync(statPath) && fs.statSync(statPath).isDirectory()) {
      cleanImportPath += '/';
    }
  }
  const targetPath = path.isAbsolute(cleanImportPath) ? cleanImportPath : getAbsolutePath(currentDir, cleanImportPath);
  return new Promise<any[]>(async (resolve, reject) => {
    try {
      const stat = await fs.promises.stat(targetPath);
      if (stat.isDirectory()) {
        const entries = await fs.promises.readdir(targetPath, { withFileTypes: true });
        const files: any[] = [];
        const dirs: any[] = [];
        for (const entry of entries) {
          if (entry.isFile()) {
            files.push(entry);
          } else if (entry.isDirectory()) {
            dirs.push(entry);
          }
        }
        resolve([files, dirs]);
      }
    } catch (err) {
      console.log('err', err);
      reject(err);
    }
  });
}

export function matchKeyword(keywords: string[], current: string): boolean {
  for (const k of keywords) {
    if (
      current === k || // 完全相等
      current.startsWith(k) || // current 比 keywords 长
      k.startsWith(current) // keywords 比 current 长
    ) {
      return true;
    }
  }
  return false;
}
