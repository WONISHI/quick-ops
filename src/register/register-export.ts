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

export function registerExport(context: vscode.ExtensionContext) {
  const provider = vscode.languages.registerCompletionItemProvider(
    LANGUAGES,
    {
      async provideCompletionItems(document, position) {
        const lineText = document.lineAt(position).text;
        if (isDirLikePath(lineText)) {
          const entries = await resolveImportDir(properties.fullPath, lineText);
          const items: vscode.CompletionItem[] = [];
          for (const entry of entries.flat(Infinity)) {
            const item = new vscode.CompletionItem(entry.name);
            item.command = {
              command: 'scope-search.onProvideSelected',
              title: '触发补全事件',
            };
            if (entry.isDirectory()) {
              item.kind = vscode.CompletionItemKind.Folder;
              item.insertText = entry.name + '/';
            } else {
              item.kind = vscode.CompletionItemKind.File;
              
            }
            items.push(item);
          }
          return items;
        }
      },
    },
    '/',
  );
  context.subscriptions.push(provider);
  //   const exportInfo = parseExports(filePath);
  //   const importStatement = generateImport('../src/components/alert/alert.ts', exportInfo);

  //   // 如果有 {}，光标放到大括号内
  //   const hasBraces = importStatement.includes('{');
  //   const snippet = hasBraces ? importStatement.replace('{', '{$1') : importStatement;

  //   editor.insertSnippet(new vscode.SnippetString(snippet));
}
