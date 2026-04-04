import * as path from 'path';
import * as vscode from 'vscode';
import { debounce } from 'lodash-es';
import { IFeature } from '../core/interfaces/IFeature';
import { ConfigurationService } from '../services/ConfigurationService';
import type { MarkStyle } from '../core/types/mark-style';
import ColorLog from '../utils/ColorLog';

type DecorationPair = {
  line: vscode.TextEditorDecorationType;
  icon: vscode.TextEditorDecorationType;
};

export class MarkDecorationFeature implements IFeature {
  public readonly id = 'MarkDecorationFeature';

  private decorationTypes: Map<string, DecorationPair> = new Map();
  private markRegex: RegExp | null = null;
  private marksConfigCache: Record<string, MarkStyle> = {};
  private extensionContext!: vscode.ExtensionContext;

  /**
   * 判断 @mark 前面最近是否是注释起始
   */
  private readonly commentPatterns: RegExp[] = [
    /\/\/\s*$/,   // //
    /\/\*\s*$/,   // /*
    /\*\s*$/,     // * (块注释中间行)
    /<!--\s*$/,   // <!--
    /#\s*$/,      // # (python/shell/yaml)
    /\{\/\*\s*$/, // {/* (JSX / TSX)
  ];

  private readonly debouncedUpdateDecorations = debounce(() => {
    this.triggerUpdateDecorations();
  }, 100);

  constructor(
    private configService: ConfigurationService = ConfigurationService.getInstance(),
  ) { }

  public activate(context: vscode.ExtensionContext): void {
    this.extensionContext = context;

    void this.reloadDecorations();

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
      void this.reloadDecorations();
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

    const replaceRange = new vscode.Range(
      position.line,
      atIndex,
      position.line,
      position.character,
    );

    const items: vscode.CompletionItem[] = [];

    for (const [markText, style] of Object.entries(this.marksConfigCache)) {
      const label: vscode.CompletionItemLabel = {
        label: markText,
        description: `quick-ops/${markText}`,
      };

      const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Color);

      item.detail = `Mark: ${markText}:`;
      item.documentation = new vscode.MarkdownString(
        `Preview: **${markText}:**\n\nColor: ${style.color || style.backgroundColor || '#007acc'}`,
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
   * 重载 decorations + 预编译正则
   */
  private async reloadDecorations(): Promise<void> {
    this.disposeDecorations();

    this.marksConfigCache = this.getMarksConfig();

    for (const [text, style] of Object.entries(this.marksConfigCache)) {
      const targetColor = style.color || '#ffffff';
      const iconUri = await this.resolveIconUri(style.gutterIconPath, targetColor);

      /**
       * 注释块本身高亮（不是整行）
       */
      const lineDecoration = vscode.window.createTextEditorDecorationType({
        isWholeLine: false,
        backgroundColor: style.wholeLineBackgroundColor || style.backgroundColor || 'rgba(0,122,204,0.12)',
        color: style.color || '#ffffff',
        fontWeight: style.fontWeight || '700',
        borderRadius: style.borderRadius || '6px',
        border: `1px solid ${style.borderColor || style.backgroundColor || 'rgba(0,122,204,0.35)'}`,
        overviewRulerColor: style.backgroundColor || '#007acc',
        overviewRulerLane: vscode.OverviewRulerLane.Right,
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
      });

      /**
       * 图标放在 @ 前面
       */
      const iconDecoration = vscode.window.createTextEditorDecorationType({
        before: iconUri ? {
          contentIconPath: iconUri,
          margin: '0 0.3em 0 0',
          textDecoration: 'none; vertical-align: -16%;',
        } : undefined,
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
      });

      this.decorationTypes.set(text, {
        line: lineDecoration,
        icon: iconDecoration,
      });
    }

    this.buildMarkRegex();

    /**
     * icon 异步处理后主动刷新
     */
    this.triggerUpdateDecorations();
  }

  /**
   * 单次扫描高亮逻辑
   */
  private triggerUpdateDecorations(): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !this.markRegex) return;

    const document = editor.document;
    const text = document.getText();

    const rangesMap: Record<string, { lineRanges: vscode.Range[]; iconRanges: vscode.Range[] }> = {};

    for (const markText of Object.keys(this.marksConfigCache)) {
      rangesMap[markText] = {
        lineRanges: [],
        iconRanges: [],
      };
    }

    this.markRegex.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = this.markRegex.exec(text))) {
      const matchedText = match[0] as string; // "@todo:"
      const markKey = matchedText.slice(0, -1); // "@todo"

      const startPos = document.positionAt(match.index);
      const line = startPos.line;
      const lineText = document.lineAt(line).text;
      const textBeforeMatch = lineText.substring(0, startPos.character);

      if (!this.isValidCommentStart(textBeforeMatch)) {
        continue;
      }

      /**
       * 只高亮当前注释片段，而不是整行
       */
      const commentRange = this.getCommentRange(lineText, line, startPos.character);
      if (!commentRange) {
        continue;
      }

      /**
       * 图标定位在 @ 前面
       */
      const iconRange = new vscode.Range(startPos, startPos);

      if (!rangesMap[markKey]) {
        rangesMap[markKey] = {
          lineRanges: [],
          iconRanges: [],
        };
      }

      rangesMap[markKey].lineRanges.push(commentRange);
      rangesMap[markKey].iconRanges.push(iconRange);
    }

