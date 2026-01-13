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

  // 内部状态，完全替代原 export-global.ts
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
    const pathProvider = vscode.languages.registerCompletionItemProvider(selector, { provideCompletionItems: this.providePathCompletion.bind(this) }, '/');

    // 2. 注册函数/变量导出补全 ('{', ',', ' ')
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

  private async providePathCompletion(document: vscode.TextDocument, position: vscode.Position) {
    const lineText = document.lineAt(position).text;
    const char = document.getText(new vscode.Range(position.translate(0, -1), position));
    if (char !== '/') return [];

    const currentPath = document.uri.fsPath;
    const entries = await PathHelper.resolveImportDir(currentPath, lineText);

    return entries.map((entry) => {
      const isDir = entry.isDirectory();
      const item = new vscode.CompletionItem(entry.name, isDir ? vscode.CompletionItemKind.Folder : vscode.CompletionItemKind.File);
      item.insertText = isDir ? entry.name + '/' : entry.name;
      item.command = {
        command: 'quick-ops.onPathSelected',
        title: 'Path Selected',
        arguments: [
          {
            fileName: entry.name,
            parentPath: path.dirname(PathHelper.getAbsolutePath(path.dirname(currentPath), PathHelper.removeSurroundingQuotes(lineText))),
            isDirectory: isDir,
            lineText,
          },
        ],
      };
      return item;
    });
  }

  private provideExportCompletion(document: vscode.TextDocument) {
    // 过滤掉已经导入的
    const availableNamed = this.state.namedExports.filter((n) => !this.state.selectedExports.includes(n));

    const items: vscode.CompletionItem[] = [];

    // 命名导出
    availableNamed.forEach((name) => {
      const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Function);
      item.sortText = '0';
      item.insertText = name;
      // 选中后更新状态
      item.command = { command: 'quick-ops.onFuncSelected', title: '', arguments: [name] };
      items.push(item);
    });

    // 默认导出
    if (this.state.defaultExport.length > 0) {
      const defName = this.state.defaultExport[0] === 'default' ? 'DefaultExport' : this.state.defaultExport[0];
      const item = new vscode.CompletionItem(defName, vscode.CompletionItemKind.Variable);
      item.detail = '(Default)';
      item.sortText = '0';
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

  private async handlePathSelected(args: { fileName: string; parentPath: string; isDirectory: boolean; lineText: string }) {
    if (args.isDirectory) {
      vscode.commands.executeCommand('editor.action.triggerSuggest');
      return;
    }

    const fullPath = path.join(args.parentPath, args.fileName);

    // 1. 解析 AST 获取导出信息
    let exports = AstParser.parseExports(fullPath);
    const vueName = AstParser.parseVueComponentName(fullPath);

    // 处理 Vue 或默认导出
    if (fullPath.endsWith('.vue') && vueName) {
      exports.defaultExport = [vueName];
    }

    // 2. 更新内部状态
    this.state = {
      namedExports: exports.namedExports,
      defaultExport: exports.defaultExport,
      selectedExports: [],
    };

    // 3. 构造并替换 Import 语句
    const importPath = PathHelper.joinPaths(PathHelper.removeSurroundingQuotes(args.lineText), args.fileName);
    const importStmt = this.generateImportStatement(importPath, exports);

    await this.replaceCurrentImportLine(importStmt);

    // 4. 如果有命名导出，自动触发补全建议
    if (exports.namedExports.length > 0 && exports.defaultExport.length === 0) {
      setTimeout(() => vscode.commands.executeCommand('editor.action.triggerSuggest'), 50);
    }
  }

  private generateImportStatement(relativePath: string, exports: { namedExports: string[]; defaultExport: string[] }): string {
    // 简化的生成逻辑，可根据 exportType 扩展
    if (exports.defaultExport.length > 0) {
      return `import ${exports.defaultExport[0]} from '${relativePath}';`;
    } else if (exports.namedExports.length > 0) {
      return `import {  } from '${relativePath}';`; // 留空给光标补全
    }
    return `import '${relativePath}';`;
  }

  private async replaceCurrentImportLine(newText: string) {
    // @ts-ignore
    const { editor, cursorPos, lineText } = this.editorService.getActiveEditorInfo();

    // 简单的正则匹配引号范围
    const quoteMatch = lineText.match(/['"](.*?)['"]/);
    if (!quoteMatch) return;

    // 替换整行 (通常是 import ... from '...')
    // 这里做一个简单的整行替换演示，实际场景可能只需要替换路径部分或者 {} 之前的部分
    const range = editor.document.lineAt(cursorPos.line).range;
    await editor.edit((editBuilder:any) => {
      editBuilder.replace(range, newText);
    });

    // 移动光标到 { } 中间
    if (newText.includes('{  }')) {
      const braceIndex = newText.indexOf('{');
      const newPos = new vscode.Position(cursorPos.line, braceIndex + 2);
      editor.selection = new vscode.Selection(newPos, newPos);
    }
  }
}
