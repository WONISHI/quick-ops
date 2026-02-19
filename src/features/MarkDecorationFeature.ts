import * as vscode from 'vscode';
import { IFeature } from '../core/interfaces/IFeature';
import { ConfigurationService } from '../services/ConfigurationService';
import type { MarkStyle } from '../core/types/mark-style';
import ColorLog from '../utils/ColorLog';

export class MarkDecorationFeature implements IFeature {
  public readonly id = 'MarkDecorationFeature';

  private decorationTypes: Map<string, vscode.TextEditorDecorationType> = new Map();

  constructor(private configService: ConfigurationService = ConfigurationService.getInstance()) {}

  public activate(context: vscode.ExtensionContext): void {
    this.reloadDecorations();

    if (vscode.window.activeTextEditor) {
      this.triggerUpdateDecorations();
    }

    context.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) this.triggerUpdateDecorations();
      }),
    );

    let timeout: NodeJS.Timeout | undefined = undefined;
    context.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (vscode.window.activeTextEditor && event.document === vscode.window.activeTextEditor.document) {
          if (timeout) clearTimeout(timeout);
          timeout = setTimeout(() => this.triggerUpdateDecorations(), 100);
        }
      }),
    );

    this.configService.on('configChanged', () => {
      this.reloadDecorations();
      this.triggerUpdateDecorations();
    });

    // 添加 HTML/XML 相关语言支持
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
    context.subscriptions.push(completionProvider);

    ColorLog.black(`[${this.id}]`, 'Activated.');
  }

  /**
   * ✨ 核心补全逻辑 (已更新：支持自动补全冒号)
   * 现在支持 HTML/XML 注释 <!-- -->
   */
  private provideMarkCompletions(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] | undefined {
    const lineText = document.lineAt(position).text;
    const prefix = lineText.substring(0, position.character);

    const atIndex = prefix.lastIndexOf('@');
    if (atIndex === -1) return undefined;

    // 1. 严格检查：@ 之前必须是 "空白 + 注释符 + 空白"
    // 允许的格式： "// @", "   * @", "<!-- @"
    // 不允许的格式： "var s = '// @", "text // @"
    const textBeforeAt = prefix.substring(0, atIndex);

    // 正则解释：支持多种注释格式
    // 1. // 单行注释
    // 2. * 块注释中的行
    // 3. /* 块注释开始
    // 4. <!-- HTML/XML 注释开始
    const commentPatterns = [
      /^\s*\/\/\s*$/, // 单行注释: //
      /^\s*\*\s*$/, // 块注释行: *
      /^\s*\/\*\s*$/, // 块注释开始: /*
      /^\s*<!--\s*$/, // HTML/XML 注释: <!--
    ];

    const isValidCommentStart = commentPatterns.some((pattern) => pattern.test(textBeforeAt));

    if (!isValidCommentStart) {
      return undefined;
    }

    const replaceRange = new vscode.Range(position.line, atIndex, position.line, position.character);
    const marksConfig = this.getMarksConfig();
    const items: vscode.CompletionItem[] = [];

    for (const [markText, style] of Object.entries(marksConfig)) {
      const logItemObj: vscode.CompletionItemLabel = {
        label: markText,
        description: `quick-ops/${markText}`,
      };
      const item = new vscode.CompletionItem(logItemObj, vscode.CompletionItemKind.Color);

      item.detail = `Mark: ${markText}:`;
      item.documentation = new vscode.MarkdownString(`Preview: **${markText}:**\n\nColor: ${style.backgroundColor}`);
      item.sortText = '!';
      item.range = replaceRange;
      item.filterText = markText;

      // ✨ 关键修改：插入文本自动带上冒号
      item.insertText = `${markText}: `;

      items.push(item);
    }

    return items;
  }

  private reloadDecorations() {
    this.disposeDecorations();
    const marksConfig = this.getMarksConfig();

    for (const [text, style] of Object.entries(marksConfig)) {
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
  }

  /**
   * ✨ 核心高亮逻辑 (已更新：严格校验，支持 HTML/XML 注释)
   */
  private triggerUpdateDecorations() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const text = editor.document.getText();
    const marksConfig = this.getMarksConfig();

    for (const [markText, _] of Object.entries(marksConfig)) {
      const decorationType = this.decorationTypes.get(markText);
      if (!decorationType) continue;

      const ranges: vscode.Range[] = [];

      // 1. 构造带冒号的正则
      const escapedText = markText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`${escapedText}:`, 'g');

      let match;
      while ((match = regex.exec(text))) {
        const startPos = editor.document.positionAt(match.index);
        const endPos = editor.document.positionAt(match.index + match[0].length);
        const lineText = editor.document.lineAt(startPos.line).text;

        // 2. ✨ 严格校验：匹配项之前的内容
        const textBeforeMatch = lineText.substring(0, startPos.character);

        // 3. 校验规则：支持多种注释格式
        const commentPatterns = [
          /^\s*\/\/\s*$/, // 单行注释: //
          /^\s*\*\s*$/, // 块注释行: *
          /^\s*\/\*\s*$/, // 块注释开始: /*
          /^\s*<!--\s*$/, // HTML/XML 注释: <!--
        ];

        const isStrictCommentStart = commentPatterns.some((pattern) => pattern.test(textBeforeMatch));

        if (isStrictCommentStart) {
          ranges.push(new vscode.Range(startPos, endPos));
        }
      }
      editor.setDecorations(decorationType, ranges);
    }
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
    this.disposeDecorations();
  }
}
