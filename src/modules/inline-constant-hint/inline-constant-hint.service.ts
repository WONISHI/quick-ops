import * as vscode from 'vscode';

export interface InlineConstantHintEntry {
  /**
   * 匹配文本：
   * - 常量：STATUS_SUCCESS
   * - 枚举/对象成员：Status.Success / STATUS_MAP.SUCCESS
   */
  name: string;

  /**
   * 展示值：
   * - "success"
   * - 1
   * - true
   */
  value: string;

  /**
   * 来源类型
   */
  kind: 'const' | 'enum' | 'object';

  /**
   * 声明所在行，避免在声明行重复提示
   */
  declarationLine: number;
}

interface DocumentCache {
  version: number;
  entries: InlineConstantHintEntry[];
}

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

    await config.update(
      'inlineConstantHint.enabled',
      !current,
      vscode.ConfigurationTarget.Global,
    );

    vscode.window.showInformationMessage(
      !current ? '已开启常量行内提示' : '已关闭常量行内提示',
    );
  }

  public getMaxHintsPerDocument(): number {
    const config = vscode.workspace.getConfiguration('quick-ops');

    return config.get<number>('inlineConstantHint.maxHintsPerDocument', 500);
  }

  public getSupportedLanguages(): string[] {
    return [
      'javascript',
      'typescript',
      'javascriptreact',
      'typescriptreact',
      'vue',
    ];
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

  private parseConstLiteralEntries(
    document: vscode.TextDocument,
    text: string,
  ): InlineConstantHintEntry[] {
    const entries: InlineConstantHintEntry[] = [];

    /**
     * 支持：
     * const A = 'xxx'
     * export const A = 1
     * const A: string = 'xxx'
     * const A = true as const
     */
    const reg =
      /(?:export\s+)?const\s+([A-Z_$][A-Z0-9_$]*)\s*(?::[^=]+)?=\s*([^;\n]+)/g;

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

  private parseEnumEntries(
    document: vscode.TextDocument,
    text: string,
  ): InlineConstantHintEntry[] {
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

      const memberReg =
        /([A-Za-z_$][\w$]*)\s*(?:=\s*([^,\n]+))?\s*(?:,|$)/g;

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

  private parseObjectConstEntries(
    document: vscode.TextDocument,
    text: string,
  ): InlineConstantHintEntry[] {
    const entries: InlineConstantHintEntry[] = [];

    /**
     * 支持：
     * const STATUS_MAP = {
     *   SUCCESS: 'success',
     *   FAILED: 0,
     * } as const
     */
    const objectReg =
      /(?:export\s+)?const\s+([A-Z_$][A-Z0-9_$]*)\s*=\s*\{([\s\S]*?)\}\s*(?:as\s+const)?/g;

    let objectMatch: RegExpExecArray | null;

    while ((objectMatch = objectReg.exec(text))) {
      const objectName = objectMatch[1];
      const objectBody = objectMatch[2];
      const objectStartIndex = objectMatch.index;
      const bodyStartIndex = text.indexOf('{', objectStartIndex) + 1;

      const propReg =
        /(?:["']?)([A-Za-z_$][\w$-]*)(?:["']?)\s*:\s*([^,\n}]+)/g;

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
     * 只显示简单字面量，避免把复杂表达式塞到提示里。
     */
    const stringMatch = value.match(/^(['"`])([\s\S]*?)\1$/);

    if (stringMatch) {
      return JSON.stringify(stringMatch[2]);
    }

    if (/^-?\d+(\.\d+)?$/.test(value)) {
      return value;
    }

    if (/^(true|false|null|undefined)$/.test(value)) {
      return value;
    }

    return '';
  }

  private stripBlockComments(text: string): string {
    return text.replace(/\/\*[\s\S]*?\*\//g, match => {
      return ' '.repeat(match.length);
    });
  }

  private dedupeEntries(
    entries: InlineConstantHintEntry[],
  ): InlineConstantHintEntry[] {
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