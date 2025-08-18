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

export function resolveImportDir(currentFilePath: string, relativeImportPath: string): any {
  const currentDir = path.dirname(currentFilePath);
  // 取消引号
  let cleanImportPath = relativeImportPath.replace(/^['"]|['"]$/g, '');
  if (cleanImportPath === './' || cleanImportPath === '../' || /\/$/.test(cleanImportPath)) {
  } else {
    const statPath = path.resolve(currentDir, cleanImportPath);
    if (fs.existsSync(statPath) && fs.statSync(statPath).isDirectory()) {
      cleanImportPath += '/';
    }
  }
  const targetPath = path.resolve(currentDir, cleanImportPath);
  const uri = vscode.Uri.file(targetPath);
  vscode.workspace.fs.stat(uri).then(
    (stat) => {
      if (stat.type & vscode.FileType.Directory) {
        console.log('这是文件夹');
      } else if (stat.type & vscode.FileType.File) {
        console.log('这是文件');
      }
    },
    (err) => {
      console.error('路径不存在或访问失败', err);
    },
  );
  // const entries = fs.readdirSync(targetPath, { withFileTypes: true });
  // console.log(entries);
  // const files: string[] = [];
  // const dirs: string[] = [];
  // for (const entry of entries) {
  //   if (entry.isFile()) {
  //     files.push(entry.name);
  //   } else if (entry.isDirectory()) {
  //     dirs.push(entry.name);
  //   }
  // }
  // return { files, dirs };
}

export async function readDirFiles(relativePath: string) {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) return [];
  const baseUri = workspaceFolders[0].uri; // 默认第一个工作区
  const targetUri = vscode.Uri.joinPath(baseUri, relativePath);
  try {
    const files = await vscode.workspace.fs.readDirectory(targetUri);
    return files.filter(([name, type]) => type === vscode.FileType.File).map(([name]) => name);
  } catch (e) {
    vscode.window.showErrorMessage(`读取目录失败: ${e}`);
    return [];
  }
}
