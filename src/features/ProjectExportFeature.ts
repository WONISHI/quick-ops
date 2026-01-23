import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { IFeature } from '../core/interfaces/IFeature';
import { ConfigurationService } from '../services/ConfigurationService';
import { EditorContextService } from '../services/EditorContextService';
import { PathHelper } from '../utils/PathHelper';
import { AstParser, ExportItem, ParseResult } from '../utils/AstParser';

interface ExportState {
  namedExports: ExportItem[];
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
    private configService: ConfigurationService = ConfigurationService.getInstance(),
    private editorService: EditorContextService = EditorContextService.getInstance(),
  ) {}

  public activate(context: vscode.ExtensionContext): void {
    const selector: vscode.DocumentSelector = ['javascript', 'typescript', 'vue', 'javascriptreact', 'typescriptreact'];

    // 注册触发字符：包含常见路径字符和别名首字符 (@, ~)
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
    console.log(`[${this.id}] Activated.`);
  }

  /**
   * 获取项目别名配置
   */
  private getAliasConfig(): Record<string, string> {
    const config = this.configService.config;
    const projectConfig = config?.project || {};
    return projectConfig.alias || { '@/': './src/' };
  }

  // --- 路径补全逻辑 ---
  private async providePathCompletion(document: vscode.TextDocument, position: vscode.Position) {
    const linePrefix = document.lineAt(position).text.substring(0, position.character);
    // 宽容正则：只要在引号内，就尝试匹配
    const match = linePrefix.match(/^\s*(['"]?)([^'"]*)$/);

    if (!match) return [];

    const currentFilePath = document.uri.fsPath;
    const currentDir = path.dirname(currentFilePath);
    const enteredPath = match[2]; // 用户输入的内容，如 "@/components/CommonTable/in"

    let targetDirAbsolutePath = '';
    let importBase = '';
    let entries: { name: string; isDirectory: () => boolean }[] = [];

    const aliases = this.getAliasConfig();
    const aliasKeys = Object.keys(aliases);

    // 查找匹配的别名 (长匹配优先)
    const matchedAliasKey = aliasKeys.sort((a, b) => b.length - a.length).find((key) => enteredPath.startsWith(key));

    // === 分支 A: 别名路径处理 ===
    if (matchedAliasKey) {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders) return [];
      const rootPath = workspaceFolders[0].uri.fsPath;

      const aliasValue = aliases[matchedAliasKey];
      const aliasRootAbsPath = path.resolve(rootPath, aliasValue); // 别名指向的物理根目录 (e.g. .../src)
      const remainingPath = enteredPath.slice(matchedAliasKey.length); // 除去别名后的部分 (e.g. components/CommonTable/in)

      // 计算目标目录的绝对路径
      // 这里直接拼接，不使用 dirname，因为可能用户正在输入文件夹名
      targetDirAbsolutePath = path.join(aliasRootAbsPath, remainingPath);

      // 容错：如果路径不存在(可能文件名没输完)，回退到父目录去读取列表
      if (!fs.existsSync(targetDirAbsolutePath) || !fs.statSync(targetDirAbsolutePath).isDirectory()) {
        targetDirAbsolutePath = path.dirname(targetDirAbsolutePath);
      }

      // 【核心修复 1】计算 importBase
      // 这里的逻辑是：算出 "当前展示列表的物理目录" 相对于 "别名物理根目录" 的路径
      // 例如：aliasRoot = /src, targetDir = /src/components/CommonTable
      // relative = components/CommonTable
      const relativeFromAliasRoot = path.relative(aliasRootAbsPath, targetDirAbsolutePath).split(path.sep).join('/');

      // 拼接别名 Key 和 相对路径
      // importBase = @/ + components/CommonTable -> @/components/CommonTable
      importBase = path.posix.join(matchedAliasKey, relativeFromAliasRoot);

      // 特殊处理：如果 relative 为空 (就在 src 根目录下)，且别名带斜杠 (@/)，join 可能会把斜杠吃掉变成 @
      if (matchedAliasKey.endsWith('/') && !importBase.endsWith('/') && relativeFromAliasRoot === '') {
        importBase = matchedAliasKey;
      }

      // 读取目录列表
      try {
        if (fs.existsSync(targetDirAbsolutePath)) {
          const dirents = fs.readdirSync(targetDirAbsolutePath, { withFileTypes: true });
          entries = dirents.map((d) => ({
            name: d.name,
            isDirectory: () => d.isDirectory(),
          }));
        }
      } catch (e) {
        return [];
      }
    }
    // === 分支 B: 相对路径处理 ===
    else if (enteredPath.startsWith('.') || enteredPath.startsWith('/')) {
      entries = (await PathHelper.resolveImportDir(currentFilePath, document.lineAt(position).text)) as any;
      targetDirAbsolutePath = path.resolve(currentDir, enteredPath);

      let relativeBaseStr = path.relative(currentDir, targetDirAbsolutePath).split(path.sep).join('/');
      if (!relativeBaseStr.startsWith('.') && !relativeBaseStr.startsWith('/')) {
        relativeBaseStr = relativeBaseStr === '' ? '.' : './' + relativeBaseStr;
      }
      importBase = relativeBaseStr;
    } else {
      return [];
    }

    return entries.map((entry) => {
      const isDir = typeof entry.isDirectory === 'function' ? entry.isDirectory() : (entry as any).isDirectory;

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
              parentPath: targetDirAbsolutePath,
              importBase: importBase, // 传入计算好的 Base
              isDirectory: isDir,
            },
          ],
        };
      }
      return item;
    });
  }

  // --- 路径选中处理逻辑 ---
  private async handlePathSelected(args: { fileName: string; parentPath: string; importBase: string; isDirectory: boolean }) {
    if (args.isDirectory) return;

    const fullPath = path.join(args.parentPath, args.fileName);

    let parseResult: ParseResult = { namedExports: [], defaultExport: [] };
    let vueName: string | null = null;

    try {
      parseResult = AstParser.parseExports(fullPath);
      vueName = AstParser.parseVueComponentName(fullPath);
    } catch (e) {
      console.error('AST Parse Failed:', e);
    }

    // 【核心修复 2】Vue 组件名兜底逻辑
    if (fullPath.endsWith('.vue')) {
      // 如果 AST 解析不到 name (如 script setup 中未显式定义 name)
      if (!vueName) {
        // 获取文件名 (不含后缀)
        const ext = path.extname(args.fileName);
        const baseName = path.basename(args.fileName, ext);

        // 如果文件名是 index，则取其父目录名
        if (baseName.toLowerCase() === 'index') {
          // parentPath 已经是该文件的绝对父目录路径，直接取 basename 即可
          vueName = path.basename(args.parentPath);
        } else {
          vueName = baseName;
        }

        // 强制转换为大驼峰 (PascalCase): my-cmp -> MyCmp (简单处理首字母大写，可按需加更复杂的转换)
        if (vueName) {
          // 简单的首字母大写，如果需要处理横杠连接符，可以加 replace 逻辑
          vueName = vueName.charAt(0).toUpperCase() + vueName.slice(1);
        }
      }

      // 只有当解析出 vueName 时，才覆盖 defaultExport
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
    // 移除常见后缀
    finalPath = finalPath.replace(/\.(ts|js|vue|tsx|jsx|d\.ts)$/, '');

    // 检查是否是别名路径，如果是则不加 ./
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

  // --- 导出函数补全逻辑 ---
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
      const defName = this.state.defaultExport[0]; // 这里不需要判空，因为上一步 handlePathSelected 保证了如果能取到名字就会放进去
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
