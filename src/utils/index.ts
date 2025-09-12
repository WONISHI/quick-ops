import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { isAlias } from './verify';

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

/**
 * 滚动到顶部
 * @export
 * @returns
 */
export function scrollToTop() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  const topLine = new vscode.Position(0, 0);
  editor.revealRange(new vscode.Range(topLine, topLine), vscode.TextEditorRevealType.AtTop);
}

/**
 * 滚动到底部
 * @export
 * @returns
 */
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

/**
 * 获取绝对路径
 * @export
 * @param {string} baseAbsolutePath
 * @param {string} relativePath
 * @returns {string}
 */
export function getAbsolutePath(baseAbsolutePath: string, relativePath: string): string {
  return path.resolve(baseAbsolutePath, relativePath);
}

/*
 * 相对地址拼接
 * @export
 * @param {...string[]} paths
 * @returns {string}
 * */
export function joinPaths(...paths: string[]): string {
  return paths
    .filter(Boolean) // 去掉空字符串
    .map((p, index) => {
      let segment = p;
      // 去掉前面多余的 /
      if (index > 0) {
        segment = segment.replace(/^\/+/, '');
      }
      // 去掉末尾多余的 /
      segment = segment.replace(/\/+$/, '');
      return segment;
    })
    .join('/');
}

/**
 * 替换单引号和多引号
 * @export
 * @param {string} str
 * @returns
 */

export function removeSurroundingQuotes(str: string) {
  return str.replace(/^['"]|['"]$/g, '');
}

/**
 *
 * 查找绝对路径下对应的相对路径下的目录或文件
 * @export
 * @param {string} currentFilePath 绝对路径
 * @param {string} relativeImportPath 相对路径
 * @returns
 */

export async function resolveImportDir(currentFilePath: string, relativeImportPath: string) {
  const currentDir = path.dirname(currentFilePath);
  // 取消引号
  let cleanImportPath = removeSurroundingQuotes(relativeImportPath);
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

/**
 * * 匹配关键词
 * @export
 * @param {string[]} keywords
 * @param {string} current
 * @returns {boolean}
 */

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

/**
 * 替换导入路径，换成置顶的模版
 * @export
 * @param {string} importStatement 替换的导入路径
 * @returns
 */
export async function replaceCurrentPath(importStatement: string) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  const document = editor.document;
  const cursorPos = editor.selection.active;
  const lineText = document.lineAt(cursorPos.line).text;

  // 找到光标所在的引号范围
  let start = -1;
  let end = -1;
  const quoteChars = [`'`, `"`];
  for (let i = 0; i < lineText.length; i++) {
    if (quoteChars.includes(lineText[i])) {
      if (i < cursorPos.character) {
        start = i;
      } else if (quoteChars.includes(lineText[i]) && start !== i) {
        end = i;
        break;
      }
    }
  }
  if (start === -1 || end === -1) return;

  const range = new vscode.Range(new vscode.Position(cursorPos.line, start), new vscode.Position(cursorPos.line, end + 1));
  const snippet = new vscode.SnippetString(importStatement);
  await editor.insertSnippet(snippet, range);
}

/**
 * 判断光标是否在大括号里面
 */
export function isCursorInsideBraces(): boolean {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return false;

  const document = editor.document;
  const position = editor.selection.active;

  const text = document.getText();
  const offset = document.offsetAt(position);

  // 用一个简单的栈判断
  let stack = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') stack++;
    if (text[i] === '}') stack--;
    if (i === offset) break;
  }

  return stack > 0;
}

/**
 * 解析import导入哪些函数
 * @param document 语句
 * @returns
 */
export function getCurrentImports(document: vscode.TextDocument): string[] {
  const text = document.getText();
  const regex = /import\s+{([^}]+)}\s+from\s+['"].+['"]/g;
  const imports: string[] = [];
  let match;
  while ((match = regex.exec(text))) {
    const names = match[1].split(',').map((s) => s.trim());
    imports.push(...names);
  }
  return imports;
}

/**
 * 解析ignore文件
 * @export
 * @param {string} gitignoreContent ignore文件内容
 * @returns
 */

export function ignoreArray(gitignoreContent: string) {
  return gitignoreContent
    .split(/\r?\n/) // 按行分割
    .map((line) => line.trim()) // 去掉前后空格
    .filter((line) => line && !line.startsWith('#')); // 去掉空行和注释
}
