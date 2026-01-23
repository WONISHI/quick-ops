import * as fs from 'fs';
import { parse as vueParse } from '@vue/compiler-sfc';
import { parse as babelParse } from '@babel/parser';
import traverse from '@babel/traverse';
import * as t from '@babel/types'; // 需要安装 @types/babel__types

export interface ExportItem {
  name: string;
  code?: string; // 新增字段：用于存储函数体代码
}

export interface ParseResult {
  namedExports: ExportItem[]; // 修改这里，不再只是 string[]
  defaultExport: string[];
}

export class AstParser {
  /**
   * 解析文件的导出 (Export) 信息
   * 支持 TypeScript, JSX, TSX, JS
   */
  public static parseExports(filePath: string): ParseResult {
    const code = fs.readFileSync(filePath, 'utf-8');
    const ast = babelParse(code, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx'], // 根据需要添加插件
    });

    const namedExports: ExportItem[] = [];
    const defaultExport: string[] = [];

    traverse(ast, {
      // 1. 处理 export const/let/var ...
      ExportNamedDeclaration(path) {
        if (path.node.declaration) {
          const declaration = path.node.declaration;

          // export const foo = () => {}
          if (t.isVariableDeclaration(declaration)) {
            declaration.declarations.forEach((decl) => {
              if (t.isIdentifier(decl.id)) {
                // 截取源码
                const start = path.node.start ?? 0;
                const end = path.node.end ?? 0;
                const codeSnippet = code.slice(start, end);

                namedExports.push({ name: decl.id.name, code: codeSnippet });
              }
            });
          }
          // export function foo() {}
          else if (t.isFunctionDeclaration(declaration) && declaration.id) {
            const start = path.node.start ?? 0;
            const end = path.node.end ?? 0;
            const codeSnippet = code.slice(start, end);

            namedExports.push({ name: declaration.id.name, code: codeSnippet });
          }
          // export class Foo {}
          else if (t.isClassDeclaration(declaration) && declaration.id) {
            const start = path.node.start ?? 0;
            const end = path.node.end ?? 0;
            const codeSnippet = code.slice(start, end);
            namedExports.push({ name: declaration.id.name, code: codeSnippet });
          }
        }
      },

      // 2. 处理 export default ... (通常只拿名字，或者你可以扩展逻辑拿代码)
      ExportDefaultDeclaration(path) {
        const decl = path.node.declaration;
        if (t.isIdentifier(decl)) {
          defaultExport.push(decl.name);
        } else if (t.isFunctionDeclaration(decl) && decl.id) {
          defaultExport.push(decl.id.name);
        } else if (t.isClassDeclaration(decl) && decl.id) {
          defaultExport.push(decl.id.name);
        }
        // 对于匿名 default export，通常无法补全名字，这里暂且忽略
      },
    });

    return { namedExports, defaultExport };
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
