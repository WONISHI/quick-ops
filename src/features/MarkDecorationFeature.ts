import * as vscode from 'vscode';
import { debounce } from 'lodash-es';
import { IFeature } from '../core/interfaces/IFeature';
import { ConfigurationService } from '../services/ConfigurationService';
import type { MarkStyle } from '../core/types/mark-style';
import ColorLog from '../utils/ColorLog';

export class MarkDecorationFeature implements IFeature {
  public readonly id = 'MarkDecorationFeature';

  private decorationTypes: Map<string, vscode.TextEditorDecorationType> = new Map();

  /**
   * 单次扫描使用的大正则：
   * 例如 /(@success:|@warning:|@error:|@todo:)/g
   */
  private markRegex: RegExp | null = null;

  /**
   * 当前 marks 缓存，避免频繁重新 getMarksConfig
   */
  private marksConfigCache: Record<string, MarkStyle> = {};

  /**
   * 注释前缀校验正则（复用）
   */
  private readonly commentPatterns: RegExp[] = [
    /^\s*\/\/\s*$/, // // 
    /^\s*\*\s*$/, // *
    /^\s*\/\*\s*$/, // /*
    /^\s*<!--\s*$/, // <!--
  ];

  /**
   * 防抖更新（避免频繁触发）
   */
  private readonly debouncedUpdateDecorations = debounce(() => {
    this.triggerUpdateDecorations();
  }, 100);

  constructor(private configService: ConfigurationService = ConfigurationService.getInstance()) {}

