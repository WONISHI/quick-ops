import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { IFeature } from '../core/interfaces/IFeature';
import ColorLog from '../utils/ColorLog';

export class ConstantHoverFeature implements IFeature {
  public readonly id = 'ConstantHoverFeature';

  public activate(context: vscode.ExtensionContext): void {
    // 注册悬停提示，针对 Vue、TS、JS 文件生效
    const hoverProvider = vscode.languages.registerHoverProvider(
      ['vue', 'typescript', 'javascript', 'typescriptreact', 'javascriptreact'],
      {
        provideHover: async (document, position) => {
          return this.handleHover(document, position);
        }
      }
    );

    context.subscriptions.push(hoverProvider);
    ColorLog.black(`[${this.id}]`, 'Activated.');
  }

  private async handleHover(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | null> {
    // 1. 提取当前鼠标悬停位置的完整单词/表达式 (支持 A.B 或 A[B.C] 格式)
    const range = document.getWordRangeAtPosition(position, /[a-zA-Z0-9_]+(\.[a-zA-Z0-9_]+|\[[a-zA-Z0-9_\.]+\])*/);
    if (!range) return null;

    const word = document.getText(range);
    
    // 2. 解析表达式结构
    let targetObject = '';
    let targetProperty = '';
    let isComputed = false;

    // 匹配: DISCLOSE_NAME[DISCLOSE_VALUE.BATCH_CLOSE_COMMENTS]
    const nestedMatch = word.match(/^([a-zA-Z0-9_]+)\[([a-zA-Z0-9_\.]+)\]$/);
    if (nestedMatch) {
      targetObject = nestedMatch[1];
      targetProperty = nestedMatch[2];
      isComputed = true;
    } else {
      // 匹配: DISCLOSE_VALUE.BATCH_CLOSE_COMMENTS
      const dotMatch = word.match(/^([a-zA-Z0-9_]+)\.([a-zA-Z0-9_]+)$/);
      if (dotMatch) {
        targetObject = dotMatch[1];
        targetProperty = dotMatch[2];
        isComputed = false;
      } else {
        return null;
      }
    }

    // 3. 在当前文件中查找 import 路径
    const docText = document.getText();
    const importRegex = /import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g;
    let importPath = '';
    let match;

    while ((match = importRegex.exec(docText)) !== null) {
      const importedVars = match[1];
      if (importedVars.includes(targetObject)) {
        importPath = match[2];
        break;
      }
    }

    if (!importPath) return null;

    // 4. 解析绝对路径
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
    if (!workspaceFolder) return null;

    let absolutePath = '';
    if (importPath.startsWith('@/')) {
      // 处理 Vue/Vite 常用的 @/ 别名 (默认指向 src)
      absolutePath = path.join(workspaceFolder, 'src', importPath.substring(2));
    } else if (importPath.startsWith('.')) {
      // 处理相对路径
      absolutePath = path.resolve(path.dirname(document.uri.fsPath), importPath);
    } else {
      // 忽略 node_modules 等第三方包
      return null;
    }

    // 自动补全后缀名
    const extensions = ['.ts', '.js', '/index.ts', '/index.js'];
    let finalPath = '';
    if (fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile()) {
        finalPath = absolutePath;
    } else {
        for (const ext of extensions) {
            if (fs.existsSync(absolutePath + ext)) {
                finalPath = absolutePath + ext;
                break;
            }
        }
    }

    if (!finalPath) return null;

    // 5. 读取目标文件，提取常量值
    try {
      const fileContent = fs.readFileSync(finalPath, 'utf-8');
      const value = this.extractValueFromObject(fileContent, targetObject, targetProperty, isComputed);

      if (value) {
        // 6. 构造漂亮的 Markdown 提示卡片
        const md = new vscode.MarkdownString();
        md.appendMarkdown(`✨ **常量解析**\n\n`);
        md.appendCodeblock(`${targetObject}${isComputed ? `[${targetProperty}]` : `.${targetProperty}`} = "${value}"`, 'typescript');
        return new vscode.Hover(md, range);
      }
    } catch (error) {
      console.error('Hover parsing error:', error);
    }

    return null;
  }

  // 核心：基于轻量级文本提取对应的值
  private extractValueFromObject(content: string, objName: string, propName: string, isComputed: boolean): string | null {
    // 寻找对象的起始位置: export const DISCLOSE_VALUE = {
    const objStartRegex = new RegExp(`(?:export\\s+)?(?:const|let|var)\\s+${objName}\\s*[:=][^\\{]*\\{`, 's');
    const startMatch = objStartRegex.exec(content);
    if (!startMatch) return null;

    const startIndex = startMatch.index + startMatch[0].length;
    let braces = 1;
    let endIndex = startIndex;

    // 简单的括号匹配以截取整个对象块，避免同名属性干扰
    for (let i = startIndex; i < content.length; i++) {
      if (content[i] === '{') braces++;
      if (content[i] === '}') braces--;
      if (braces === 0) {
        endIndex = i;
        break;
      }
    }

    const objContent = content.substring(startIndex, endIndex);

    // 在对象块内用正则提取键值
    let propRegex;
    if (isComputed) {
      // 匹配 [DISCLOSE_VALUE.XXX]: "value"
      const escapedProp = propName.replace(/\./g, '\\.');
      propRegex = new RegExp(`\\[\\s*${escapedProp}\\s*\\]\\s*:\\s*(?:['"\`])(.*?)(?:['"\`])`);
    } else {
      // 匹配 XXX: "value"
      propRegex = new RegExp(`\\b${propName}\\b\\s*:\\s*(?:['"\`])(.*?)(?:['"\`])`);
    }

    const propMatch = propRegex.exec(objContent);
    return propMatch ? propMatch[1] : null;
  }
}