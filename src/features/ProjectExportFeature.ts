import * as vscode from 'vscode';
import * as path from 'path';
import { IFeature } from '../core/interfaces/IFeature';
import { WorkspaceStateService } from '../services/WorkspaceStateService';
import { EditorContextService } from '../services/EditorContextService';
import { PathHelper } from '../utils/PathHelper';
import { AstParser } from '../utils/AstParser';

interface ExportState {
  namedExports: string[];
  defaultExport: string[];
  selectedExports: string[]; // 用户已经选择导入的
}

export class ProjectExportFeature implements IFeature {
  public readonly id = 'ProjectExportFeature';

  // 内部状态，用于缓存当前选中文件的导出信息
  private state: ExportState = {
    namedExports: [],
    defaultExport: [],
    selectedExports: [],
  };

  constructor(
    private workspaceState: WorkspaceStateService = WorkspaceStateService.getInstance(),
    private editorService: EditorContextService = EditorContextService.getInstance(),
  ) {}

  public activate(context: vscode.ExtensionContext): void {
    const selector: vscode.DocumentSelector = ['javascript', 'typescript', 'vue', 'javascriptreact', 'typescriptreact'];

    // 1. 注册路径补全 ('/')
    // 当用户输入 '/' 时触发，列出文件夹和文件
    const pathProvider = vscode.languages.registerCompletionItemProvider(selector, { provideCompletionItems: this.providePathCompletion.bind(this) }, '/');

    // 2. 注册函数/变量导出补全 ('{', ',', ' ')
    // 当 import { } 中间触发时使用
    const funcProvider = vscode.languages.registerCompletionItemProvider(
      selector,
      {
        provideCompletionItems: this.provideExportCompletion.bind(this),
        resolveCompletionItem: this.resolveExportCompletion.bind(this),
      },
      '{',
      ',',
      ' ',
    );

    // 3. 注册内部命令
    const cmdPath = vscode.commands.registerCommand('quick-ops.onPathSelected', this.handlePathSelected.bind(this));
    const cmdFunc = vscode.commands.registerCommand('quick-ops.onFuncSelected', this.handleFuncSelected.bind(this));

    context.subscriptions.push(pathProvider, funcProvider, cmdPath, cmdFunc);
    console.log(`[${this.id}] Activated.`);
  }

  /**
   * 提供路径补全建议
   */
  private async providePathCompletion(document: vscode.TextDocument, position: vscode.Position) {
    const lineText = document.lineAt(position).text;
    const char = document.getText(new vscode.Range(position.translate(0, -1), position)); // 只有在用户输入 '/' 时才触发
    if (char !== '/') return [];

    const currentFilePath = document.uri.fsPath;
    const currentDir = path.dirname(currentFilePath); // 1. 【核心修复】先计算出当前 import 语句指向的"绝对目录路径"
    // 例如 lineText 是 './assets/js/'，这里就算出 D:\...\src\assets\js
    const rawImportPath = PathHelper.removeSurroundingQuotes(lineText);
    const targetDirAbsolutePath = PathHelper.getAbsolutePath(currentDir, rawImportPath); // 解析该目录下的内容

    const entries = await PathHelper.resolveImportDir(currentFilePath, lineText);

    return entries.map((entry) => {
      const isDir = entry.isDirectory();
      const item = new vscode.CompletionItem(entry.name, isDir ? vscode.CompletionItemKind.Folder : vscode.CompletionItemKind.File);
      item.insertText = entry.name;

      if (!isDir) {
        item.command = {
          command: 'quick-ops.onPathSelected',
          title: 'Path Selected',
          arguments: [
            {
              fileName: entry.name,
              parentPath: targetDirAbsolutePath,
              isDirectory: isDir,
              lineText,
            },
          ],
        };
      }
      return item;
    });
  }

