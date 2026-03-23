// 🌟 优化 1：使用 type-only import 导入 @babel/types，这在编译为 JS 后会完全消失，零运行时开销！
import type * as tTypes from '@babel/types';
import type { ExportItem, ParseResult } from '../core/types/export';

// 缓存 Key 改为 fileUri (字符串) + version (或 content hash)，这里简化为 uri 字符串
const exportsCache = new Map<string, { contentHash: number; result: ParseResult }>();
const vueNameCache = new Map<string, { contentHash: number; result: string | null }>();

export class AstParser {
  /**
   * 简单的字符串哈希，用于检测内容是否变化 (替代 mtime)
   */
  private static stringHash(str: string): number {
    let hash = 0;
    if (str.length === 0) return hash;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0; // Convert to 32bit integer
    }
    return hash;
  }

  /**
   * 解析代码内容的导出信息 (纯函数，无 I/O)
   * @param fileKey 文件的唯一标识 (通常是 Uri.toString())，用于缓存
   * @param code 文件内容字符串
   */
  public static parseExports(fileKey: string, code: string): ParseResult {
    const currentHash = this.stringHash(code);

    const cached = exportsCache.get(fileKey);
    if (cached && cached.contentHash === currentHash) {
      return cached.result;
    }

    // --- 开始解析 ---
    try {
      // 🌟 优化 2：在这里执行按需引入！只有真正触发解析时，才会加载 Babel
      const { parse: babelParse } = require('@babel/parser');
      const traverseModule = require('@babel/traverse');
      const traverse = traverseModule.default || traverseModule; // 兼容 Babel 默认导出的特殊情况
      const t = require('@babel/types');

      const ast = babelParse(code, {
        sourceType: 'module',
        plugins: ['typescript', 'jsx'],
      });

      const namedExports: ExportItem[] = [];
      const defaultExport: string[] = [];

      traverse(ast, {
        ExportNamedDeclaration(path: any) {
          if (path.node.declaration) {
            const declaration = path.node.declaration;

            if (t.isVariableDeclaration(declaration)) {
              declaration.declarations.forEach((decl: any) => {
                if (t.isIdentifier(decl.id)) {
                  const start = path.node.start ?? 0;
                  const end = path.node.end ?? 0;
                  const codeSnippet = code.slice(start, end);
                  namedExports.push({ name: decl.id.name, code: codeSnippet });
                }
              });
            } else if (t.isFunctionDeclaration(declaration) && declaration.id) {
              const start = path.node.start ?? 0;
              const end = path.node.end ?? 0;
              const codeSnippet = code.slice(start, end);
              namedExports.push({ name: declaration.id.name, code: codeSnippet });
            } else if (t.isClassDeclaration(declaration) && declaration.id) {
              const start = path.node.start ?? 0;
              const end = path.node.end ?? 0;
              const codeSnippet = code.slice(start, end);
              namedExports.push({ name: declaration.id.name, code: codeSnippet });
            }
          }
        },
        ExportDefaultDeclaration(path: any) {
          const decl = path.node.declaration;
          if (t.isIdentifier(decl)) {
            defaultExport.push(decl.name);
          } else if (t.isFunctionDeclaration(decl) && decl.id) {
            defaultExport.push(decl.id.name);
          } else if (t.isClassDeclaration(decl) && decl.id) {
            defaultExport.push(decl.id.name);
          }
        },
      });

      const result = { namedExports, defaultExport };

      // 写入缓存
      exportsCache.set(fileKey, { contentHash: currentHash, result });

      return result;
    } catch (e) {
      console.error(`Parse error for ${fileKey}:`, e);
      return { namedExports: [], defaultExport: [] };
    }
  }

  /**
   * 解析 Vue 组件名称 (纯函数，无 I/O)
   */
  static parseVueComponentName(fileKey: string, code: string): string | null {
    const currentHash = this.stringHash(code);

    const cached = vueNameCache.get(fileKey);
    if (cached && cached.contentHash === currentHash) {
      return cached.result;
    }

    try {
      // 🌟 优化 3：同样在这里按需引入 vueParse 和 Babel
      const { parse: vueParse } = require('@vue/compiler-sfc');
      const { parse: babelParse } = require('@babel/parser');
      const traverseModule = require('@babel/traverse');
      const traverse = traverseModule.default || traverseModule;

      const { descriptor } = vueParse(code);
      let componentName: string | null = null;

      if (descriptor.scriptSetup) {
        const ast = babelParse(descriptor.scriptSetup.content, {
          sourceType: 'module',
          plugins: ['typescript', 'jsx'],
        });
        traverse(ast, {
          CallExpression(path: any) {
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

      if (!componentName && descriptor.script) {
        const ast = babelParse(descriptor.script.content, {
          sourceType: 'module',
          plugins: ['typescript', 'jsx'],
        });
        traverse(ast, {
          ExportDefaultDeclaration(path: any) {
            const decl = path.node.declaration;
            if (decl.type === 'ObjectExpression') {
              const nameProp = AstParser.findPropertyByName(decl, 'name');
              if (nameProp) componentName = nameProp;
            } else if (decl.type === 'CallExpression') {
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

      vueNameCache.set(fileKey, { contentHash: currentHash, result: componentName });
      return componentName;
    } catch (e) {
      return null;
    }
  }

  // 🌟 优化 4：这里使用前面仅做类型导入的 tTypes
  private static findPropertyByName(node: tTypes.ObjectExpression, keyName: string): string | null {
    const prop = node.properties.find((p) => {
      if (p.type !== 'ObjectProperty') return false;
      if (p.key.type === 'Identifier' && p.key.name === keyName) return true;
      if (p.key.type === 'StringLiteral' && p.key.value === keyName) return true;
      return false;
    });

    if (prop && prop.type === 'ObjectProperty' && prop.value.type === 'StringLiteral') {
      return prop.value.value;
    }
    return null;
  }
}