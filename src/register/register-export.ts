import * as ts from 'typescript';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { properties } from '../global-object/properties';
import { isDirLikePath, resolveImportDir } from '../utils/index';

const LANGUAGES = ['javascript', 'javascriptreact', 'typescript', 'typescriptreact', 'vue'];

export function parseExports(filePath: string) {
  const code = fs.readFileSync(filePath, 'utf-8');
  const sourceFile = ts.createSourceFile(
    filePath,
    code,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.TSX, // 根据文件类型选择 JSX 或 TSX
  );
  const namedExports: string[] = [];
  let defaultExport: string | null = null;
  sourceFile.forEachChild((node) => {
    if (ts.isExportAssignment(node) && !node.isExportEquals) {
      // export default ...
      defaultExport = 'default'; // 可以让用户自定义变量名
    }
    if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
      node.exportClause.elements.forEach((el) => {
        namedExports.push(el.name.getText());
      });
    }
    if (ts.isVariableStatement(node) && node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
      node.declarationList.declarations.forEach((d) => {
        namedExports.push(d.name.getText());
      });
    }
    if (ts.isFunctionDeclaration(node) && node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
      if (node.name) namedExports.push(node.name.getText());
    }
    if (ts.isClassDeclaration(node) && node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
      if (node.name) namedExports.push(node.name.getText());
    }
  });
  return { namedExports, defaultExport };
}

function generateImport(relativePath: string, exportInfo: { namedExports: string[]; defaultExport: string | null }) {
  if (exportInfo.defaultExport && exportInfo.namedExports.length === 0) {
    return `import ${exportInfo.defaultExport} from '${relativePath}';`;
  } else if (!exportInfo.defaultExport && exportInfo.namedExports.length > 0) {
    return `import { ${exportInfo.namedExports.join(', ')} } from '${relativePath}';`;
  } else if (exportInfo.defaultExport && exportInfo.namedExports.length > 0) {
    return `import ${exportInfo.defaultExport}, { ${exportInfo.namedExports.join(', ')} } from '${relativePath}';`;
  }
  return '';
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
              arguments: [{ fileEntry: { ...item, ...entry }, isDirectory: true }],
            };
          } else {
            item.kind = vscode.CompletionItemKind.File;
            item.command = {
              command: 'scope-search.onProvideSelected',
              title: '触发补全事件',
              arguments: [{ fileEntry: { ...item, ...entry }, isDirectory: false }],
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
      // 文件选择逻辑
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      await editor.insertSnippet(new vscode.SnippetString(contextItem.fileEntry.insertText), editor.selection.active);
    }
  });
  context.subscriptions.push(provider, disposable);
}
