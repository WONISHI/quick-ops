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
        console.log(isDirLikePath(lineText));
        if (isDirLikePath(lineText)) {
          const data = await resolveImportDir(properties.fullPath, lineText);
          console.log('data', data);
        }
        // 判断是否在 import {} from 'xxx'
        const importMatch = lineText.match(/import\s+{([^}]*)}\s+from\s+['"]([^'"]+)['"]/);
        if (!importMatch) return;

        const [, , importPath] = importMatch;
        const absPath = path.resolve(path.dirname(document.uri.fsPath), importPath);
        let files: string[] = [];
        if (fs.existsSync(absPath) && fs.lstatSync(absPath).isDirectory()) {
          files = fs.readdirSync(absPath).filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'));
        }
        const items: vscode.CompletionItem[] = [];
        for (const file of files) {
          const filePath = path.join(absPath, file);
          const content = fs.readFileSync(filePath, 'utf-8');
          const exportInfo = parseExports(content);
          exportInfo.namedExports.forEach((name) => {
            const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Variable);
            items.push(item);
          });
          if (exportInfo.defaultExport) {
            const item = new vscode.CompletionItem(path.basename(file, '.ts'), vscode.CompletionItemKind.Class);
            item.detail = 'default export';
            items.push(item);
          }
        }
        return items;
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
