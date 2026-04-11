import * as vscode from 'vscode';
import { debounce } from 'lodash-es';
import { IFeature } from '../core/interfaces/IFeature';
import { ConfigurationService } from '../services/ConfigurationService';
import type { MarkStyle } from '../core/types/mark-style';
import ColorLog from '../utils/ColorLog';

type DecorationPair = {
  text: vscode.TextEditorDecorationType;
};

export class MarkDecorationFeature implements IFeature {
  public readonly id = 'MarkDecorationFeature';

  private decorationTypes = new Map<string, DecorationPair>();
  private markRegex: RegExp | null = null;
  private marksConfigCache: Record<string, MarkStyle> = {};

  private readonly commentPatterns: RegExp[] = [
    /\/\/\s*$/,
    /\/\*\s*$/,
    /\*\s*$/,
    /<!--\s*$/,
    /#\s*$/,
    /\{\/\*\s*$/,
  ];

  private readonly debouncedUpdateDecorations = debounce(() => {
    this.triggerUpdateDecorations();
  }, 80);

  constructor(
    private configService: ConfigurationService = ConfigurationService.getInstance(),
  ) { }

  public activate(context: vscode.ExtensionContext): void {
    void this.reloadDecorations();

    context.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) {
          this.debouncedUpdateDecorations();
        }
      }),

      vscode.workspace.onDidChangeTextDocument((event) => {
        const editor = vscode.window.activeTextEditor;
        if (editor && event.document === editor.document) {
          this.debouncedUpdateDecorations();
        }
      }),
    );

    this.configService.on('configChanged', () => {
      void this.reloadDecorations();
      this.debouncedUpdateDecorations();
    });

    this.registerCompletionProvider(context);

    ColorLog.black(`[${this.id}]`, 'Activated.');
  }

  /**
   * 注册补全
   */
  private registerCompletionProvider(context: vscode.ExtensionContext): void {
    const selector: vscode.DocumentSelector = [
      'javascript',
      'typescript',
      'vue',
      'javascriptreact',
      'typescriptreact',
      'java',
      'c',
      'cpp',
      'go',
      'python',
      'html',
      'xml',
      'blade',
      'php',
      'jsx',
      'tsx',
      'markdown',
      'mdx',
      'shellscript',
      'yaml',
    ];

    const provider = vscode.languages.registerCompletionItemProvider(
      selector,
      {
        provideCompletionItems: (document, position) =>
          this.provideMarkCompletions(document, position),
      },
      '@',
    );

    context.subscriptions.push(provider);
  }

  /**
   * 补全逻辑
   */
  private provideMarkCompletions(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.CompletionItem[] | undefined {
    const lineText = document.lineAt(position).text;
    const prefix = lineText.substring(0, position.character);

    const atIndex = prefix.lastIndexOf('@');
    if (atIndex === -1) return;

    const beforeAt = prefix.substring(0, atIndex);

    if (!this.isValidCommentStart(beforeAt)) return;

    const replaceRange = new vscode.Range(
      position.line,
      atIndex,
      position.line,
      position.character,
    );

    return Object.keys(this.marksConfigCache).map((markText) => {
      const item = new vscode.CompletionItem(
        {
          label: markText,
          description: `quick-ops/${markText}`,
        },
        vscode.CompletionItemKind.Color,
      );

      item.detail = `Mark: ${markText}:`;
      item.range = replaceRange;
      item.insertText = `${markText}: `;
      item.sortText = '!';

      return item;
    });
  }

  /**
   * 重建 Decoration
   */
  private async reloadDecorations(): Promise<void> {
    this.disposeDecorations();

    this.marksConfigCache = this.getMarksConfig();

    for (const [markText, style] of Object.entries(this.marksConfigCache)) {
      const textDecoration = vscode.window.createTextEditorDecorationType({
        backgroundColor: style.backgroundColor,
        color: style.color || '#fff',
        fontWeight: style.fontWeight || '800',
        letterSpacing: '0.15px',
        borderRadius: style.borderRadius || '6px',
        textDecoration: `
          none;
          padding: 1px 6px;
        `,
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedOpen,
      });

      this.decorationTypes.set(markText, {
        text: textDecoration,
      });
    }

    this.buildMarkRegex();
    this.triggerUpdateDecorations();
  }

  /**
   * 更新 Decorations
   */
  private triggerUpdateDecorations(): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !this.markRegex) return;

    const document = editor.document;
    const text = document.getText();

    const rangesMap: Record<string, vscode.Range[]> = {};

    for (const key of Object.keys(this.marksConfigCache)) {
      rangesMap[key] = [];
    }

    this.markRegex.lastIndex = 0;

    let match: RegExpExecArray | null;

    while ((match = this.markRegex.exec(text))) {
      const matchedText = match[0];
      const markKey = matchedText.slice(0, -1);

      const startPos = document.positionAt(match.index);

      const lineText = document.lineAt(startPos.line).text;
      const beforeMatch = lineText.substring(0, startPos.character);

      if (!this.isValidCommentStart(beforeMatch)) continue;

      rangesMap[markKey].push(
        new vscode.Range(
          startPos,
          document.positionAt(match.index + matchedText.length),
        ),
      );
    }

    for (const [markText, decos] of this.decorationTypes.entries()) {
      editor.setDecorations(
        decos.text,
        rangesMap[markText] || [],
      );
    }
  }

  /**
   * 构建正则
   */
  private buildMarkRegex(): void {
    const keys = Object.keys(this.marksConfigCache);

    if (!keys.length) {
      this.markRegex = null;
      return;
    }

    this.markRegex = new RegExp(
      keys
        .map((k) => this.escapeRegExp(k))
        .sort((a, b) => b.length - a.length)
        .map((k) => `${k}:`)
        .join('|'),
      'g',
    );
  }

  /**
   * 是否处于注释上下文
   */
  private isValidCommentStart(text: string): boolean {
    const trimmed = text.trimEnd();

    if (this.commentPatterns.some((p) => p.test(trimmed))) {
      return true;
    }

    return Math.max(
      trimmed.lastIndexOf('//'),
      trimmed.lastIndexOf('/*'),
      trimmed.lastIndexOf('{/*'),
      trimmed.lastIndexOf('<!--'),
      trimmed.lastIndexOf('#'),
    ) !== -1;
  }

  /**
   * 正则转义
   */
  private escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * 默认 marks 配置
   */
  private getMarksConfig(): Record<string, MarkStyle> {
    const defaultMarks: Record<string, MarkStyle> = {
      '@success': {
        backgroundColor: '#22C55E',
        color: '#FFFFFF',
      },

      '@warning': {
        backgroundColor: '#F59E0B',
        color: '#FFFFFF',
      },

      '@error': {
        backgroundColor: '#EF4444',
        color: '#FFFFFF',
      },

      '@todo': {
        backgroundColor: '#FACC15',
        color: '#111827',
      },

      '@note': {
        backgroundColor: '#06B6D4',
        color: '#FFFFFF',
      },

      '@blocker': {
        backgroundColor: '#B91C1C',
        color: '#FFFFFF',
      },

      '@xxx': {
        backgroundColor: '#9333EA',
        color: '#FFFFFF',
      },
    };

    const userMarks = this.configService.config.project?.marks || {};

    const finalMarks = { ...defaultMarks };

    for (const [key, style] of Object.entries(userMarks)) {
      finalMarks[key] = finalMarks[key]
        ? { ...finalMarks[key], ...style }
        : style;
    }

    return finalMarks;
  }

  /**
   * 销毁
   */
  private disposeDecorations(): void {
    for (const decos of this.decorationTypes.values()) {
      decos.text.dispose();
    }

    this.decorationTypes.clear();
  }

  public deactivate(): void {
    this.debouncedUpdateDecorations.cancel();
    this.disposeDecorations();
  }
}