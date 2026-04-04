import * as path from 'path';
import * as vscode from 'vscode';
import { debounce } from 'lodash-es';
import { IFeature } from '../core/interfaces/IFeature';
import { ConfigurationService } from '../services/ConfigurationService';
import type { MarkStyle } from '../core/types/mark-style';
import ColorLog from '../utils/ColorLog';

export class MarkDecorationFeature implements IFeature {
  public readonly id = 'MarkDecorationFeature';

  private decorationTypes: Map<string, { line: vscode.TextEditorDecorationType; icon: vscode.TextEditorDecorationType }> = new Map();
  private markRegex: RegExp | null = null;
  private marksConfigCache: Record<string, MarkStyle> = {};
  private extensionContext!: vscode.ExtensionContext;

  private readonly commentPatterns: RegExp[] = [
    /\/\/\s*$/,      // // 
    /\/\*\s*$/,      // /*
    /\*\s*$/,        // *  (块注释中间行)
    /<!--\s*$/,      // <!--
    /#\s*$/,         // # (python/shell)
    /\{\/\*\s*$/,    // {/*  JSX/TSX 注释
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
/**
   * 重载 decorations + 预编译 mark 正则
   */
  private async reloadDecorations() { // 👈 加上 async
    this.disposeDecorations();

    this.marksConfigCache = this.getMarksConfig();

    // 🌟 这里必须用 for...of 循环，以保证 await 顺序执行
    for (const [text, style] of Object.entries(this.marksConfigCache)) {
      const targetColor = style.color || '#ffffff';
      
      // 👈 加上 await
      const iconUri = await this.resolveIconUri(style.gutterIconPath, targetColor);

      const lineDecoration = vscode.window.createTextEditorDecorationType({
        isWholeLine: true,
        backgroundColor: style.wholeLineBackgroundColor || style.backgroundColor || 'rgba(0,122,204,0.12)',
        color: style.color || '#ffffff',
        fontWeight: style.fontWeight || '600',
        borderRadius: style.borderRadius || '8px',
        border: `1px solid ${style.borderColor || style.backgroundColor || 'rgba(0,122,204,0.35)'}`,
        overviewRulerColor: style.backgroundColor || '#007acc',
        overviewRulerLane: vscode.OverviewRulerLane.Right,
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
        before: {
          contentText: '',
          margin: '0 0 0 4px',
        },
      });

      const iconDecoration = vscode.window.createTextEditorDecorationType({
        before: iconUri ? {
          contentIconPath: iconUri,
          margin: '0 0.3em 0 0',
          textDecoration: 'none; vertical-align: -16%;',
        } : undefined,
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
      });

      this.decorationTypes.set(text, { line: lineDecoration, icon: iconDecoration });
    }

    this.buildMarkRegex();
    
    // 🌟 关键：因为现在是异步加载图标，加载完毕后必须主动触发一次页面高亮！
    this.triggerUpdateDecorations(); 
  }

  /**
   * 单次扫描高亮逻辑（整行高亮）
   */
  private triggerUpdateDecorations() {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !this.markRegex) return;

    const document = editor.document;
    const text = document.getText();

    const rangesMap: Record<string, { lineRanges: vscode.Range[]; iconRanges: vscode.Range[] }> = {};

    for (const markText of Object.keys(this.marksConfigCache)) {
      rangesMap[markText] = { lineRanges: [], iconRanges: [] };
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

      // 1. 铺满整行的范围
      const fullLineRange = new vscode.Range(
        new vscode.Position(line, 0),
        new vscode.Position(line, lineText.length),
      );

      // 2. 仅仅定位在 @ 符号前的位置 (长度为0的精准 Range)
      const iconRange = new vscode.Range(startPos, startPos);

      if (!rangesMap[markKey]) {
        rangesMap[markKey] = { lineRanges: [], iconRanges: [] };
      }

      rangesMap[markKey].lineRanges.push(fullLineRange);
      rangesMap[markKey].iconRanges.push(iconRange);
    }

    for (const [markText, decos] of this.decorationTypes.entries()) {
      editor.setDecorations(decos.line, rangesMap[markText].lineRanges || []);
      editor.setDecorations(decos.icon, rangesMap[markText].iconRanges || []);
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
    const trimmed = text.trimEnd();
    return this.commentPatterns.some((pattern) => pattern.test(trimmed));
  }

  /**
   * 正则转义
   */
  private escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
     * 解析行内图标的 URI
     */
/**
   * 🌟 动态解析：使用 VS Code 原生 API，支持远程与 Web 环境
   */
  private async resolveIconUri(iconPath: string | undefined, targetColor: string): Promise<vscode.Uri | undefined> {
    if (!iconPath) return undefined;

    // 使用 VS Code 推荐的 URI 拼接方式
    let fileUri: vscode.Uri;
    if (path.isAbsolute(iconPath)) {
      fileUri = vscode.Uri.file(iconPath);
    } else {
      fileUri = vscode.Uri.joinPath(this.extensionContext.extensionUri, iconPath);
    }

    try {
      // 1. 使用 VS Code API 异步读取文件 (返回 Uint8Array)
      const fileData = await vscode.workspace.fs.readFile(fileUri);
      
      // 2. 将 Uint8Array 转换为字符串 (现代 JS 原生支持)
      let svgContent = new TextDecoder().decode(fileData);

      // 3. 动态替换颜色
      svgContent = svgContent.replace(/stroke="[^"]+"/g, `stroke="${targetColor}"`);
      svgContent = svgContent.replace(/fill="currentColor"/g, `fill="${targetColor}"`);

      // 4. 动态强行替换 SVG 内部的宽高
      const targetSize = "14"; 
      if (svgContent.includes('width=')) {
        svgContent = svgContent.replace(/width="[^"]+"/, `width="${targetSize}"`);
        svgContent = svgContent.replace(/height="[^"]+"/, `height="${targetSize}"`);
      } else {
        svgContent = svgContent.replace('<svg ', `<svg width="${targetSize}" height="${targetSize}" `);
      }

      const encodedSvg = encodeURIComponent(svgContent);
      return vscode.Uri.parse(`data:image/svg+xml;utf8,${encodedSvg}`);
    } catch (e) {
      // 类似于 fs.existsSync 的效果：如果 readFile 抛出异常，说明文件不存在或无法读取
      console.error('动态处理 SVG 失败或文件不存在', e);
      return fileUri; // 返回原始路径作为降级兜底
    }
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
    for (const decos of this.decorationTypes.values()) {
      decos.line.dispose();
      decos.icon.dispose();
    }
    this.decorationTypes.clear();
  }

  public deactivate() {
    this.debouncedUpdateDecorations.cancel();
    this.disposeDecorations();
  }
}