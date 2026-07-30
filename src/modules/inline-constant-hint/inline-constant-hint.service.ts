import * as vscode from 'vscode';
import type { InlineConstantHintEntry, DocumentCache } from '@modules/inline-constant-hint/inline-constant-hint.type';

export class InlineConstantHintService {
  private readonly cache = new Map<string, DocumentCache>();

  public isEnabled(): boolean {
    const config = vscode.workspace.getConfiguration('quick-ops');

    const directValue = config.get<boolean>('inlineConstantHint.enabled');

    if (typeof directValue === 'boolean') {
      return directValue;
    }

    /**
     * 兼容旧配置路径。
     */
    const oldValue = config.get<boolean>('general.inlineConstantHint');

    if (typeof oldValue === 'boolean') {
      return oldValue;
    }

    return true;
  }

  public async toggleEnabled(): Promise<void> {
    const config = vscode.workspace.getConfiguration('quick-ops');
    const current = this.isEnabled();

    await config.update('inlineConstantHint.enabled', !current, vscode.ConfigurationTarget.Global);

    vscode.window.showInformationMessage(!current ? '已开启常量行内提示' : '已关闭常量行内提示');
  }

  public getMaxHintsPerDocument(): number {
    const config = vscode.workspace.getConfiguration('quick-ops');

    return config.get<number>('inlineConstantHint.maxHintsPerDocument', 500);
  }

  public getSupportedLanguages(): string[] {
    return ['javascript', 'typescript', 'javascriptreact', 'typescriptreact', 'vue'];
  }

  public shouldHandleDocument(document: vscode.TextDocument): boolean {
    if (!this.isEnabled()) return false;

    if (document.uri.scheme !== 'file') return false;

    return this.getSupportedLanguages().includes(document.languageId);
  }

  public getHints(document: vscode.TextDocument): InlineConstantHintEntry[] {
    const cacheKey = document.uri.toString();
    const cached = this.cache.get(cacheKey);

    if (cached && cached.version === document.version) {
      return cached.entries;
    }

    const entries = this.parseDocument(document);

    this.cache.set(cacheKey, {
      version: document.version,
      entries,
    });

    return entries;
  }

  public clearDocumentCache(document: vscode.TextDocument): void {
    this.cache.delete(document.uri.toString());
  }

  public clearCache(): void {
    this.cache.clear();
  }

  public dispose(): void {
    this.clearCache();
  }

  private parseDocument(document: vscode.TextDocument): InlineConstantHintEntry[] {
    const text = document.getText();
    const cleanText = this.stripBlockComments(text);
    const entries: InlineConstantHintEntry[] = [];

    entries.push(...this.parseConstLiteralEntries(document, cleanText));
    entries.push(...this.parseEnumEntries(document, cleanText));
    entries.push(...this.parseObjectConstEntries(document, cleanText));

    return this.dedupeEntries(entries);
  }

  private parseConstLiteralEntries(document: vscode.TextDocument, text: string): InlineConstantHintEntry[] {
    const entries: InlineConstantHintEntry[] = [];

    /**
     * 支持：
     * const A = 'xxx'
     * export const A = 1
     * const A: string = 'xxx'
     * const A = true as const
     */
    const reg = /(?:export\s+)?const\s+([A-Z_$][A-Z0-9_$]*)\s*(?::[^=]+)?=\s*([^;\n]+)/g;

    let match: RegExpExecArray | null;

    while ((match = reg.exec(text))) {
      const name = match[1];
      const rawValue = match[2];

      const value = this.normalizeLiteralValue(rawValue);

      if (!value) continue;

      const position = document.positionAt(match.index);

      entries.push({
        name,
        value,
        kind: 'const',
        declarationLine: position.line,
      });
    }

    return entries;
  }

