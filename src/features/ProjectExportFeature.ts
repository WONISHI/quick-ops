import * as vscode from 'vscode';
import * as path from 'path'; // 路径字符串处理仍需 path
import { isFunction } from 'lodash-es';
import { TextDecoder } from 'util';
import { IFeature } from '../core/interfaces/IFeature';
import { ConfigurationService } from '../services/ConfigurationService';
import { EditorContextService } from '../services/EditorContextService';
import { PathHelper } from '../utils/PathHelper';
import { AstParser } from '../utils/AstParser';
import type { ExportState, ParseResult } from '../core/types/export';
import ColorLog from '../utils/ColorLog';

export class ProjectExportFeature implements IFeature {
  public readonly id = 'ProjectExportFeature';

  private state: ExportState = {
    namedExports: [],
    defaultExport: [],
    selectedExports: [],
  };

  constructor(
    private configService: ConfigurationService = ConfigurationService.getInstance(),
    private editorService: EditorContextService = EditorContextService.getInstance(),
  ) {}

  public activate(context: vscode.ExtensionContext): void {
    const selector: vscode.DocumentSelector = ['javascript', 'typescript', 'vue', 'javascriptreact', 'typescriptreact'];

    const triggers = ['/', '.', '"', "'", '@', '~'];
    const pathProvider = vscode.languages.registerCompletionItemProvider(selector, { provideCompletionItems: this.providePathCompletion.bind(this) }, ...triggers);

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
    ColorLog.black(`[${this.id}]`, 'Activated.');
  }

  private getAliasConfig(): Record<string, string> {
    const config = this.configService.config;
    const projectConfig = config?.project || {};
    return projectConfig.alias || { '@/': './src/' };
  }

