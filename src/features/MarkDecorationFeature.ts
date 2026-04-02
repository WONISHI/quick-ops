import * as path from 'path';
import * as vscode from 'vscode';
import { debounce } from 'lodash-es';
import { IFeature } from '../core/interfaces/IFeature';
import { ConfigurationService } from '../services/ConfigurationService';
import type { MarkStyle } from '../core/types/mark-style';
import ColorLog from '../utils/ColorLog';

export class MarkDecorationFeature implements IFeature {
  public readonly id = 'MarkDecorationFeature';

  private decorationTypes: Map<string, vscode.TextEditorDecorationType> = new Map();
  private markRegex: RegExp | null = null;
  private marksConfigCache: Record<string, MarkStyle> = {};
  private extensionContext!: vscode.ExtensionContext;

  private readonly commentPatterns: RegExp[] = [
    /^\s*\/\/\s*$/, // //
    /^\s*\*\s*$/, // *
    /^\s*\/\*\s*$/, // /*
    /^\s*<!--\s*$/, // <!--
    /^\s*#\s*$/, // # (python/shell)
  ];

  private readonly debouncedUpdateDecorations = debounce(() => {
    this.triggerUpdateDecorations();
  }, 100);

  constructor(private configService: ConfigurationService = ConfigurationService.getInstance()) { }

  public activate(context: vscode.ExtensionContext): void {
    this.extensionContext = context;

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
      'shellscript',
      'yaml',
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
        isWholeLine: true,

        /**
         * 整行荧光背景
         */
        backgroundColor: style.wholeLineBackgroundColor || style.backgroundColor || 'rgba(0,122,204,0.12)',

        /**
         * 文字样式
         */
        color: style.color || '#ffffff',
        fontWeight: style.fontWeight || '600',

        /**
         * 圆角 + 边框 + 左侧强调线
         */
        borderRadius: style.borderRadius || '8px',
        border: `1px solid ${style.borderColor || style.backgroundColor || 'rgba(0,122,204,0.35)'}`,

        /**
         * 右侧 overview ruler
         */
        overviewRulerColor: style.backgroundColor || '#007acc',
        overviewRulerLane: vscode.OverviewRulerLane.Right,

        rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,

        /**
         * 左侧 gutter 图标
         */
        gutterIconPath: this.resolveGutterIcon(style.gutterIconPath),
        gutterIconSize: '18px',

        /**
         * 行前加一点内边距视觉效果
         */
        before: {
          contentText: '',
          margin: '0 0 0 4px',
        },
      });

      this.decorationTypes.set(text, decorationType);
    }

    this.buildMarkRegex();
  }

  /**
   * 单次扫描高亮逻辑（整行高亮）
   */
  private triggerUpdateDecorations() {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !this.markRegex) return;

    const document = editor.document;
    const text = document.getText();

    const rangesMap: Record<string, vscode.Range[]> = {};

    for (const markText of Object.keys(this.marksConfigCache)) {
      rangesMap[markText] = [];
    }

    this.markRegex.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = this.markRegex.exec(text))) {
      const matchedText = match[0] as string; // 例如 "@todo:"
      const markKey = matchedText.slice(0, -1); // @todo

      const startPos = document.positionAt(match.index);
      const line = startPos.line;
      const lineText = document.lineAt(line).text;
      const textBeforeMatch = lineText.substring(0, startPos.character);

      if (!this.isValidCommentStart(textBeforeMatch)) {
        continue;
      }

      /**
       * 关键：整行高亮，而不是只高亮 @todo:
       */
      const fullLineRange = new vscode.Range(
        new vscode.Position(line, 0),
        new vscode.Position(line, lineText.length),
      );

      if (!rangesMap[markKey]) {
        rangesMap[markKey] = [];
      }

      rangesMap[markKey].push(fullLineRange);
    }

    for (const [markText, decorationType] of this.decorationTypes.entries()) {
      editor.setDecorations(decorationType, rangesMap[markText] || []);
    }
  }

  /**
   * 构建单次扫描正则
   */
  private buildMarkRegex() {
    const markKeys = Object.keys(this.marksConfigCache);

    if (!markKeys.length) {
      this.markRegex = null;
      return;
    }

    const pattern = markKeys
      .map((mark) => this.escapeRegExp(mark))
      .sort((a, b) => b.length - a.length)
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

  /**
   * 解析 gutter 图标路径
   */
  private resolveGutterIcon(iconPath?: string): string | undefined {
    if (!iconPath) return undefined;

    if (path.isAbsolute(iconPath)) {
      return iconPath;
    }

    return path.join(this.extensionContext.extensionPath, iconPath);
  }

  private getMarksConfig(): Record<string, MarkStyle> {
    const defaultMarks: Record<string, MarkStyle> = {
      // 已完成 (荧光青绿)
      '@success': {
        backgroundColor: 'rgba(52, 211, 153, 0.15)',
        borderColor: 'rgba(52, 211, 153, 0.4)',
        color: '#34d399', 
        borderRadius: '3px',
        fontWeight: '900',
        gutterIconPath: 'resources/icons/success.svg',
      },
      // 风险提醒 (亮金橙)
      '@warning': {
        backgroundColor: 'rgba(251, 191, 36, 0.15)',
        borderColor: 'rgba(251, 191, 36, 0.4)',
        color: '#fbbf24', 
        borderRadius: '3px',
        fontWeight: '900',
        gutterIconPath: 'resources/icons/warning.svg',
      },
      // 明确问题 (纯粹霓虹红 - 鲜明警告)
      '@error': {
        backgroundColor: 'rgba(255, 42, 42, 0.15)',
        borderColor: 'rgba(255, 42, 42, 0.4)',
        color: '#ff2a2a', // 纯正亮红色
        borderRadius: '3px',
        fontWeight: '900',
        gutterIconPath: 'resources/icons/error.svg',
      },
      // 待办 (亮天蓝)
      '@todo': {
        backgroundColor: 'rgba(56, 189, 248, 0.15)',
        borderColor: 'rgba(56, 189, 248, 0.4)',
        color: '#38bdf8', 
        borderRadius: '3px',
        fontWeight: '900',
        gutterIconPath: 'resources/icons/todo.svg',
      },
      // 说明 / 备注 (高饱和荧光青 - 极高亮度和清晰度)
      '@note': {
        backgroundColor: 'rgba(0, 229, 255, 0.15)',
        borderColor: 'rgba(0, 229, 255, 0.4)',
        color: '#00e5ff', // 荧光青/青松色，彻底摆脱发虚的问题
        borderRadius: '3px',
        fontWeight: '900',
        gutterIconPath: 'resources/icons/note.svg',
      },
      // 阻塞项 (致命电音紫红/亮洋红 - 与 Error 形成强烈反差)
      '@blocker': {
        backgroundColor: 'rgba(240, 24, 255, 0.15)',
        borderColor: 'rgba(240, 24, 255, 0.5)',
        color: '#f018ff', // 高亮洋红色，极具视觉冲击力
        borderRadius: '3px',
        fontWeight: '900',
        gutterIconPath: 'resources/icons/blocker.svg',
      },
      // 有待确认 (电音紫)
      '@xxx': {
        backgroundColor: 'rgba(167, 139, 250, 0.15)',
        borderColor: 'rgba(167, 139, 250, 0.4)',
        color: '#a78bfa', 
        borderRadius: '3px',
        fontWeight: '900',
        gutterIconPath: 'resources/icons/xxx.svg',
      },
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