  private parseEnumEntries(document: vscode.TextDocument, text: string): InlineConstantHintEntry[] {
    const entries: InlineConstantHintEntry[] = [];

    /**
     * 支持：
     * enum Status { Success = 'success', Failed = 0 }
     * export enum Status { ... }
     */
    const enumReg = /(?:export\s+)?enum\s+([A-Za-z_$][\w$]*)\s*\{([\s\S]*?)\}/g;

    let enumMatch: RegExpExecArray | null;

    while ((enumMatch = enumReg.exec(text))) {
      const enumName = enumMatch[1];
      const enumBody = enumMatch[2];
      const enumStartIndex = enumMatch.index;
      const bodyStartIndex = text.indexOf('{', enumStartIndex) + 1;

      let autoNumber = 0;

      const memberReg = /([A-Za-z_$][\w$]*)\s*(?:=\s*([^,\n]+))?\s*(?:,|$)/g;

      let memberMatch: RegExpExecArray | null;

      while ((memberMatch = memberReg.exec(enumBody))) {
        const memberName = memberMatch[1];
        const rawValue = memberMatch[2];

        let value: string;

        if (rawValue !== undefined) {
          const normalizedValue = this.normalizeLiteralValue(rawValue);

          if (!normalizedValue) continue;

          value = normalizedValue;

          const numericValue = Number(normalizedValue);

          if (!Number.isNaN(numericValue)) {
            autoNumber = numericValue + 1;
          }
        } else {
          value = String(autoNumber);
          autoNumber++;
        }

        const absoluteIndex = bodyStartIndex + memberMatch.index;
        const position = document.positionAt(absoluteIndex);

        entries.push({
          name: `${enumName}.${memberName}`,
          value,
          kind: 'enum',
          declarationLine: position.line,
        });
      }
    }

    return entries;
  }

