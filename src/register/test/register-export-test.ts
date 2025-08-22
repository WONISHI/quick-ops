import * as vscode from 'vscode';
import { properties } from '../../global-object/properties';
import { setExportGlobalVariables, exportGlobalVariables, type ExportGlobalVariables } from '../../global-object/export-global';
import { resolveImportDir, getAbsolutePath, joinPaths, removeSurroundingQuotes, replaceCurrentPath, isCursorInsideBraces } from '../../utils/index';
import { parseExports, type ExportResult } from '../../utils/parse';
import type { FileType } from '../../types/utils';

const LANGUAGES: vscode.DocumentSelector = ['javascript', 'javascriptreact', 'typescript', 'typescriptreact', 'vue'];
const defaultExportFileType: FileType[] = ['vue', 'jsx', 'tsx', 'css', 'less', 'scss'];

// 缓存当前导出信息
let currentExport: ExportGlobalVariables | null = null;

// 设置 Provider 参数
function setProviderParams({ item, entry, lineText, isDirectory }: any) {
  return [{ fileEntry: { ...item, ...entry }, isDirectory, lineText }];
}

// 生成 import 语句
function generateImport(relativePath: string, exportInfo: ExportResult) {
  if (exportInfo.defaultExport.length) {
    return `import \${1} from '${relativePath}';`;
  }
  return `import { \${1} } from '${relativePath}';`;
}

// 路径补全 Provider
function createPathCompletionProvider() {
  return vscode.languages.registerCompletionItemProvider(
    LANGUAGES,
    {
      async provideCompletionItems(document, position) {
        const lineText = document.lineAt(position).text;
        const entries = await resolveImportDir(properties.fullPath, lineText);
        const items: vscode.CompletionItem[] = [];

        for (const entry of entries.flat(Infinity)) {
          const item = new vscode.CompletionItem(entry.name);
          item.kind = entry.isDirectory() ? vscode.CompletionItemKind.Folder : vscode.CompletionItemKind.File;
          item.insertText = entry.isDirectory() ? entry.name + '/' : entry.name;
          item.command = {
            command: 'scope-search.onProvideSelected',
            title: '触发路径补全',
            arguments: setProviderParams({ item, entry, isDirectory: entry.isDirectory(), lineText }),
          };
          items.push(item);
        }

        return items;
      },
    },
    '/',
  );
}

// 函数补全 Provider
function createFunctionCompletionProvider() {
  return vscode.languages.registerCompletionItemProvider(
    LANGUAGES,
    {
      provideCompletionItems() {
        if (!currentExport) return [];

        const items: vscode.CompletionItem[] = [];
        const insideBraces = isCursorInsideBraces();

        // 优先显示命名导出
        if (insideBraces && currentExport.namedExports.length) {
          for (const name of currentExport.namedExports) {
            const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Function);
            item.sortText = '0000';
            item.preselect = true;
            item.insertText = name;
            item.command = { command: 'scope-search.onFunctionProvideSelected', title: '触发函数补全', arguments: [name] };
            items.push(item);
          }
        }

        // 默认导出
        if (!insideBraces && currentExport.defaultExport.length) {
          const def = currentExport.defaultExport[0];
          const defItem = new vscode.CompletionItem(def, vscode.CompletionItemKind.Variable);
          defItem.sortText = '0000';
          defItem.preselect = true;
          defItem.insertText = def;
          defItem.command = { command: 'scope-search.onFunctionProvideSelected', title: '触发函数补全', arguments: [def] };
          items.push(defItem);
        }

        return items;
      },
    },
    '{', ' ', ',',
  );
}

// 注册 Export 插件
export function registerExport(context: vscode.ExtensionContext) {
  // 注册路径补全命令
  const disposablePath = vscode.commands.registerCommand('scope-search.onProvideSelected', async (contextItem: any) => {
    if (!contextItem) return;
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    if (contextItem.isDirectory) {
      await vscode.commands.executeCommand('editor.action.triggerSuggest');
      return;
    }

    const filePath = getAbsolutePath(contextItem.fileEntry.parentPath, contextItem.fileEntry.name);
    const importPathString = joinPaths(removeSurroundingQuotes(contextItem.lineText), contextItem.fileEntry.name);
    const exportNames: ExportResult = parseExports(filePath);

    if (!defaultExportFileType.includes(properties.fileType as FileType)) {
      await replaceCurrentPath(generateImport(importPathString, exportNames));

      // 更新全局变量
      setExportGlobalVariables({
        isDefaultName: !!exportNames.defaultExport.length,
        isName: !!exportNames.namedExports.length,
        ...exportNames,
      });
      currentExport = exportGlobalVariables;

      // 延迟触发补全
      setTimeout(() => vscode.commands.executeCommand('editor.action.triggerSuggest'), 50);
    }
  });

  // 注册函数补全点击命令
  const disposableFunc = vscode.commands.registerCommand('scope-search.onFunctionProvideSelected', async (name: string) => {
    if (!currentExport) return;
    if (!currentExport.selectExports.includes(name)) {
      setExportGlobalVariables({ selectExports: [...exportGlobalVariables.selectExports, name] });
    }
  });

  // 注册 Providers
  const pathProvider = createPathCompletionProvider();
  const funcProvider = createFunctionCompletionProvider();

  context.subscriptions.push(pathProvider, funcProvider, disposablePath, disposableFunc);
}
