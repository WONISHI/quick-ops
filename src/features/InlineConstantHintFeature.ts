import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { IFeature } from '../core/interfaces/IFeature';
import ColorLog from '../utils/ColorLog';

export class InlineConstantHintFeature implements IFeature {
  public readonly id = 'InlineConstantHintFeature';
  
  // 1. 幽灵文字装饰器 (放置在行尾，完美复刻 GitLens 风格，绝不干扰代码符号)
  private ghostTextDecorationType = vscode.window.createTextEditorDecorationType({
    after: {
      margin: '0 0 0 30px', // 距离代码行尾保持足够的间距
      color: new vscode.ThemeColor('editorGhostText.foreground'),
      fontStyle: 'italic',
      fontWeight: 'normal'
    },
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
  });

  // 2. 悬停跳转装饰器 (包裹在常量本身，提供 Hover 交互)
  private hoverDecorationType = vscode.window.createTextEditorDecorationType({
    // 隐形包裹，仅用于触发 HoverMessage
  });

  private timeout: NodeJS.Timeout | undefined = undefined;
  private fileCache = new Map<string, string>(); 

  public activate(context: vscode.ExtensionContext): void {
    let activeEditor = vscode.window.activeTextEditor;
    if (activeEditor) {
      this.triggerUpdateDecorations(activeEditor);
    }

    // 监听激活的编辑器变化
    vscode.window.onDidChangeActiveTextEditor(editor => {
      activeEditor = editor;
      if (editor) this.triggerUpdateDecorations(editor);
    }, null, context.subscriptions);

    // 监听文档修改
    vscode.workspace.onDidChangeTextDocument(event => {
      if (activeEditor && event.document === activeEditor.document) {
        this.triggerUpdateDecorations(activeEditor);
      }
    }, null, context.subscriptions);

    // 🌟 修复：强制实时监听 VS Code 全局配置面板的变化
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
      // 直接读取最新配置，确保实时生效
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
    
    // 收集两种 Decoration
    const eolDecorations: vscode.DecorationOptions[] = [];
    const hoverDecorations: vscode.DecorationOptions[] = [];

    // 用于合并同一行的多个常量提示
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

    const usageRegex = /\b([A-Z_][A-Z0-9_]*)\[([A-Z_][A-Z0-9_]*)\.([A-Z_][A-Z0-9_]*)\]|\b([A-Z_][A-Z0-9_]*)\.([A-Z_][A-Z0-9_]*)\b/g;
    
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
              targetJumpPath = outerFilePath; // 跳转到提供最终中文定义的文件
            }
          }
        }
      }

      // --- 构建悬停点击跳转卡片 ---
      const originalRange = new vscode.Range(
        editor.document.positionAt(usageMatch.index),
        editor.document.positionAt(usageMatch.index + usageMatch[0].length)
      );

      const md = new vscode.MarkdownString();
      md.isTrusted = true; // 允许执行命令
      
      // 生成跳转命令的 URI 参数
      const fileUri = vscode.Uri.file(targetJumpPath);
      const cmdArgs = encodeURIComponent(JSON.stringify([fileUri]));

      md.appendMarkdown(`✨ **${finalDisplayValue}**\n\n`);
      md.appendMarkdown(`---\n\n`);
      md.appendMarkdown(`[👉 点击前往定义文件 \`${path.basename(targetJumpPath)}\`](command:vscode.open?${cmdArgs})`);

      hoverDecorations.push({
        range: originalRange,
        hoverMessage: md
      });

      // --- 收集行尾幽灵文字 ---
      const lineNum = editor.document.positionAt(usageMatch.index).line;
      if (!lineHintsMap.has(lineNum)) {
        lineHintsMap.set(lineNum, []);
      }
      lineHintsMap.get(lineNum)!.push(finalDisplayValue);
    }

    // --- 批量渲染行尾幽灵文字 ---
    for (const [lineNum, hints] of lineHintsMap.entries()) {
      const lineEndPos = editor.document.lineAt(lineNum).range.end;
      // 如果一行有多个常量，用 | 隔开
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

  // 🌟 修复正则：优化单双引号的匹配容错率，抛弃不可靠的括号闭合判断
  private extractValue(content: string, objName: string, propName: string): string | null {
    const objStartRegex = new RegExp(`(?:export\\s+)?(?:const|let|var)\\s+${objName}\\s*[:=]`, 's');
    const startMatch = objStartRegex.exec(content);
    if (!startMatch) return null;

    const propRegex = new RegExp(`\\b${propName}\\b\\s*:\\s*(["'\`])(.*?)\\1`);
    const res = propRegex.exec(content.substring(startMatch.index));
    return res ? res[2] : null;
  }

  private extractNestedValue(content: string, objName: string, innerObj: string, innerProp: string): string | null {
    const objStartRegex = new RegExp(`(?:export\\s+)?(?:const|let|var)\\s+${objName}\\s*[:=]`, 's');
    const startMatch = objStartRegex.exec(content);
    if (!startMatch) return null;

    const specificRegex = new RegExp(`\\[\\s*${innerObj}\\.${innerProp}\\s*\\]\\s*:\\s*(["'\`])(.*?)\\1`);
    const res = specificRegex.exec(content.substring(startMatch.index));
    return res ? res[2] : null;
  }
}