  // --- 路径补全逻辑 (完全重构为 Uri 操作) ---
  private async providePathCompletion(document: vscode.TextDocument, position: vscode.Position) {
    const linePrefix = document.lineAt(position).text.substring(0, position.character);
    const match = linePrefix.match(/^\s*(['"]?)([^'"]*)$/);

    if (!match) return [];

    const currentDocUri = document.uri;
    const enteredPath = match[2];

    let targetDirUri: vscode.Uri | null = null;
    let importBase = '';
    let entries: { name: string; isDirectory: () => boolean }[] = [];

    const aliases = this.getAliasConfig();
    const aliasKeys = Object.keys(aliases);

    // 查找匹配的别名
    const matchedAliasKey = aliasKeys.sort((a, b) => b.length - a.length).find((key) => enteredPath.startsWith(key));

    // === 分支 A: 别名路径处理 ===
    if (matchedAliasKey) {
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(currentDocUri);
      if (!workspaceFolder) return [];
      const rootUri = workspaceFolder.uri;

      const aliasValue = aliases[matchedAliasKey];
      // 计算别名指向的物理根目录 Uri
      const aliasRootUri = vscode.Uri.joinPath(rootUri, aliasValue);

      const remainingPath = enteredPath.slice(matchedAliasKey.length);

      // 拼接目标目录 Uri
      targetDirUri = vscode.Uri.joinPath(aliasRootUri, remainingPath);

      // 检查是否为目录，若不是或者是文件的一半，退回父目录
      try {
        const stats = await vscode.workspace.fs.stat(targetDirUri);
        if ((stats.type & vscode.FileType.Directory) === 0) {
          // 如果不是目录，说明可能是在输入文件名，需要列出父目录内容
          targetDirUri = vscode.Uri.joinPath(targetDirUri, '..');
        }
      } catch (e) {
        // 路径不存在，说明正在输入中，退回父目录查找
        targetDirUri = vscode.Uri.joinPath(targetDirUri, '..');
      }

      // 计算 importBase (用于最终生成 import 语句)
      // 由于 aliasRootUri 和 targetDirUri 都是 Uri，需要计算相对路径字符串
      // 这里用 path.posix.relative 来处理 Uri.path 字符串是安全的，因为 Uri.path 总是 posix
      const relativeFromAliasRoot = path.posix.relative(aliasRootUri.path, targetDirUri.path);

      importBase = path.posix.join(matchedAliasKey, relativeFromAliasRoot);

      if (matchedAliasKey.endsWith('/') && !importBase.endsWith('/') && relativeFromAliasRoot === '') {
        importBase = matchedAliasKey;
      }
    }
    // === 分支 B: 相对路径处理 ===
    else if (enteredPath.startsWith('.') || enteredPath.startsWith('/')) {
      // 这里的 PathHelper.resolveImportDir 如果还在用 fs，建议也改造
      // 为了简单起见，这里假设我们只处理相对路径补全

      const currentDirUri = vscode.Uri.joinPath(currentDocUri, '..');
      // 这里的 resolve 需要处理 ./ ../
      targetDirUri = vscode.Uri.joinPath(currentDirUri, enteredPath);

      // 同样做回退检查
      try {
        const stats = await vscode.workspace.fs.stat(targetDirUri);
        if ((stats.type & vscode.FileType.Directory) === 0) {
          targetDirUri = vscode.Uri.joinPath(targetDirUri, '..');
        }
      } catch {
        targetDirUri = vscode.Uri.joinPath(targetDirUri, '..');
      }

      const relativeBaseStr = path.posix.relative(currentDirUri.path, targetDirUri.path);
      importBase = relativeBaseStr === '' ? '.' : relativeBaseStr.startsWith('.') ? relativeBaseStr : './' + relativeBaseStr;
    } else {
      return [];
    }

    // === 读取目录 ===
    if (targetDirUri) {
      try {
        const dirents = await vscode.workspace.fs.readDirectory(targetDirUri);
        entries = dirents.map(([name, type]) => ({
          name,
          isDirectory: () => (type & vscode.FileType.Directory) !== 0,
        }));
      } catch (e) {
        return [];
      }
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
              parentPathUri: targetDirUri!.toString(), // 传 Uri 字符串
              importBase: importBase,
              isDirectory: isDir,
            },
          ],
        };
      }
      return item;
    });
  }

  // --- 路径选中处理逻辑 ---
  private async handlePathSelected(args: { fileName: string; parentPathUri: string; importBase: string; isDirectory: boolean }) {
    if (args.isDirectory) return;

    const parentUri = vscode.Uri.parse(args.parentPathUri);
    const fullUri = vscode.Uri.joinPath(parentUri, args.fileName);

    let parseResult: ParseResult = { namedExports: [], defaultExport: [] };
    let vueName: string | null = null;

    try {
      // 核心优化：先读取内容，再解析。避免 AstParser 内部使用 fs
      // 如果 AstParser 还没支持传内容，你需要修改 AstParser
      // 假设 AstParser.parseExportsFromContent(content) 存在

      const contentBytes = await vscode.workspace.fs.readFile(fullUri);
      const content = new TextDecoder('utf-8').decode(contentBytes);

      // 注意：这里需要你修改 AstParser，增加 parseExportsFromContent 方法
      // 如果不想改 AstParser，这里只能用蹩脚的方法，但不支持远程
      parseResult = AstParser.parseExports(fullUri.fsPath, content);
      vueName = AstParser.parseVueComponentName(fullUri.fsPath, content);
    } catch (e) {
      console.error('AST Parse Failed:', e);
    }

    if (args.fileName.endsWith('.vue')) {
      if (!vueName) {
        // ... Vue 命名逻辑保持不变，纯字符串处理 ...
        const ext = path.posix.extname(args.fileName);
        const baseName = path.posix.basename(args.fileName, ext);
        let rawName = baseName.toLowerCase() === 'index' ? path.posix.basename(parentUri.path) : baseName;

        if (rawName) {
          vueName = rawName.replace(/[-_]+(\w)/g, (_, c) => c.toUpperCase()).replace(/^[a-z]/, (c) => c.toUpperCase());
        }
      }

      if (vueName) {
        parseResult.defaultExport = [vueName];
      }
    }

    this.state = {
      namedExports: parseResult.namedExports,
      defaultExport: parseResult.defaultExport,
      selectedExports: [],
    };

    // 生成 import 路径
    let finalPath = path.posix.join(args.importBase, args.fileName);
    finalPath = finalPath.replace(/\.(ts|js|vue|tsx|jsx|d\.ts)$/, '');

    const aliases = this.getAliasConfig();
    const isAliasPath = Object.keys(aliases).some((aliasKey) => finalPath.startsWith(aliasKey));

    if (!isAliasPath && !finalPath.startsWith('.') && !finalPath.startsWith('/')) {
      finalPath = './' + finalPath;
    }

    const importStmt = this.generateImportStatement(finalPath, parseResult);
    await this.replaceCurrentImportLine(importStmt);

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

  // --- 导出函数补全逻辑 (保持不变) ---
  private provideExportCompletion(document: vscode.TextDocument) {
    const availableNamed = this.state.namedExports.filter((item) => !this.state.selectedExports.includes(item.name));
    const items: vscode.CompletionItem[] = [];

    availableNamed.forEach((exportItem) => {
      const logItemObj: vscode.CompletionItemLabel = {
        label: exportItem.name,
        description: `quick-ops`,
      };

      const item = new vscode.CompletionItem(logItemObj, vscode.CompletionItemKind.Function);
      item.sortText = '!';
      item.insertText = exportItem.name;
      item.preselect = true;
      item.detail = 'Auto Import';

      if (exportItem.code) {
        const markdown = new vscode.MarkdownString();
        markdown.appendCodeblock(exportItem.code, 'typescript');
        item.documentation = markdown;
      }

      item.command = { command: 'quick-ops.onFuncSelected', title: '', arguments: [exportItem.name] };
      items.push(item);
    });

    if (this.state.defaultExport.length > 0) {
      const defName = this.state.defaultExport[0];
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
