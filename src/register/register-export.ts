import * as vscode from 'vscode';
import { properties } from '../global-object/properties';
import { setExportGlobalVariables, exportGlobalVariables, type ExportGlobalVariables } from '../global-object/export-global';
import { resolveImportDir, getAbsolutePath, joinPaths, removeSurroundingQuotes, replaceCurrentPath, isCursorInsideBraces } from '../utils/index';
import { parseExports, type ExportResult } from '../utils/parse';

const LANGUAGES: vscode.DocumentSelector = ['javascript', 'javascriptreact', 'typescript', 'typescriptreact', 'vue'];

// 全局保存当前导出信息
let currentExport: ExportGlobalVariables | null = null;

// 设置 Provider 参数
function setProviderParams({ item, entry, lineText, isDirectory }: any) {
  return [{ fileEntry: { ...item, ...entry }, isDirectory, lineText }];
}

// 生成 import 语句
function generateImport(relativePath: string, exportInfo: ExportResult) {
  if (exportInfo.defaultExport.length) {
    return `import \${1} from '${relativePath}';`;
  } else {
    return `import { \${1} } from '${relativePath}';`;
  }
}

// 路径补全 Provider
function createPathCompletionProvider(languages: vscode.DocumentSelector) {
  return vscode.languages.registerCompletionItemProvider(
    languages,
    {
      async provideCompletionItems(document, position) {
        const lineText = document.lineAt(position).text;
        const entries = await resolveImportDir(properties.fullPath, lineText);
        const items: vscode.CompletionItem[] = [];

        for (const entry of entries.flat(Infinity)) {
          const item = new vscode.CompletionItem(entry.name);
          if (entry.isDirectory()) {
            item.kind = vscode.CompletionItemKind.Folder;
            item.insertText = entry.name + '/';
            item.command = {
              command: 'scope-search.onProvideSelected',
              title: '触发路径补全',
              arguments: setProviderParams({ item, entry, isDirectory: true, lineText }),
            };
          } else {
            item.kind = vscode.CompletionItemKind.File;
            item.command = {
              command: 'scope-search.onProvideSelected',
              title: '触发路径补全',
              arguments: setProviderParams({ item, entry, isDirectory: false, lineText }),
            };
          }
          items.push(item);
        }

        return items;
      },
    },
    '/', // 触发字符
  );
}

// 函数补全 Provider
function createFunctionCompletionProvider(languages: vscode.DocumentSelector) {
  return vscode.languages.registerCompletionItemProvider(
    languages,
    {
      provideCompletionItems() {
        if (!currentExport) return [];
        const items: vscode.CompletionItem[] = [];
        if (isCursorInsideBraces()) {
          const NamedExports = exportGlobalVariables.filterNamedExports();
          if (NamedExports.length) {
            for (const name of NamedExports) {
              const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Function);
              item.sortText = '0000'; // 排到最上面
              item.preselect = true;
              item.insertText = new vscode.SnippetString(`${name}$0`);
              items.push(item);
            }
          }
        } else {
          const defaultExport = exportGlobalVariables.filterDefaultExports();
          if (defaultExport.length) {
            const def = defaultExport[0];
            const defItem = new vscode.CompletionItem(def, vscode.CompletionItemKind.Variable);
            defItem.sortText = '0000'; // 排到最上面
            defItem.preselect = true;
            defItem.insertText = new vscode.SnippetString(`${def}$0`);
            items.push(defItem);
          }
        }
        return items;
      },
      resolveCompletionItem(item: vscode.CompletionItem) {
        // 点击 item 时绑定命令
        item.command = {
          command: 'scope-search.onFunctionProvideSelected',
          title: '触发函数补全',
          arguments: [item.label],
        };
        return item;
      },
    },
    '{',
    ' ',
    ',', // 触发字符
  );
}

// 注册 Export 功能
export function registerExport(context: vscode.ExtensionContext) {
  // 2️⃣ 注册路径选择命令
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
    const importStatement = generateImport(importPathString, exportNames);

    // 替换文本
    await replaceCurrentPath(importStatement);

    // 更新全局变量
    setExportGlobalVariables({
      isDefaultName: exportNames.defaultExport.length > 0,
      isName: exportNames.namedExports.length > 0,
      ...exportNames,
    });
    currentExport = exportGlobalVariables;

    // 等待编辑器渲染，再触发函数补全
    await new Promise((r) => setTimeout(r, 100));
    await vscode.commands.executeCommand('editor.action.triggerSuggest');
  });

  // 3️⃣ 注册函数补全点击命令（只注册一次）
  const disposableFunc = vscode.commands.registerCommand('scope-search.onFunctionProvideSelected', async (name: string) => {
    if (!currentExport) return;
    if (currentExport.namedExports.includes(name)) {
      setExportGlobalVariables({
        selectExports: [...exportGlobalVariables.selectExports, name],
      });
      // 触发函数补全
      await vscode.commands.executeCommand('editor.action.triggerSuggest');
    }
  });
  // 1️⃣ 注册 Provider
  const pathProvider = createPathCompletionProvider(LANGUAGES);
  const funcProvider = createFunctionCompletionProvider(LANGUAGES);
  context.subscriptions.push(pathProvider, funcProvider, disposablePath, disposableFunc);
}
