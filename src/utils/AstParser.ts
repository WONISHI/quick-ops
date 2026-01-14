import * as fs from 'fs';
import { parse as vueParse } from '@vue/compiler-sfc';
import { parse as babelParse } from '@babel/parser';
import traverse from '@babel/traverse';
import * as t from '@babel/types'; // 需要安装 @types/babel__types

export interface ExportResult {
  namedExports: string[];
  defaultExport: string[];
}

export class AstParser {
  /**
   * 解析文件的导出 (Export) 信息
   * 支持 TypeScript, JSX, TSX, JS
   */
  static parseExports(filePath: string): ExportResult {
    if (!fs.existsSync(filePath)) {
      return { namedExports: [], defaultExport: [] };
    }

    const code = fs.readFileSync(filePath, 'utf-8');
    const result: ExportResult = { namedExports: [], defaultExport: [] };

    try {
      // 1. 生成 AST
      const ast = babelParse(code, {
        sourceType: 'module',
        plugins: ['typescript', 'jsx', 'decorators-legacy', 'classProperties', 'exportDefaultFrom'],
      });

      // 2. 遍历 AST
      traverse(ast, {
        // === 处理具名导出 (export const/function/class/interface...) ===
        ExportNamedDeclaration(path) {
          const { node } = path;

          // 情况 A: export const a = 1; / export function f() {}
          if (node.declaration) {
            // Function
            if (node.declaration.type === 'FunctionDeclaration' && node.declaration.id) {
              result.namedExports.push(node.declaration.id.name);
            }
            // Class
            else if (node.declaration.type === 'ClassDeclaration' && node.declaration.id) {
              result.namedExports.push(node.declaration.id.name);
            }
            // Variable (const/let/var)
            else if (node.declaration.type === 'VariableDeclaration') {
              node.declaration.declarations.forEach((decl) => {
                if (decl.id.type === 'Identifier') {
                  result.namedExports.push(decl.id.name);
                }
              });
            }
            // TypeScript Interface
            else if (node.declaration.type === 'TSInterfaceDeclaration') {
              result.namedExports.push(node.declaration.id.name);
            }
            // TypeScript Type Alias
            else if (node.declaration.type === 'TSTypeAliasDeclaration') {
              result.namedExports.push(node.declaration.id.name);
            }
            // TypeScript Enum
            else if (node.declaration.type === 'TSEnumDeclaration') {
              result.namedExports.push(node.declaration.id.name);
            }
          }

          // 情况 B: export { foo, bar as baz }
          if (node.specifiers.length > 0) {
            node.specifiers.forEach((spec) => {
              if (spec.type === 'ExportSpecifier' && spec.exported.type === 'Identifier') {
                result.namedExports.push(spec.exported.name);
              }
            });
          }
        },

        // === 处理默认导出 (export default ...) ===
        ExportDefaultDeclaration(path) {
          const { node } = path;
          // export default function foo() {}
          if ((node.declaration.type === 'FunctionDeclaration' || node.declaration.type === 'ClassDeclaration') && node.declaration.id) {
            result.defaultExport.push(node.declaration.id.name);
          } else {
            // export default { ... } 或 export default someVar
            // 通常统一标记为 "default"
            result.defaultExport.push('default');
          }
        },
      });
    } catch (error) {
      // 忽略解析错误（可能是语法错误或非标准文件）
      // console.warn(`[AstParser] Error parsing ${filePath}:`, error);
    }

    return result;
  }

  /**
   * 解析 Vue 组件名称
   * 支持:
   * 1. Vue 2/3 Options API: export default { name: 'Comp' }
   * 2. Vue 3 defineComponent: export default defineComponent({ name: 'Comp' })
   * 3. Vue 3 Script Setup: defineOptions({ name: 'Comp' })
   */
  static parseVueComponentName(filePath: string): string | null {
    if (!fs.existsSync(filePath)) return null;

    try {
      const source = fs.readFileSync(filePath, 'utf-8');

      // 使用 Vue 官方编译器解析 SFC 结构
      const { descriptor } = vueParse(source);

      let componentName: string | null = null;

      // === 策略 1: 检查 <script setup> (Vue 3.3+ defineOptions) ===
      if (descriptor.scriptSetup) {
        const ast = babelParse(descriptor.scriptSetup.content, {
          sourceType: 'module',
          plugins: ['typescript', 'jsx'],
        });

        traverse(ast, {
          CallExpression(path) {
            // 查找 defineOptions({ name: '...' })
            if (path.node.callee.type === 'Identifier' && path.node.callee.name === 'defineOptions' && path.node.arguments.length > 0) {
              const arg = path.node.arguments[0];
              if (arg.type === 'ObjectExpression') {
                const nameProp = AstParser.findPropertyByName(arg, 'name');
                if (nameProp) componentName = nameProp;
              }
            }
          },
        });
      }

      // === 策略 2: 如果 script setup 没找到，检查普通 <script> ===
      if (!componentName && descriptor.script) {
        const ast = babelParse(descriptor.script.content, {
          sourceType: 'module',
          plugins: ['typescript', 'jsx'],
        });

        traverse(ast, {
          ExportDefaultDeclaration(path) {
            const decl = path.node.declaration;

            // 情况 A: export default { name: '...' }
            if (decl.type === 'ObjectExpression') {
              const nameProp = AstParser.findPropertyByName(decl, 'name');
              if (nameProp) componentName = nameProp;
            }
            // 情况 B: export default defineComponent({ name: '...' })
            else if (decl.type === 'CallExpression') {
              // 判断是否是 defineComponent(...)
              if (decl.callee.type === 'Identifier' && decl.callee.name === 'defineComponent' && decl.arguments.length > 0) {
                const arg = decl.arguments[0];
                if (arg.type === 'ObjectExpression') {
                  const nameProp = AstParser.findPropertyByName(arg, 'name');
                  if (nameProp) componentName = nameProp;
                }
              }
            }
          },
        });
      }

      return componentName;
    } catch (e) {
      return null;
    }
  }

  /**
   * 内部辅助：从对象表达式中查找 key 为 'name' 的字符串值
   */
  private static findPropertyByName(node: t.ObjectExpression, keyName: string): string | null {
    const prop = node.properties.find((p) => {
      // 过滤掉 SpreadElement (...obj)
      if (p.type !== 'ObjectProperty') return false;

      // 检查 key: name
      if (p.key.type === 'Identifier' && p.key.name === keyName) return true;
      // 检查 key: 'name'
      if (p.key.type === 'StringLiteral' && p.key.value === keyName) return true;

      return false;
    });

    // 确保 value 是字符串字面量
    if (prop && prop.type === 'ObjectProperty' && prop.value.type === 'StringLiteral') {
      return prop.value.value;
    }
    return null;
  }
}
