import * as vscode from 'vscode';
import * as path from 'path';
import { IFeature } from '../core/interfaces/IFeature';
import { WorkspaceStateService } from '../services/WorkspaceStateService';
import { EditorContextService } from '../services/EditorContextService';
import { PathHelper } from '../utils/PathHelper';
// 引入新的接口和解析器
import { AstParser, ExportItem, ParseResult } from '../utils/AstParser';

// 1. 更新 State 接口，使用 ExportItem[]
interface ExportState {
  namedExports: ExportItem[];
  defaultExport: string[];
  selectedExports: string[];
}

export class ProjectExportFeature implements IFeature {
  public readonly id = 'ProjectExportFeature';

  // 2. 初始化 State
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

    // 路径补全注册
    const pathProvider = vscode.languages.registerCompletionItemProvider(selector, { provideCompletionItems: this.providePathCompletion.bind(this) }, '/', '.', '"', "'");

    // 函数导出补全注册
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

  // --- 路径补全逻辑 (保持之前优化的版本) ---
  private async providePathCompletion(document: vscode.TextDocument, position: vscode.Position) {
    const linePrefix = document.lineAt(position).text.substring(0, position.character);
    const match = linePrefix.match(/^\s*(['"]?)(\.{1,2}[\\/][^'"]*)$/);

    if (!match) return [];

    const currentFilePath = document.uri.fsPath;
    const currentDir = path.dirname(currentFilePath);
    const enteredPath = match[2];

    const entries = await PathHelper.resolveImportDir(currentFilePath, document.lineAt(position).text);
    const targetDirAbsolutePath = path.resolve(currentDir, enteredPath);

    let relativeBase = path.relative(currentDir, targetDirAbsolutePath).split(path.sep).join('/');
    if (!relativeBase.startsWith('.') && !relativeBase.startsWith('/')) {
      relativeBase = relativeBase === '' ? '.' : './' + relativeBase;
    }

    return entries.map((entry) => {
      const isDir = entry.isDirectory();
      const logItemObj: vscode.CompletionItemLabel = {
        label: entry.name,
        description: `quick-ops/${entry.name}`,
      };
      const item = new vscode.CompletionItem(logItemObj, isDir ? vscode.CompletionItemKind.Folder : vscode.CompletionItemKind.File);
      item.insertText = entry.name;
      item.sortText = isDir ? '0' : '1';

      if (!isDir) {
        item.command = {
          command: 'quick-ops.onPathSelected',
          title: 'Path Selected',
          arguments: [
            {
              fileName: entry.name,
              parentPath: targetDirAbsolutePath,
              importBase: relativeBase,
              isDirectory: isDir,
            },
          ],
        };
      }
      return item;
    });
  }

  // --- 路径选中处理逻辑 (解析 AST 并存储源码) ---
  private async handlePathSelected(args: { fileName: string; parentPath: string; importBase: string; isDirectory: boolean }) {
    if (args.isDirectory) return;

    const fullPath = path.join(args.parentPath, args.fileName);

    // 初始化解析结果
    let parseResult: ParseResult = { namedExports: [], defaultExport: [] };
    let vueName: string | null = null;

    try {
      // 解析文件，获取包含源码的 ExportItem[]
      parseResult = AstParser.parseExports(fullPath);
      vueName = AstParser.parseVueComponentName(fullPath);
    } catch (e) {
      console.error('AST Parse Failed:', e);
    }

    if (fullPath.endsWith('.vue') && vueName) {
      parseResult.defaultExport = [vueName];
    }

    // 更新状态
    this.state = {
      namedExports: parseResult.namedExports,
      defaultExport: parseResult.defaultExport,
      selectedExports: [],
    };

    // 生成 import 路径
    let finalPath = path.posix.join(args.importBase, args.fileName);
    finalPath = finalPath.replace(/\.(ts|js|vue|tsx|jsx|d\.ts)$/, '');
    if (!finalPath.startsWith('.') && !finalPath.startsWith('/')) {
      finalPath = './' + finalPath;
    }

    const importStmt = this.generateImportStatement(finalPath, parseResult);
    await this.replaceCurrentImportLine(importStmt);

    // 触发建议
    if (importStmt.includes('{  }')) {
      setTimeout(() => vscode.commands.executeCommand('editor.action.triggerSuggest'), 50);
    }
  }

  private generateImportStatement(relativePath: string, exports: ParseResult): string {
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
    await editor.edit((edit) => edit.replace(lineRange, newText));

    if (newText.includes('{  }')) {
      const braceIndex = newText.indexOf('{');
      const newPos = new vscode.Position(cursorPos.line, braceIndex + 2);
      editor.selection = new vscode.Selection(newPos, newPos);
    } else {
      const newPos = new vscode.Position(cursorPos.line, newText.length);
      editor.selection = new vscode.Selection(newPos, newPos);
    }
  }

  // --- 导出函数补全逻辑 (添加文档预览) ---
  private provideExportCompletion(document: vscode.TextDocument) {
    // 过滤掉已经选中的
    const availableNamed = this.state.namedExports.filter((item) => !this.state.selectedExports.includes(item.name));

    const items: vscode.CompletionItem[] = [];

    availableNamed.forEach((exportItem) => {
      const logItemObj: vscode.CompletionItemLabel = {
        label: exportItem.name,
        description: `quick-ops/${exportItem.name}`,
      };

      const item = new vscode.CompletionItem(logItemObj, vscode.CompletionItemKind.Function);

      item.sortText = '!'; // 确保排在最前
      item.insertText = exportItem.name;
      item.preselect = true;
      item.detail = 'quick-ops自动导入：';

      // 【关键】添加代码预览
      if (exportItem.code) {
        const markdown = new vscode.MarkdownString();
        // 指定代码块语言为 typescript，以获得正确的语法高亮
        markdown.appendCodeblock(exportItem.code, 'typescript');
        item.documentation = markdown;
      }

      item.command = { command: 'quick-ops.onFuncSelected', title: '', arguments: [exportItem.name] };
      items.push(item);
    });

    // 默认导出建议 (保持不变)
    if (this.state.defaultExport.length > 0) {
      const defName = this.state.defaultExport[0] === 'default' ? 'DefaultExport' : this.state.defaultExport[0];
      const logItemObj: vscode.CompletionItemLabel = {
        label: defName,
        description: `quick-ops/${defName}`,
      };

      const item = new vscode.CompletionItem(logItemObj, vscode.CompletionItemKind.Variable);
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