  private parseObjectConstEntries(document: vscode.TextDocument, text: string): InlineConstantHintEntry[] {
    const entries: InlineConstantHintEntry[] = [];

    /**
     * 支持：
     * const STATUS_MAP = {
     *   SUCCESS: 'success',
     *   FAILED: 0,
     * } as const
     */
    const objectReg = /(?:export\s+)?const\s+([A-Z_$][A-Z0-9_$]*)\s*=\s*\{([\s\S]*?)\}\s*(?:as\s+const)?/g;

    let objectMatch: RegExpExecArray | null;

    while ((objectMatch = objectReg.exec(text))) {
      const objectName = objectMatch[1];
      const objectBody = objectMatch[2];
      const objectStartIndex = objectMatch.index;
      const bodyStartIndex = text.indexOf('{', objectStartIndex) + 1;

      const propReg = /(?:["']?)([A-Za-z_$][\w$-]*)(?:["']?)\s*:\s*([^,\n}]+)/g;

      let propMatch: RegExpExecArray | null;

      while ((propMatch = propReg.exec(objectBody))) {
        const propName = propMatch[1];
        const rawValue = propMatch[2];
        const value = this.normalizeLiteralValue(rawValue);

        if (!value) continue;

        const absoluteIndex = bodyStartIndex + propMatch.index;
        const position = document.positionAt(absoluteIndex);

        entries.push({
          name: `${objectName}.${propName}`,
          value,
          kind: 'object',
          declarationLine: position.line,
        });
      }
    }

    return entries;
  }

  private normalizeLiteralValue(rawValue: string): string {
    const value = rawValue
      .trim()
      .replace(/\s+as\s+const\s*$/g, '')
      .replace(/\s+satisfies\s+.+$/g, '')
      .replace(/,$/, '')
      .trim();

    if (!value) return '';

    /**
     * 字符串字面量。
     */
    const stringMatch = value.match(/^(['"`])([\s\S]*?)\1$/);

    if (stringMatch) {
      return JSON.stringify(stringMatch[2]);
    }

    /**
     * 布尔值及空值字面量。
     */
    if (/^(true|false|null|undefined)$/.test(value)) {
      return value;
    }

    /**
     * 数字字面量和纯数字运算表达式。
     *
     * 这里只校验表达式是否合法，不计算最终结果。
     */
    if (this.isNumericExpression(value)) {
      return value;
    }

    return '';
  }

  /**
   * @description 判断是否为合法的纯数字算术表达式
   *
   * 只验证 Token 和运算符结构，不执行任何计算。
   */
  private isNumericExpression(expression: string): boolean {
    const tokens = this.tokenizeNumericExpression(expression);

    if (!tokens) {
      return false;
    }

    let cursor = 0;

    const peek = (): string | undefined => tokens[cursor];

    const consume = (): string | undefined => {
      const token = tokens[cursor];
      cursor += 1;
      return token;
    };

    const parsePrimary = (): boolean => {
      const token = consume();

      if (!token) {
        return false;
      }

      if (token === '(') {
        if (!parseAdditive()) {
          return false;
        }

        return consume() === ')';
      }

      return this.isNumericToken(token);
    };

    const parseUnary = (): boolean => {
      const token = peek();

      if (token === '+' || token === '-') {
        consume();
        return parseUnary();
      }

      return parsePrimary();
    };

    const parsePower = (): boolean => {
      if (!parseUnary()) {
        return false;
      }

      if (peek() === '**') {
        consume();
        return parsePower();
      }

      return true;
    };

    const parseMultiplicative = (): boolean => {
      if (!parsePower()) {
        return false;
      }

      while (peek() === '*' || peek() === '/' || peek() === '%') {
        consume();

        if (!parsePower()) {
          return false;
        }
      }

      return true;
    };

    const parseAdditive = (): boolean => {
      if (!parseMultiplicative()) {
        return false;
      }

      while (peek() === '+' || peek() === '-') {
        consume();

        if (!parseMultiplicative()) {
          return false;
        }
      }

      return true;
    };

    return parseAdditive() && cursor === tokens.length;
  }

  /**
   * @description 将纯数字表达式拆分为安全 Token
   */
  private tokenizeNumericExpression(expression: string): string[] | null {
    const source = expression.replace(/\s+/g, '');

    if (!source) {
      return null;
    }

    const tokenReg =
      /0[xX][0-9a-fA-F](?:_?[0-9a-fA-F])*|0[bB][01](?:_?[01])*|0[oO][0-7](?:_?[0-7])*|(?:\d(?:_?\d)*(?:\.(?:\d(?:_?\d)*)?)?|\.\d(?:_?\d)*)(?:[eE][+-]?\d(?:_?\d)*)?|\*\*|[()+\-*/%]/gy;

    const tokens: string[] = [];
    let index = 0;

    while (index < source.length) {
      tokenReg.lastIndex = index;
      const match = tokenReg.exec(source);

      if (!match || match.index !== index) {
        return null;
      }

      tokens.push(match[0]);
      index = tokenReg.lastIndex;
    }

    return tokens;
  }

  /**
   * @description 判断 Token 是否为数字字面量
   */
  private isNumericToken(token: string): boolean {
    return /^(?:0[xX][0-9a-fA-F](?:_?[0-9a-fA-F])*|0[bB][01](?:_?[01])*|0[oO][0-7](?:_?[0-7])*|(?:\d(?:_?\d)*(?:\.(?:\d(?:_?\d)*)?)?|\.\d(?:_?\d)*)(?:[eE][+-]?\d(?:_?\d)*)?)$/.test(
      token,
    );
  }

  private stripBlockComments(text: string): string {
    return text.replace(/\/\*[\s\S]*?\*\//g, (match) => {
      return ' '.repeat(match.length);
    });
  }

  private dedupeEntries(entries: InlineConstantHintEntry[]): InlineConstantHintEntry[] {
    const map = new Map<string, InlineConstantHintEntry>();

    for (const entry of entries) {
      if (!map.has(entry.name)) {
        map.set(entry.name, entry);
      }
    }

    return Array.from(map.values()).sort((a, b) => {
      return b.name.length - a.name.length;
    });
  }
}
