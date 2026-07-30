import type { StyleNode } from '@modules/style-generator/style-generator.type';

export class StyleStructureParser {
  static async parse(content: string, languageId: string): Promise<string> {
    let nodes: StyleNode[] = [];

    if (languageId === 'vue' || languageId === 'html') {
      nodes = await this.parseHtmlOrVue(content, languageId === 'vue');
    } else if (languageId === 'javascriptreact' || languageId === 'typescriptreact') {
      nodes = await this.parseJsx(content);
    }

    if (nodes.length === 0) return '';
    return this.generateScss(nodes);
  }

  private static async parseHtmlOrVue(content: string, isVue: boolean): Promise<StyleNode[]> {
    let htmlContent = content;

    if (isVue) {
      const match = content.match(/<template[^>]*>([\s\S]*?)<\/template>/i);
      htmlContent = match ? match[1] : '';
    }

    if (!htmlContent.trim()) return [];

    const cheerio = require('cheerio');
    const $ = cheerio.load(htmlContent, { xmlMode: false, decodeEntities: false });
    const rootNodes: StyleNode[] = [];

    const traverseFlat = (element: any): StyleNode[] => {
      if (element.type !== 'tag') return [];
      const $el = $(element);

      const id = $el.attr('id');
      const className = $el.attr('class');

      let selector = '';
      if (id) selector += `#${id}`;
      if (className) {
        selector += className
          .split(/\s+/)
          .filter(Boolean)
          .map((c: string) => `.${c}`)
          .join('');
      }

      const childStyleNodes: StyleNode[] = [];
      $el.children().each((_: any, child: any) => {
        childStyleNodes.push(...traverseFlat(child));
      });

      if (selector) {
        return [{ selector, children: childStyleNodes }];
      } else {
        return childStyleNodes;
      }
    };

    $('body')
      .children()
      .each((_: any, el: any) => {
        rootNodes.push(...traverseFlat(el));
      });

    return rootNodes;
  }

  private static async parseJsx(content: string): Promise<StyleNode[]> {
    const rootNodes: StyleNode[] = [];
    try {
      const { parse } = require('@babel/parser');
      const traverseModule = require('@babel/traverse');
      const traverse = traverseModule.default || traverseModule;

      const ast = parse(content, {
        sourceType: 'module',
        plugins: ['jsx', 'typescript'],
      });

      const processJsxElement = (path: any): StyleNode[] => {
        const openingElement = path.get('openingElement');
        const attributes = openingElement.get('attributes');

        let selector = '';

        if (Array.isArray(attributes)) {
          attributes.forEach((attr: any) => {
            if (!attr.isJSXAttribute()) return;
            const name = attr.node.name.name;
            const value = attr.get('value');

            if (name === 'id' && value.isStringLiteral()) {
              selector = `#${value.node.value}` + selector;
            }
            if (name === 'className') {
              if (value.isStringLiteral()) {
                selector += value.node.value
                  .split(/\s+/)
                  .filter(Boolean)
                  .map((c: string) => `.${c}`)
                  .join('');
              } else if (value.isJSXExpressionContainer()) {
                const expr = value.get('expression');
                if (expr.isStringLiteral()) {
                  selector += expr.node.value
                    .split(/\s+/)
                    .filter(Boolean)
                    .map((c: string) => `.${c}`)
                    .join('');
                }
              }
            }
          });
        }

        const childStyleNodes: StyleNode[] = [];
        path.get('children').forEach((childPath: any) => {
          if (childPath.isJSXElement()) {
            childStyleNodes.push(...processJsxElement(childPath));
          }
        });

        if (selector) {
          return [{ selector, children: childStyleNodes }];
        } else {
          return childStyleNodes;
        }
      };

      traverse(ast, {
        JSXElement(path: any) {
          if (!path.parentPath.isJSXElement() && !path.parentPath.isJSXFragment()) {
            rootNodes.push(...processJsxElement(path));
          }
        },
      });
    } catch (e) {
      console.error('JSX Parse Error:', e);
    }
    return rootNodes;
  }

  private static generateScss(nodes: StyleNode[], level = 0): string {
    const indent = '  '.repeat(level);
    let result = '';

    nodes.forEach((node) => {
      result += `${indent}${node.selector} {\n`;
      if (node.children.length > 0) {
        result += this.generateScss(node.children, level + 1);
      }
      result += `${indent}}\n`;
    });

    return result;
  }
}