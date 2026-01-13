import * as fs from 'fs';
import { parse as vueParse } from '@vue/compiler-sfc';
import { parse as babelParse } from '@babel/parser';
import traverse from '@babel/traverse';

export interface ExportResult {
  namedExports: string[];
  defaultExport: string[];
}

export class AstParser {
  /**
   * 解析文件的导出 (Export) 信息
   * 支持 TypeScript, JSX
   */
  static parseExports(filePath: string): ExportResult {
    if (!fs.existsSync(filePath)) {
      return { namedExports: [], defaultExport: [] };
    }

    const code = fs.readFileSync(filePath, 'utf-8');
    const result: ExportResult = { namedExports: [], defaultExport: [] };

    try {
      const ast = babelParse(code, {
        sourceType: 'module',
        plugins: ['typescript', 'jsx', 'decorators-legacy'],
      });

      traverse(ast, {
        ExportNamedDeclaration(path) {
          const { node } = path;
          // 1. export function/const
          if (node.declaration) {
            if (node.declaration.type === 'FunctionDeclaration' && node.declaration.id) {
              result.namedExports.push(node.declaration.id.name);
            } else if (node.declaration.type === 'VariableDeclaration') {
              node.declaration.declarations.forEach((decl) => {
                if (decl.id.type === 'Identifier') {
                  result.namedExports.push(decl.id.name);
                }
              });
            }
          }
          // 2. export { foo, bar }
          if (node.specifiers.length) {
            node.specifiers.forEach((spec) => {
              if (spec.exported.type === 'Identifier') {
                result.namedExports.push(spec.exported.name);
              }
            });
          }
        },
        ExportDefaultDeclaration(path) {
          const { node } = path;
          if (node.declaration.type === 'FunctionDeclaration' && node.declaration.id) {
            result.defaultExport.push(node.declaration.id.name);
          } else {
            result.defaultExport.push('default');
          }
        },
      });
    } catch (error) {
      console.warn(`[AstParser] Failed to parse ${filePath}`, error);
    }

    return result;
  }

  /**
   * 解析 Vue 组件名称
   */
  static parseVueComponentName(filePath: string): string | null {
    if (!fs.existsSync(filePath)) return null;

    try {
      const source = fs.readFileSync(filePath, 'utf-8');
      const { descriptor } = vueParse(source);
      const script = descriptor.script || descriptor.scriptSetup;

      if (!script) return null;

      const ast = babelParse(script.content, {
        sourceType: 'module',
        plugins: ['typescript'],
      });

      let name: string | null = null;
      traverse(ast, {
        ExportDefaultDeclaration(path) {
          const declaration = path.node.declaration;
          if (declaration.type === 'ObjectExpression') {
            const nameProp = declaration.properties.find((p: any) => p.key?.name === 'name');
            if (nameProp && nameProp.type === 'ObjectProperty' && nameProp.value.type === 'StringLiteral') {
              name = nameProp.value.value;
            }
          }
        },
      });
      return name;
    } catch (e) {
      return null;
    }
  }
}
