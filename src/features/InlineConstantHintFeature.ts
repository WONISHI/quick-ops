import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { IFeature } from '../core/interfaces/feature.interface';
import ColorLog from '../utils/ColorLog';

export class InlineConstantHintFeature implements IFeature {
  public readonly id = 'InlineConstantHintFeature';
  
  // 幽灵文字装饰器 (放置在行尾，完美复刻 GitLens 风格)
  private ghostTextDecorationType = vscode.window.createTextEditorDecorationType({
    after: {
      margin: '0 0 0 30px',
      color: new vscode.ThemeColor('editorGhostText.foreground'),
      fontStyle: 'italic',
      fontWeight: 'normal'
    },
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
  });

  // 悬停跳转装饰器
  private hoverDecorationType = vscode.window.createTextEditorDecorationType({});

  private timeout: NodeJS.Timeout | undefined = undefined;
  private fileCache = new Map<string, string>(); 

  public activate(context: vscode.ExtensionContext): void {
    let activeEditor = vscode.window.activeTextEditor;
    if (activeEditor) {
      this.triggerUpdateDecorations(activeEditor);
    }

    vscode.window.onDidChangeActiveTextEditor(editor => {
      activeEditor = editor;
      if (editor) this.triggerUpdateDecorations(editor);
    }, null, context.subscriptions);

    vscode.workspace.onDidChangeTextDocument(event => {
      if (activeEditor && event.document === activeEditor.document) {
        this.triggerUpdateDecorations(activeEditor);
      }
    }, null, context.subscriptions);

    // 强制实时监听 VS Code 全局配置面板的变化
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('quick-ops.general.inlineConstantHints')) {
        if (activeEditor) this.triggerUpdateDecorations(activeEditor);
      }
    }, null, context.subscriptions);

    ColorLog.black(`[${this.id}]`, 'Activated.');
  }

  private triggerUpdateDecorations(editor: vscode.TextEditor) {
    if (this.timeout) {
      clearTimeout(this.timeout);
    }
    this.timeout = setTimeout(() => {
      const isEnabled = vscode.workspace.getConfiguration('quick-ops').get<boolean>('general.inlineConstantHints', true);
      
      if (isEnabled) {
        this.updateDecorations(editor);
      } else {
        editor.setDecorations(this.ghostTextDecorationType, []);
        editor.setDecorations(this.hoverDecorationType, []);
      }
    }, 300);
  }

  private updateDecorations(editor: vscode.TextEditor) {
    if (!editor || !['vue', 'typescript', 'javascript', 'typescriptreact', 'javascriptreact'].includes(editor.document.languageId)) {
      return;
    }

    const text = editor.document.getText();
    const eolDecorations: vscode.DecorationOptions[] = [];
    const hoverDecorations: vscode.DecorationOptions[] = [];
    const lineHintsMap = new Map<number, string[]>();

    const importRegex = /import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g;
    const importsMap = new Map<string, string>();
    
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
    if (!workspaceFolder) return;

    let match;
    while ((match = importRegex.exec(text)) !== null) {
      const importedVars = match[1].split(',').map(v => v.trim());
      let importPath = match[2];
      
      let absolutePath = '';
      if (importPath.startsWith('@/')) {
        absolutePath = path.join(workspaceFolder, 'src', importPath.substring(2));
      } else if (importPath.startsWith('.')) {
        absolutePath = path.resolve(path.dirname(editor.document.uri.fsPath), importPath);
      } else {
        continue;
      }

      const targetPath = this.resolveFilePath(absolutePath);
      if (targetPath) {
        importedVars.forEach(v => importsMap.set(v, targetPath));
      }
    }

    if (importsMap.size === 0) {
      editor.setDecorations(this.ghostTextDecorationType, []);
      editor.setDecorations(this.hoverDecorationType, []);
      return;
    }

    // 🌟 修复1：放宽正则匹配，支持驼峰、帕斯卡等 Enum 常用的命名法 (允许小写字母)
    const usageRegex = /\b([A-Za-z_][A-Za-z0-9_]*)\[([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\]|\b([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\b/g;
    
    let usageMatch;
    while ((usageMatch = usageRegex.exec(text)) !== null) {
      const isNested = !!usageMatch[1]; 
      
      let outerObj = isNested ? usageMatch[1] : '';
      let innerObj = isNested ? usageMatch[2] : usageMatch[4];
      let innerProp = isNested ? usageMatch[3] : usageMatch[5];

      const innerFilePath = importsMap.get(innerObj);
      if (!innerFilePath) continue;

      const innerFileContent = this.getFileContent(innerFilePath);
      if (!innerFileContent) continue;

      const innerValue = this.extractValue(innerFileContent, innerObj, innerProp);
      if (!innerValue) continue;

      let finalDisplayValue = innerValue;
      let targetJumpPath = innerFilePath;

      if (isNested) {
        const outerFilePath = importsMap.get(outerObj);
        if (outerFilePath) {
          const outerFileContent = this.getFileContent(outerFilePath);
          if (outerFileContent) {
            const outerValue = this.extractNestedValue(outerFileContent, outerObj, innerObj, innerProp);
            if (outerValue) {
              finalDisplayValue = outerValue;
              targetJumpPath = outerFilePath;
            }
          }
        }
      }

      const originalRange = new vscode.Range(
        editor.document.positionAt(usageMatch.index),
        editor.document.positionAt(usageMatch.index + usageMatch[0].length)
      );

      const md = new vscode.MarkdownString();
      md.isTrusted = true;
      const fileUri = vscode.Uri.file(targetJumpPath);
      const cmdArgs = encodeURIComponent(JSON.stringify([fileUri]));

      md.appendMarkdown(`✨ **${finalDisplayValue}**\n\n`);
      md.appendMarkdown(`---\n\n`);
      md.appendMarkdown(`[👉 点击前往定义文件 \`${path.basename(targetJumpPath)}\`](command:vscode.open?${cmdArgs})`);

      hoverDecorations.push({
        range: originalRange,
        hoverMessage: md
      });

      const lineNum = editor.document.positionAt(usageMatch.index).line;
      if (!lineHintsMap.has(lineNum)) {
        lineHintsMap.set(lineNum, []);
      }
      lineHintsMap.get(lineNum)!.push(finalDisplayValue);
    }

    for (const [lineNum, hints] of lineHintsMap.entries()) {
      const lineEndPos = editor.document.lineAt(lineNum).range.end;
      const combinedHints = hints.join(' ｜ ');

      eolDecorations.push({
        range: new vscode.Range(lineEndPos, lineEndPos),
        renderOptions: {
          after: {
            contentText: `    ✨ ${combinedHints}`
          }
        }
      });
    }

    editor.setDecorations(this.ghostTextDecorationType, eolDecorations);
    editor.setDecorations(this.hoverDecorationType, hoverDecorations);
  }

  private getFileContent(filePath: string): string | null {
    if (this.fileCache.has(filePath)) return this.fileCache.get(filePath)!;
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      this.fileCache.set(filePath, content);
      return content;
    } catch (e) {
      return null;
    }
  }

  private resolveFilePath(absolutePath: string): string | null {
    const extensions = ['', '.ts', '.js', '/index.ts', '/index.js'];
    for (const ext of extensions) {
      const p = absolutePath + ext;
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
    }
    return null;
  }

  // 🌟 修复2：匹配头部增加 enum，且忽略可能的冒号或等号的包裹
  private extractValue(content: string, objName: string, propName: string): string | null {
    const objStartRegex = new RegExp(`(?:export\\s+)?(?:const|let|var|enum)\\s+${objName}\\s*(?:[:=]\\s*)?[^\\{]*\\{`, 's');
    const startMatch = objStartRegex.exec(content);
    if (!startMatch) return null;

    const startIndex = startMatch.index + startMatch[0].length;
    let braces = 1, endIndex = startIndex;
    for (let i = startIndex; i < content.length; i++) {
      if (content[i] === '{') braces++;
      if (content[i] === '}') braces--;
      if (braces === 0) { endIndex = i; break; }
    }

    const objContent = content.substring(startIndex, endIndex);

    // 🌟 修复3：同时兼容 `:` 和 `=`，并兼容数字枚举和字符串枚举
    // 匹配如: Root = "root" 或 Root: "root" 或 Root = 1
    const propRegex = new RegExp(`\\b${propName}\\b\\s*[:=]\\s*(?:(["'\`])(.*?)\\1|([^,\\s\\}]+))`);
    const res = propRegex.exec(objContent);
    
    // res[2] 对应字符串匹配结果，res[3] 对应数字匹配结果
    return res ? (res[2] !== undefined ? res[2] : res[3]) : null;
  }

  private extractNestedValue(content: string, objName: string, innerObj: string, innerProp: string): string | null {
    const objStartRegex = new RegExp(`(?:export\\s+)?(?:const|let|var|enum)\\s+${objName}\\s*(?:[:=]\\s*)?[^\\{]*\\{`, 's');
    const startMatch = objStartRegex.exec(content);
    if (!startMatch) return null;

    const startIndex = startMatch.index + startMatch[0].length;
    let braces = 1, endIndex = startIndex;
    for (let i = startIndex; i < content.length; i++) {
      if (content[i] === '{') braces++;
      if (content[i] === '}') braces--;
      if (braces === 0) { endIndex = i; break; }
    }

    const objContent = content.substring(startIndex, endIndex);
    
    // 兼容对象计算属性中包含枚举/常量的情况
    const specificRegex = new RegExp(`\\[\\s*${innerObj}\\.${innerProp}\\s*\\]\\s*:\\s*(?:(["'\`])(.*?)\\1|([^,\\s\\}]+))`);
    const res = specificRegex.exec(objContent);
    return res ? (res[2] !== undefined ? res[2] : res[3]) : null;
  }
}