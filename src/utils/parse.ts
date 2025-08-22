import fs from 'fs';
import { parse } from '@babel/parser';
import traverse from '@babel/traverse';

export type ExportItem = string[];

export interface ExportResult {
  namedExports: ExportItem;
  defaultExport: ExportItem; // 如果是匿名默认导出，用 'defaultExport' 标识
}

export function parseExports(filePath: string): ExportResult {
  const code = fs.readFileSync(filePath, 'utf-8');

  const ast = parse(code, {
    sourceType: 'module',
    plugins: ['typescript', 'jsx'], // 支持 TS 和 JSX
  });

  const result: ExportResult = {
    namedExports: [],
    defaultExport: [],
  };

  traverse(ast, {
    ExportNamedDeclaration(path) {
      const { node } = path;

      // export function foo() {} 或 export const bar = () => {}
      if (node.declaration) {
        if (node.declaration.type === 'FunctionDeclaration' && node.declaration.id) {
          result.namedExports.push(node.declaration.id.name);
        }
        if (node.declaration.type === 'VariableDeclaration') {
          for (const decl of node.declaration.declarations) {
            if (decl.id.type === 'Identifier') {
              result.namedExports.push(decl.id.name);
            }
          }
        }
      }

      // export { foo, bar }
      if (node.specifiers && node.specifiers.length) {
        for (const spec of node.specifiers) {
          if (spec.exported && spec.exported.type === 'Identifier') {
            result.namedExports.push(spec.exported.name);
          }
        }
      }
    },

    ExportDefaultDeclaration(path) {
      const { node } = path;
      if (node.declaration.type === 'FunctionDeclaration' && node.declaration.id) {
        result.defaultExport.push(node.declaration.id.name);
      } else {
        // 匿名函数、箭头函数、对象、类等默认导出
        result.defaultExport.push('default');
      }
    },
  });

  return result;
}
