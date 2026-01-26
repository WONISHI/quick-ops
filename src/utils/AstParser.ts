import * as fs from 'fs';
import { parse as vueParse } from '@vue/compiler-sfc';
import { parse as babelParse } from '@babel/parser';
import traverse from '@babel/traverse';
import * as t from '@babel/types';

export interface ExportItem {
  name: string;
  code?: string;
}

export interface ParseResult {
  namedExports: ExportItem[];
  defaultExport: string[];
}

// 🔥 1. 定义缓存容器 (放在类外部，随模块生命周期存在)
const exportsCache = new Map<string, { mtime: number; result: ParseResult }>();
const vueNameCache = new Map<string, { mtime: number; result: string | null }>();

export class AstParser {
  /**
   * 解析文件的导出 (Export) 信息
   * 支持 TypeScript, JSX, TSX, JS
   */
  public static parseExports(filePath: string): ParseResult {
    // 🔥 2. 获取文件状态 (检查修改时间)
    let stats: fs.Stats;
    try {
      stats = fs.statSync(filePath);
    } catch (e) {
      // 文件不存在或无法访问
      return { namedExports: [], defaultExport: [] };
    }

    // 🔥 3. 检查缓存：路径匹配 且 修改时间一致
    const cached = exportsCache.get(filePath);
    if (cached && cached.mtime === stats.mtimeMs) {
      return cached.result;
    }

    // --- 缓存未命中，开始执行耗时解析 ---
    try {
      const code = fs.readFileSync(filePath, 'utf-8');
      const ast = babelParse(code, {
        sourceType: 'module',
        plugins: ['typescript', 'jsx'],
      });

      const namedExports: ExportItem[] = [];
      const defaultExport: string[] = [];

      traverse(ast, {
        ExportNamedDeclaration(path) {
          if (path.node.declaration) {
            const declaration = path.node.declaration;

            if (t.isVariableDeclaration(declaration)) {
              declaration.declarations.forEach((decl) => {
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
        ExportDefaultDeclaration(path) {
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

      // 🔥 4. 解析完成，写入缓存
      exportsCache.set(filePath, { mtime: stats.mtimeMs, result });

      return result;
    } catch (e) {
      console.error(`Parse error for ${filePath}:`, e);
      return { namedExports: [], defaultExport: [] };
    }
  }

  /**
   * 解析 Vue 组件名称
   */
  static parseVueComponentName(filePath: string): string | null {
    // 🔥 同样添加缓存逻辑
    let stats: fs.Stats;
    try {
      stats = fs.statSync(filePath);
    } catch (e) {
      return null;
    }

    const cached = vueNameCache.get(filePath);
    if (cached && cached.mtime === stats.mtimeMs) {
      return cached.result;
    }

    try {
      const source = fs.readFileSync(filePath, 'utf-8');
      const { descriptor } = vueParse(source);
      let componentName: string | null = null;

      if (descriptor.scriptSetup) {
        const ast = babelParse(descriptor.scriptSetup.content, {
          sourceType: 'module',
          plugins: ['typescript', 'jsx'],
        });
        traverse(ast, {
          CallExpression(path) {
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
          ExportDefaultDeclaration(path) {
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

      // 🔥 写入缓存
      vueNameCache.set(filePath, { mtime: stats.mtimeMs, result: componentName });

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