  public activate(context: vscode.ExtensionContext): void {
    this.reloadDecorations();

    if (vscode.window.activeTextEditor) {
      this.triggerUpdateDecorations();
    }

    context.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) {
          this.debouncedUpdateDecorations();
        }
      }),
    );

    context.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument((event) => {
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor && event.document === activeEditor.document) {
          this.debouncedUpdateDecorations();
        }
      }),
    );

    this.configService.on('configChanged', () => {
      this.reloadDecorations();
      this.debouncedUpdateDecorations();
    });

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
      'vue-html',
      'blade',
      'php',
      'jsx',
      'tsx',
      'markdown',
      'mdx',
    ];

    const completionProvider = vscode.languages.registerCompletionItemProvider(
      selector,
      {
        provideCompletionItems: (document, position) => {
          return this.provideMarkCompletions(document, position);
        },
      },
      '@',
    );

    context.subscriptions.push(
      completionProvider,
      {
        dispose: () => {
          this.debouncedUpdateDecorations.cancel();
        },
      },
    );

    ColorLog.black(`[${this.id}]`, 'Activated.');
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
    if (atIndex === -1) return undefined;

    const textBeforeAt = prefix.substring(0, atIndex);

    if (!this.isValidCommentStart(textBeforeAt)) {
      return undefined;
    }

    const replaceRange = new vscode.Range(position.line, atIndex, position.line, position.character);
    const items: vscode.CompletionItem[] = [];

    for (const [markText, style] of Object.entries(this.marksConfigCache)) {
      const label: vscode.CompletionItemLabel = {
        label: markText,
        description: `quick-ops/${markText}`,
      };

      const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Color);

      item.detail = `Mark: ${markText}:`;
      item.documentation = new vscode.MarkdownString(
        `Preview: **${markText}:**\n\nColor: ${style.backgroundColor || '#007acc'}`,
      );
      item.sortText = '!';
      item.range = replaceRange;
      item.filterText = markText;
      item.insertText = `${markText}: `;

      items.push(item);
    }

    return items;
  }

  /**
   * 重载 decorations + 预编译 mark 正则
   */
  private reloadDecorations() {
    this.disposeDecorations();

    this.marksConfigCache = this.getMarksConfig();

    for (const [text, style] of Object.entries(this.marksConfigCache)) {
      const decorationType = vscode.window.createTextEditorDecorationType({
        color: style.color || '#ffffff',
        backgroundColor: style.backgroundColor || '#007acc',
        borderRadius: style.borderRadius || '3px',
        fontWeight: style.fontWeight || 'bold',
        overviewRulerColor: style.backgroundColor,
        overviewRulerLane: vscode.OverviewRulerLane.Right,
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
      });

      this.decorationTypes.set(text, decorationType);
    }

    this.buildMarkRegex();
  }

  /**
   * 单次扫描高亮逻辑（核心优化）
   */
  private triggerUpdateDecorations() {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !this.markRegex) return;

    const document = editor.document;
    const text = document.getText();

    /**
     * 每个 mark 对应自己的 range 数组
     */
    const rangesMap: Record<string, vscode.Range[]> = {};

    for (const markText of Object.keys(this.marksConfigCache)) {
      rangesMap[markText] = [];
    }

    this.markRegex.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = this.markRegex.exec(text))) {
      const matchedText = match[0] as string; // 例如 "@success:"
      const markKey = matchedText.slice(0, -1); // 去掉 ":" => "@success"

      const startPos = document.positionAt(match.index);
      const endPos = document.positionAt(match.index + matchedText.length);
      const lineText = document.lineAt(startPos.line).text;
      const textBeforeMatch = lineText.substring(0, startPos.character);

      if (!this.isValidCommentStart(textBeforeMatch)) {
        continue;
      }

      if (!rangesMap[markKey]) {
        rangesMap[markKey] = [];
      }

      rangesMap[markKey].push(new vscode.Range(startPos, endPos));
    }

    for (const [markText, decorationType] of this.decorationTypes.entries()) {
      editor.setDecorations(decorationType, rangesMap[markText] || []);
    }
  }

  /**
   * 构建单次扫描正则
   * 例如 /(@success:|@warning:|@error:|@todo:)/g
   */
  private buildMarkRegex() {
    const markKeys = Object.keys(this.marksConfigCache);

    if (!markKeys.length) {
      this.markRegex = null;
      return;
    }

    const pattern = markKeys
      .map((mark) => this.escapeRegExp(mark))
      .sort((a, b) => b.length - a.length) // 长的优先，避免前缀冲突
      .map((mark) => `${mark}:`)
      .join('|');

    this.markRegex = new RegExp(pattern, 'g');
  }

  /**
   * 校验是否是合法注释开头
   */
  private isValidCommentStart(text: string): boolean {
    return this.commentPatterns.some((pattern) => pattern.test(text));
  }

  /**
   * 正则转义
   */
  private escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private getMarksConfig(): Record<string, MarkStyle> {
    const defaultMarks: Record<string, MarkStyle> = {
      '@success': { backgroundColor: '#4caf50', color: '#ffffff', borderRadius: '4px', fontWeight: 'bold' },
      '@warning': { backgroundColor: '#ff9800', color: '#ffffff', borderRadius: '4px', fontWeight: 'bold' },
      '@error': { backgroundColor: '#f44336', color: '#ffffff', borderRadius: '4px', fontWeight: 'bold' },
      '@todo': { backgroundColor: '#ffeb3b', color: '#333333', borderRadius: '4px', fontWeight: 'bold' },
    };

    const userMarks = this.configService.config.project?.marks || {};
    const finalMarks: Record<string, MarkStyle> = { ...defaultMarks };

    for (const [key, userStyle] of Object.entries(userMarks)) {
      if (finalMarks[key]) {
        finalMarks[key] = { ...finalMarks[key], ...userStyle };
      } else {
        finalMarks[key] = userStyle;
      }
    }

    return finalMarks;
  }

  private disposeDecorations() {
    for (const decoration of this.decorationTypes.values()) {
      decoration.dispose();
    }
    this.decorationTypes.clear();
  }

  public deactivate() {
    this.debouncedUpdateDecorations.cancel();
    this.disposeDecorations();
  }
}