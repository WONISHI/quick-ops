import * as vscode from 'vscode';
import { properties } from '../global-object/properties';
import { setExportGlobalVariables } from '../global-object/export-global';
import { resolveImportDir, getAbsolutePath, joinPaths, removeSurroundingQuotes, replaceCurrentPath } from '../utils/index';
import { parseExports, type ExportResult } from '../utils/parse';

const LANGUAGES = ['javascript', 'javascriptreact', 'typescript', 'typescriptreact', 'vue'];

function setProviderParams({ item, entry, lineText, isDirectory }: any) {
  return [{ fileEntry: { ...item, ...entry }, isDirectory: isDirectory, lineText: lineText }];
}

// 后期到底是插入单引号还是双引号需要判断
function generateImport(relativePath: string, exportInfo: ExportResult) {
  if (exportInfo.defaultExport.length) {
    return 'import ${1} from ' + "'" + relativePath + "'" + ';';
  } else {
    return 'import { ${1} } from ' + "'" + relativePath + "'" + ';';
  }
}

// 创建路径补全提供者
function createPathCompletionProvider(languages: vscode.DocumentSelector, _init: boolean = true) {
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
              title: '触发补全事件',
              arguments: setProviderParams({ item, entry, isDirectory: true, lineText }),
            };
          } else {
            item.kind = vscode.CompletionItemKind.File;
            item.command = {
              command: 'scope-search.onProvideSelected',
              title: '触发补全事件',
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

function createFunctionCompletionProvider(languages: vscode.DocumentSelector, FunctionCompletionItems: ExportResult) {
  return vscode.languages.registerCompletionItemProvider(
    languages,
    {
      async provideCompletionItems(document, position) {
        const items: vscode.CompletionItem[] = [];
        for (const exp of FunctionCompletionItems.namedExports) {
          const item = new vscode.CompletionItem(exp, vscode.CompletionItemKind.Function);
          items.push(item);
        }
        return items;
      },
    },
    '{',
    ' ',
    ',',
  );
}

export function registerExport(context: vscode.ExtensionContext) {
  // 全局 provider
  const provider = createPathCompletionProvider(LANGUAGES, true);
  // 处理选中补全事件
  const disposable = vscode.commands.registerCommand('scope-search.onProvideSelected', async (contextItem) => {
    if (!contextItem) return;
    if (contextItem.isDirectory) {
      // 插入目录名 + /
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      // 立刻触发补全，显示该目录下内容
      await vscode.commands.executeCommand('editor.action.triggerSuggest');
    } else {
      const filePath = getAbsolutePath(contextItem.fileEntry.parentPath, contextItem.fileEntry.name);
      const importPathString = joinPaths(removeSurroundingQuotes(contextItem.lineText), contextItem.fileEntry.name);
      const exportNames: ExportResult = parseExports(filePath);
      const importStatement = generateImport(importPathString, exportNames);
      await replaceCurrentPath(importStatement);
      const functionProvider = await createFunctionCompletionProvider(LANGUAGES, exportNames);
      context.subscriptions.push(functionProvider);
      setExportGlobalVariables({
        isDefaultName: exportNames.defaultExport.length > 0,
        isName: exportNames.namedExports.length > 0,
        ...exportNames
      });
      await vscode.commands.executeCommand('editor.action.triggerSuggest');
    }
  });
  context.subscriptions.push(provider, disposable);
}
