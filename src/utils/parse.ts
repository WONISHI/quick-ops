import fs from 'fs';
import { parse as vueParse } from '@vue/compiler-sfc';
import { parse as babelParse } from '@babel/parser';
import traverse from '@babel/traverse';

export type ExportItem = string[];

export interface ExportResult {
  namedExports: ExportItem;
  defaultExport: ExportItem; // 如果是匿名默认导出，用 'defaultExport' 标识
}

export function parseExports(filePath: string): ExportResult {
  const code = fs.readFileSync(filePath, 'utf-8');

  const ast = babelParse(code, {
    sourceType: 'module',
    plugins: ['typescript', 'jsx'], // 支持 TS 和 JSX
  });

  const result: ExportResult = {
    namedExports: [],
    defaultExport: [],
  };

  traverse(ast.program, {
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

export function parseVueComponentName(filePath: string): string | null {
  const source = fs.readFileSync(filePath, 'utf-8');
  const { descriptor } = vueParse(source);
  const script = descriptor.script || descriptor.scriptSetup;
  if (!script) return null;
  const ast = babelParse(script.content, {
    sourceType: 'module',
    plugins: ['typescript'],
  });

  let name: string | null = null;
  traverse(ast.program, {
    ExportDefaultDeclaration(path) {
      const declaration = path.node.declaration;
      if (declaration.type === 'ObjectExpression') {
        const nameProp = declaration.properties.find((p) => p.type === 'ObjectProperty' && p.key.type === 'Identifier' && p.key.name === 'name');
        if (nameProp && nameProp.type === 'ObjectProperty') {
          if (nameProp.value.type === 'StringLiteral') {
            name = nameProp.value.value;
          }
        }
      }
    },
  });
  return name;
}
