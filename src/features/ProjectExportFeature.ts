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
  selectedExports: string[];
}

export class ProjectExportFeature implements IFeature {
  public readonly id = 'ProjectExportFeature';

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

    // 1. 【关键】注册触发字符：'.' (支持 ./ ../), '"', "'"
    const pathProvider = vscode.languages.registerCompletionItemProvider(selector, { provideCompletionItems: this.providePathCompletion.bind(this) }, '/', '.', '"', "'");

    // 2. 注册函数补全
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

    const cmdPath = vscode.commands.registerCommand('quick-ops.onPathSelected', this.handlePathSelected.bind(this));
    const cmdFunc = vscode.commands.registerCommand('quick-ops.onFuncSelected', this.handleFuncSelected.bind(this));

    context.subscriptions.push(pathProvider, funcProvider, cmdPath, cmdFunc);
    console.log(`[${this.id}] Activated.`);
  }

  /**
   * 提供路径补全建议
   */
  private async providePathCompletion(document: vscode.TextDocument, position: vscode.Position) {
    const linePrefix = document.lineAt(position).text.substring(0, position.character);

    // 【核心正则】：匹配行首(允许空格)开始的路径，前面不能有任何其他字符
    // Group 1: 可选的引号 (['"]?)
    // Group 2: 具体的路径，必须以 ./ 或 ../ 开头 (\.{1,2}[\\/])
    const match = linePrefix.match(/^\s*(['"]?)(\.{1,2}[\\/][^'"]*)$/);

    if (!match) return [];

    const currentFilePath = document.uri.fsPath;
    const currentDir = path.dirname(currentFilePath);

    // 获取用户输入的路径部分 (例如 "./utils/")
    // 即使没输引号，match[2] 也能拿到路径
    const enteredPath = match[2];

    // 获取文件列表
    // 注意：这里传给 resolveImportDir 的 lineText 最好是模拟一个合法的 import 路径，或者确保 PathHelper 能处理裸路径
    // 如果 PathHelper 比较脆弱，可以直接用 enteredPath 算绝对路径，然后用 fs.readdir 读（假设 PathHelper 已经封装好了，这里继续调用它）
    const entries = await PathHelper.resolveImportDir(currentFilePath, document.lineAt(position).text);

    // 【关键步骤】计算目标的“绝对路径” (用于 AST 解析)
    const targetDirAbsolutePath = path.resolve(currentDir, enteredPath);

    // 【关键步骤】计算标准的“相对路径前缀” (用于生成 import 语句)
    // 这样无论用户输入的是 " ./utils" 还是 "../utils"，我们都基于物理路径重新算一遍标准的相对路径
    let relativeBase = path.relative(currentDir, targetDirAbsolutePath).split(path.sep).join('/');

    // 补齐 ./ 前缀
    if (!relativeBase.startsWith('.') && !relativeBase.startsWith('/')) {
      relativeBase = relativeBase === '' ? '.' : './' + relativeBase;
    }

    return entries.map((entry) => {
      const isDir = entry.isDirectory();
      const item = new vscode.CompletionItem(entry.name, isDir ? vscode.CompletionItemKind.Folder : vscode.CompletionItemKind.File);
      item.insertText = entry.name;
      item.sortText = isDir ? '0' : '1';

      if (!isDir) {
        item.command = {
          command: 'quick-ops.onPathSelected',
          title: 'Path Selected',
          arguments: [
            {
              fileName: entry.name,
              // 传绝对路径给 AST 解析用
              parentPath: targetDirAbsolutePath,
              // 传相对路径前缀给 Import 生成用
              importBase: relativeBase,
              isDirectory: isDir,
            },
          ],
        };
      }
      return item;
    });
  }

  /**
   * 处理路径选中
   */
  private async handlePathSelected(args: { fileName: string; parentPath: string; importBase: string; isDirectory: boolean }) {
    if (args.isDirectory) return;

    // 1. AST 解析 (使用绝对路径)
    const fullPath = path.join(args.parentPath, args.fileName);
    console.log('Full Path to Parse:', fullPath);

    let exports: { namedExports: string[]; defaultExport: string[] } = {
      namedExports: [],
      defaultExport: [],
    };

    let vueName: string | null = null;

    try {
      // 现在赋值就不会报错了，因为类型匹配
      exports = AstParser.parseExports(fullPath);
      vueName = AstParser.parseVueComponentName(fullPath);
    } catch (e) {
      console.error('AST Parse Failed:', e);
    }

    if (fullPath.endsWith('.vue') && vueName) {
      // 这里赋值也不会报错了，因为 defaultExport 被定义为 string[]
      exports.defaultExport = [vueName];
    }

    this.state = {
      namedExports: exports.namedExports,
      defaultExport: exports.defaultExport,
      selectedExports: [],
    };

    // 2. 拼接最终 Import 路径
    // 使用传入的基准路径 + 文件名
    let finalPath = path.posix.join(args.importBase, args.fileName);

    // 移除扩展名
    finalPath = finalPath.replace(/\.(ts|js|vue|tsx|jsx|d\.ts)$/, '');

    // 确保 ./ 开头
    if (!finalPath.startsWith('.') && !finalPath.startsWith('/')) {
      finalPath = './' + finalPath;
    }

    // 3. 生成语句并替换
    const importStmt = this.generateImportStatement(finalPath, exports);

    await this.replaceCurrentImportLine(importStmt);

    // 4. 如果是命名导出，触发建议供用户选择
    if (importStmt.includes('{  }')) {
      setTimeout(() => vscode.commands.executeCommand('editor.action.triggerSuggest'), 50);
    }
  }

  private generateImportStatement(relativePath: string, exports: { namedExports: string[]; defaultExport: string[] }): string {
    if (exports.defaultExport.length > 0) {
      return `import ${exports.defaultExport[0]} from '${relativePath}';`;
    } else if (exports.namedExports.length > 0) {
      return `import {  } from '${relativePath}';`;
    }
    return `import '${relativePath}';`;
  }

  private async replaceCurrentImportLine(newText: string) {
    const { editor, cursorPos } = this.editorService.getActiveEditorInfo();
    if (!editor || !cursorPos) return;

    const lineRange = editor.document.lineAt(cursorPos.line).range;
    await editor.edit((editBuilder: vscode.TextEditorEdit) => {
      editBuilder.replace(lineRange, newText);
    });

    // 移动光标
    if (newText.includes('{  }')) {
      const braceIndex = newText.indexOf('{');
      const newPos = new vscode.Position(cursorPos.line, braceIndex + 2);
      editor.selection = new vscode.Selection(newPos, newPos);
    } else {
      const newPos = new vscode.Position(cursorPos.line, newText.length);
      editor.selection = new vscode.Selection(newPos, newPos);
    }
  }

  // ... export completion 保持不变 ...
  private provideExportCompletion(document: vscode.TextDocument) {
    const availableNamed = this.state.namedExports.filter((n) => !this.state.selectedExports.includes(n));
    const items: vscode.CompletionItem[] = [];

    availableNamed.forEach((name) => {
      const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Value);
      item.sortText = '!';
      item.insertText = name;
      item.preselect = true;
      item.detail = '(Auto Import)';
      item.command = { command: 'quick-ops.onFuncSelected', title: '', arguments: [name] };
      items.push(item);
    });

    if (this.state.defaultExport.length > 0) {
      const defName = this.state.defaultExport[0] === 'default' ? 'DefaultExport' : this.state.defaultExport[0];
      const item = new vscode.CompletionItem(defName, vscode.CompletionItemKind.Variable);
      item.detail = '(Default Export)';
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
