import * as cheerio from 'cheerio';
import { parse } from '@babel/parser';
import traverse from '@babel/traverse';

interface StyleNode {
  selector: string;
  children: StyleNode[];
}

export class StyleStructureParser {
  static parse(content: string, languageId: string): string {
    let nodes: StyleNode[] = [];

    if (languageId === 'vue' || languageId === 'html') {
      nodes = this.parseHtmlOrVue(content, languageId === 'vue');
    } else if (languageId === 'javascriptreact' || languageId === 'typescriptreact') {
      nodes = this.parseJsx(content);
    }

    if (nodes.length === 0) return '';
    return this.generateScss(nodes);
  }

  private static parseHtmlOrVue(content: string, isVue: boolean): StyleNode[] {
    let htmlContent = content;

    if (isVue) {
      const match = content.match(/<template[^>]*>([\s\S]*?)<\/template>/i);
      htmlContent = match ? match[1] : '';
    }

    if (!htmlContent.trim()) return [];

    // @ts-ignore
    const $ = cheerio.load(htmlContent, { xmlMode: false, decodeEntities: false });
    const rootNodes: StyleNode[] = [];

    // 递归函数：返回当前元素及其子孙生成的节点列表
    // @ts-ignore
    const traverseFlat = (element: cheerio.Element): StyleNode[] => {
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
          .map((c) => `.${c}`)
          .join('');
      }

      // 递归获取所有子节点的 StyleNode
      const childStyleNodes: StyleNode[] = [];
      $el.children().each((_, child) => {
        // @ts-ignore
        childStyleNodes.push(...traverseFlat(child as cheerio.Element));
      });

      if (selector) {
        // 如果当前节点有选择器，它就是一个独立的层级，子节点挂在它下面
        return [{ selector, children: childStyleNodes }];
      } else {
        // 关键逻辑：如果当前节点没有选择器 (如纯div)，直接把子节点向上返回 (扁平化)
        // 这样 .child 就能穿透无样式的父级，被爷爷级捕获
        return childStyleNodes;
      }
    };

    $('body')
      .children()
      .each((_, el) => {
        // @ts-ignore
        rootNodes.push(...traverseFlat(el as cheerio.Element));
      });

    return rootNodes;
  }

  // ==========================================
  // 2. JSX / TSX 解析 (同样支持透传)
  // ==========================================
  private static parseJsx(content: string): StyleNode[] {
    const rootNodes: StyleNode[] = [];
    try {
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
          // 扁平化：没 className 就返回子节点
          return childStyleNodes;
        }
      };

      traverse(ast, {
        JSXElement(path) {
          if (!path.parentPath.isJSXElement() && !path.parentPath.isJSXFragment()) {
            rootNodes.push(...processJsxElement(path));
          }
        },
      });
    } catch (e) {}
    return rootNodes;
  }

  // ==========================================
  // 3. 生成 SCSS
  // ==========================================
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
