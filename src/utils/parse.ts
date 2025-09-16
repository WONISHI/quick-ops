import fs from 'fs';
import { parse as vueParse } from '@vue/compiler-sfc';
import { parse as babelParse } from '@babel/parser';
import traverse from '@babel/traverse';
import * as cheerio from 'cheerio';
import * as vscode from 'vscode';

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

/**
 * 解析 HTML/Vue template，生成嵌套 LESS/SASS 结构
 * @param html template 内容
 * @param type 'less' | 'sass'
 */
export function generateCssStructure(html: string, type: 'less' | 'sass' = 'less'): string {
  const $ = cheerio.load(html, { xmlMode: true });
  const indentChar = type === 'less' ? '  ' : '  ';
  function traverse(el: any, depth = 0): string {
    if (el.type !== 'tag') return '';
    const classAttr = el.attribs?.class;
    const selector = classAttr ? '.' + classAttr.split(/\s+/).join('.') : el.name;
    let css = `${indentChar.repeat(depth)}${selector} {\n`;
    $(el)
      .children()
      .each((_, child) => {
        css += traverse(child, depth + 1);
      });
    css += `${indentChar.repeat(depth)}}\n`;
    return css;
  }
  let result = '';
  $('body')
    .children()
    .each((_, el) => {
      result += traverse(el);
    });
  return result;
}

export async function parseElTableColumnsFromSelection() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return [];
  const selection = editor.selection;
  const selectedText = editor.document.getText(selection);
  const docText = editor.document.getText();

  const columns: { prop: string; label: string }[] = [];

  // --- 1️⃣ 静态列解析 ---
  const staticRegex = /<el-table-column\b([^>]*)\/?>/g;
  let match: RegExpExecArray | null;
  while ((match = staticRegex.exec(selectedText)) !== null) {
    const attrs = match[1];

    // 跳过 v-for 的动态列
    if (/[:]?v-for\s*=\s*["']\(\w+,\s*\w+\)\s+in\s+\w+["']/.test(attrs)) continue;

    const propMatch = attrs.match(/[:]?prop\s*=\s*["'`]?([\w.]+)["'`]?/);
    const labelMatch = attrs.match(/[:]?label\s*=\s*["'`]([^"'`]+)["'`]?/);

    const prop = propMatch ? propMatch[1] : '';
    const label = labelMatch ? labelMatch[1] : '';

    if (prop || label) columns.push({ prop, label });
  }

  // --- 2️⃣ 动态列解析 (v-for) ---
  const vForMatches = selectedText.matchAll(/<el-table-column\b([^>]*)\s+v-for\s*=\s*["']\(\w+,\s*\w+\)\s+in\s+(\w+)["'][^>]*>/g);

  // 解析 AST
  const ast = babelParse(docText, {
    sourceType: 'module',
    plugins: ['typescript', 'jsx'], // vue 单文件可以用 jsx plugin
  });

  for (const vForMatch of vForMatches) {
    const columnsVarName = vForMatch[2]; // v-for 引用的数组变量名

    traverse(ast, {
      ObjectProperty(path) {
        const key = path.node.key;
        if ((key.type === 'Identifier' && key.name === columnsVarName) || (key.type === 'StringLiteral' && key.value === columnsVarName)) {
          const valueNode = path.node.value;
          if (valueNode.type === 'ArrayExpression') {
            valueNode.elements.forEach((el) => {
              if (el && el.type === 'ObjectExpression') {
                const propNode = el.properties.find(
                  (p) => p.type === 'ObjectProperty' && ((p.key.type === 'Identifier' && p.key.name === 'prop') || (p.key.type === 'StringLiteral' && p.key.value === 'prop')),
                );
                const labelNode = el.properties.find(
                  (p) => p.type === 'ObjectProperty' && ((p.key.type === 'Identifier' && p.key.name === 'label') || (p.key.type === 'StringLiteral' && p.key.value === 'label')),
                );

                columns.push({
                  prop: propNode?.type === 'ObjectProperty' && propNode.value.type === 'StringLiteral' ? propNode.value.value : '',
                  label: labelNode?.type === 'ObjectProperty' && labelNode.value.type === 'StringLiteral' ? labelNode.value.value : '',
                });
              }
            });
          }
        }
      },
    });
  }

  return columns;
}