  /**
   * 处理文件被选中后的逻辑 (解析 AST -> 生成语句 -> 替换整行)
   */
  private async handlePathSelected(args: { fileName: string; parentPath: string; isDirectory: boolean; lineText: string }) {
    console.log('9999', args);
    // 防御性判断：文件夹不处理
    if (args.isDirectory) return;

    const fullPath = path.join(args.parentPath, args.fileName);

    console.log('Full Path to Parse:', fullPath);
    // D:\修复\报料-2025-0627\report-cms\src\assets\js\date.js

    // 1. 解析 AST 获取导出信息
    let exports = AstParser.parseExports(fullPath);
    const vueName = AstParser.parseVueComponentName(fullPath);

    // 针对 Vue 文件的特殊处理
    if (fullPath.endsWith('.vue') && vueName) {
      exports.defaultExport = [vueName];
    }

    // 2. 更新内部状态 (供后续 { } 补全使用)
    this.state = {
      namedExports: exports.namedExports,
      defaultExport: exports.defaultExport,
      selectedExports: [],
    };

    console.log('Parsed Exports:', this.state);

    // 3. 计算 import 中的相对路径
    // 移除用户输入行中的引号部分，拿到基础路径 (如 "./utils/")
    const rawImportPath = PathHelper.removeSurroundingQuotes(args.lineText);

    // 拼接文件名
    let finalPath = path.posix.join(rawImportPath, args.fileName);

    // 移除后缀 (.ts, .js, .vue 等)
    finalPath = finalPath.replace(/\.(ts|js|vue|tsx|jsx|d\.ts)$/, '');

    // 确保以 ./ 开头 (如果 path.join 去掉了它)
    if (rawImportPath.startsWith('./') && !finalPath.startsWith('./') && !finalPath.startsWith('../')) {
      finalPath = './' + finalPath;
    }

    // 4. 生成最终的 Import 语句
    const importStmt = this.generateImportStatement(finalPath, exports);

    console.log('Generated Import Statement:', importStmt);

    // 5. 执行整行替换
    await this.replaceCurrentImportLine(importStmt);

    // 6. 如果是命名导出，自动触发补全建议供用户选择
    if (importStmt.includes('{  }')) {
      setTimeout(() => vscode.commands.executeCommand('editor.action.triggerSuggest'), 50);
    }
  }

  /**
   * 根据导出类型生成 Import 语句
   */
  private generateImportStatement(relativePath: string, exports: { namedExports: string[]; defaultExport: string[] }): string {
    // 优先级 1: 默认导出 (export default ...)
    if (exports.defaultExport.length > 0) {
      return `import ${exports.defaultExport[0]} from '${relativePath}';`;
    }
    // 优先级 2: 命名导出 (export const ...) -> 生成空括号供补全
    else if (exports.namedExports.length > 0) {
      return `import {  } from '${relativePath}';`;
    }
    // 优先级 3: 无导出 (可能是副作用引用)
    return `import '${relativePath}';`;
  }

  /**
   * 替换当前编辑器光标所在行的内容
   */
  private async replaceCurrentImportLine(newText: string) {
    // 调用刚才新增的方法
    const { editor, cursorPos } = this.editorService.getActiveEditorInfo();

    // 安全检查：如果没有编辑器或光标位置，直接返回
    if (!editor || !cursorPos) {
      console.warn('No active editor or cursor position found.');
      return;
    }

    // 获取当前行的 Range
    const lineRange = editor.document.lineAt(cursorPos.line).range;

    // 执行编辑：替换整行
    await editor.edit((editBuilder: vscode.TextEditorEdit) => {
      editBuilder.replace(lineRange, newText);
    });

    // 调整光标位置
    if (newText.includes('{  }')) {
      // 如果是命名导出，将光标移动到括号中间
      // newText 类似于 "import {  } from '...';"
      const braceIndex = newText.indexOf('{');
      // 移动到 "{  " 的两个空格中间
      const newPos = new vscode.Position(cursorPos.line, braceIndex + 2);
      editor.selection = new vscode.Selection(newPos, newPos);
    } else {
      // 否则移动到行尾
      const newPos = new vscode.Position(cursorPos.line, newText.length);
      editor.selection = new vscode.Selection(newPos, newPos);
    }
  }

  /**
   * 提供命名导出的补全列表
   */
  private provideExportCompletion(document: vscode.TextDocument) {
    // 过滤掉已经手动选中的
    const availableNamed = this.state.namedExports.filter((n) => !this.state.selectedExports.includes(n));

    const items: vscode.CompletionItem[] = [];

    // 命名导出建议
    availableNamed.forEach((name) => {
      // 这里的 Kind 也可以根据 AST 解析结果动态调整 (Variable, Class 等)，Function 是比较通用的
      const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Value);

      // 【修改点1】：使用 "!" 确保排在 Snippets（通常是 "snippet" 或 "0"）前面
      item.sortText = '!';

      item.insertText = name;

      // 【修改点2】：强制预选中。当列表出现时，默认选中这一项，而不是下面的 snippet
      item.preselect = true;

      item.detail = '(Auto Import)'; // 加个小描述让它看起来更正式

      item.command = { command: 'quick-ops.onFuncSelected', title: '', arguments: [name] };
      items.push(item);
    });

    // 默认导出建议
    if (this.state.defaultExport.length > 0) {
      const defName = this.state.defaultExport[0] === 'default' ? 'DefaultExport' : this.state.defaultExport[0];
      const item = new vscode.CompletionItem(defName, vscode.CompletionItemKind.Variable);

      item.detail = '(Default Export)';

      // 同样确保排在最前
      item.sortText = '!';
      item.preselect = true;

      items.push(item);
    }

    return items;
  }

  private resolveExportCompletion(item: vscode.CompletionItem) {
    return item;
  }

  private handleFuncSelected(name: string) {
    this.state.selectedExports.push(name);
  }
}
