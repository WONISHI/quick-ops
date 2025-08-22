import * as vscode from 'vscode';
import { properties } from '../global-object/properties';
import { resolveImportDir, getAbsolutePath, joinPaths, removeSurroundingQuotes, replaceCurrentPath } from '../utils/index';
import { parseExports, type ExportResult } from '../utils/parse';

const LANGUAGES = ['javascript', 'javascriptreact', 'typescript', 'typescriptreact', 'vue'];

function setProviderParams({ item, entry, lineText, isDirectory }: any) {
  return [{ fileEntry: { ...item, ...entry }, isDirectory: isDirectory, lineText: lineText }];
}

function generateImport(relativePath: string, exportInfo: ExportResult) {
  if (exportInfo.defaultExport.length) {
    return 'import ${1} from ' + '\'' + relativePath + '\'' + ';';
  } else {
    return 'import { ${1} } from ' + '\'' + relativePath + '\'' + ';';
  }
}

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
      console.log(importPathString);
      replaceCurrentPath(importStatement);
      // 文件选择逻辑
      // const editor = vscode.window.activeTextEditor;
      // if (!editor) return;
      // const selection = editor.selection;
      // const range = selection.isEmpty ? new vscode.Range(selection.start, selection.end.translate(0, 0)) : selection;
      // console.log(range, contextItem);
      // await editor.insertSnippet(new vscode.SnippetString(importStatement), range);
    }
  });
  context.subscriptions.push(provider, disposable);
}