    for (const [markText, decos] of this.decorationTypes.entries()) {
      editor.setDecorations(decos.line, rangesMap[markText]?.lineRanges || []);
      editor.setDecorations(decos.icon, rangesMap[markText]?.iconRanges || []);
    }
  }

  /**
   * 获取当前 mark 所在“注释片段范围”
   *
   * 支持：
   * 1. // ...
   * 2. # ...
   * 3. block comment
   * 4. jsx block comment
   * 5. <!-- ... -->
   * 6. * 中间行
   */
  private getCommentRange(
    lineText: string,
    line: number,
    markStartChar: number,
  ): vscode.Range | null {
    const before = lineText.slice(0, markStartChar);
    const after = lineText.slice(markStartChar);
    const jsxStart = before.lastIndexOf('{/*');
    const jsxEndRelative = after.indexOf('*/}');
    if (jsxStart !== -1 && jsxEndRelative !== -1) {
      const jsxEnd = markStartChar + jsxEndRelative + 3;
      return new vscode.Range(
        new vscode.Position(line, jsxStart),
        new vscode.Position(line, jsxEnd),
      );
    }


    const blockStart = before.lastIndexOf('/*');
    const blockEndRelative = after.indexOf('*/');
    if (blockStart !== -1 && blockEndRelative !== -1) {
      const blockEnd = markStartChar + blockEndRelative + 2;
      return new vscode.Range(
        new vscode.Position(line, blockStart),
        new vscode.Position(line, blockEnd),
      );
    }

    /**
     * 3) HTML 注释：<!-- ... -->
     */
    const htmlStart = before.lastIndexOf('<!--');
    const htmlEndRelative = after.indexOf('-->');
    if (htmlStart !== -1 && htmlEndRelative !== -1) {
      const htmlEnd = markStartChar + htmlEndRelative + 3;
      return new vscode.Range(
        new vscode.Position(line, htmlStart),
        new vscode.Position(line, htmlEnd),
      );
    }

    /**
     * 4) 单行注释：// ...
     */
    const slashStart = before.lastIndexOf('//');
    if (slashStart !== -1) {
      return new vscode.Range(
        new vscode.Position(line, slashStart),
        new vscode.Position(line, lineText.length),
      );
    }

    /**
     * 5) shell / python / yaml：# ...
     */
    const hashStart = before.lastIndexOf('#');
    if (hashStart !== -1) {
      return new vscode.Range(
        new vscode.Position(line, hashStart),
        new vscode.Position(line, lineText.length),
      );
    }

    /**
     * 6) 块注释中间行： * @todo:
     */
    const starMatch = lineText.match(/^\s*\*/);
    if (starMatch) {
      const starIndex = lineText.indexOf('*');
      return new vscode.Range(
        new vscode.Position(line, starIndex),
        new vscode.Position(line, lineText.length),
      );
    }

    return null;
  }

  /**
   * 构建 mark 正则
   */
  private buildMarkRegex(): void {
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
   * 判断当前位置前面是否处于“注释上下文”
   */
  private isValidCommentStart(text: string): boolean {
    const trimmed = text.trimEnd();

    if (this.commentPatterns.some((pattern) => pattern.test(trimmed))) {
      return true;
    }

    const lastDoubleSlash = trimmed.lastIndexOf('//');
    const lastBlock = trimmed.lastIndexOf('/*');
    const lastJsxBlock = trimmed.lastIndexOf('{/*');
    const lastHtml = trimmed.lastIndexOf('<!--');
    const lastHash = trimmed.lastIndexOf('#');

    const lastCommentStart = Math.max(
      lastDoubleSlash,
      lastBlock,
      lastJsxBlock,
      lastHtml,
      lastHash,
    );

    return lastCommentStart !== -1;
  }

  /**
   * 正则转义
   */
  private escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * 动态解析图标 URI，并染色 SVG
   */
  private async resolveIconUri(
    iconPath: string | undefined,
    targetColor: string,
  ): Promise<vscode.Uri | undefined> {
    if (!iconPath) return undefined;

    let fileUri: vscode.Uri;
    if (path.isAbsolute(iconPath)) {
      fileUri = vscode.Uri.file(iconPath);
    } else {
      fileUri = vscode.Uri.joinPath(this.extensionContext.extensionUri, iconPath);
    }

    try {
      const fileData = await vscode.workspace.fs.readFile(fileUri);
      let svgContent = new TextDecoder().decode(fileData);

      /**
       * 染色：
       * - stroke="..."
       * - fill="currentColor"
       * - fill="#xxxxxx"
       * - fill="rgb(...)"
       * - fill="rgba(...)"
       */
      svgContent = svgContent.replace(/stroke="[^"]+"/g, `stroke="${targetColor}"`);
      svgContent = svgContent.replace(/fill="currentColor"/g, `fill="${targetColor}"`);
      svgContent = svgContent.replace(
        /fill="(#[^"]+|rgb\([^)]+\)|rgba\([^)]+\))"/g,
        `fill="${targetColor}"`,
      );

      /**
       * 强制尺寸
       */
      const targetSize = '14';
      if (svgContent.includes('width=')) {
        svgContent = svgContent.replace(/width="[^"]+"/, `width="${targetSize}"`);
        svgContent = svgContent.replace(/height="[^"]+"/, `height="${targetSize}"`);
      } else {
        svgContent = svgContent.replace('<svg ', `<svg width="${targetSize}" height="${targetSize}" `);
      }

      const encodedSvg = encodeURIComponent(svgContent);
      return vscode.Uri.parse(`data:image/svg+xml;utf8,${encodedSvg}`);
    } catch (e) {
      console.error('动态处理 SVG 失败或文件不存在', e);
      return fileUri;
    }
  }

  /**
   * 获取 marks 配置
   */
  private getMarksConfig(): Record<string, MarkStyle> {
    const defaultMarks: Record<string, MarkStyle> = {
      '@success': {
        backgroundColor: 'rgba(34, 197, 94, 0.16)',
        borderColor: 'rgba(34, 197, 94, 0.42)',
        color: '#4ade80',
        borderRadius: '4px',
        fontWeight: '900',
        gutterIconPath: 'resources/icons/success.svg',
      },
      '@warning': {
        backgroundColor: 'rgba(245, 158, 11, 0.16)',
        borderColor: 'rgba(245, 158, 11, 0.42)',
        color: '#fbbf24',
        borderRadius: '4px',
        fontWeight: '900',
        gutterIconPath: 'resources/icons/warning.svg',
      },
      '@error': {
        backgroundColor: 'rgba(239, 68, 68, 0.16)',
        borderColor: 'rgba(239, 68, 68, 0.42)',
        color: '#f87171',
        borderRadius: '4px',
        fontWeight: '900',
        gutterIconPath: 'resources/icons/error.svg',
      },
      '@todo': {
        backgroundColor: 'rgba(56, 189, 248, 0.16)',
        borderColor: 'rgba(56, 189, 248, 0.42)',
        color: '#38bdf8',
        borderRadius: '4px',
        fontWeight: '900',
        gutterIconPath: 'resources/icons/todo.svg',
      },
      '@note': {
        backgroundColor: 'rgba(6, 182, 212, 0.16)',
        borderColor: 'rgba(6, 182, 212, 0.42)',
        color: '#22d3ee',
        borderRadius: '4px',
        fontWeight: '900',
        gutterIconPath: 'resources/icons/note.svg',
      },
      '@blocker': {
        backgroundColor: 'rgba(244, 63, 94, 0.18)',
        borderColor: 'rgba(244, 63, 94, 0.5)',
        color: '#fb7185',
        borderRadius: '4px',
        fontWeight: '900',
        gutterIconPath: 'resources/icons/blocker.svg',
      },
      '@xxx': {
        backgroundColor: 'rgba(168, 85, 247, 0.16)',
        borderColor: 'rgba(168, 85, 247, 0.42)',
        color: '#c084fc',
        borderRadius: '4px',
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

  /**
   * 销毁 decorations
   */
  private disposeDecorations(): void {
    for (const decos of this.decorationTypes.values()) {
      decos.line.dispose();
      decos.icon.dispose();
    }
    this.decorationTypes.clear();
  }

  public deactivate(): void {
    this.debouncedUpdateDecorations.cancel();
    this.disposeDecorations();
  }
}