import * as vscode from 'vscode';
import { IFeature } from '../core/interfaces/IFeature';
import { ConfigurationService } from '../services/ConfigurationService';

interface MarkStyle {
  color?: string;
  backgroundColor?: string;
  fontWeight?: string;
  borderRadius?: string;
  padding?: string;
  isWholeLine?: boolean;
}

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

    const selector: vscode.DocumentSelector = ['javascript', 'typescript', 'vue', 'javascriptreact', 'typescriptreact', 'java', 'c', 'cpp', 'go', 'python']; // 支持更多语言

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

    console.log(`[${this.id}] Activated.`);
  }

  /**
   * ✨ 核心补全逻辑 (已更新：支持自动补全冒号)
   */
  private provideMarkCompletions(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] | undefined {
    const lineText = document.lineAt(position).text;
    const prefix = lineText.substring(0, position.character);

    const atIndex = prefix.lastIndexOf('@');
    if (atIndex === -1) return undefined;

    // 1. 严格检查：@ 之前必须是 "空白 + 注释符 + 空白"
    // 允许的格式： "// @", "   * @"
    // 不允许的格式： "var s = '// @", "text // @"
    const textBeforeAt = prefix.substring(0, atIndex);

    // 正则解释：^ (行首) \s* (任意空格) (\/\/|\*|\/\*) (注释符) \s* (任意空格) $ (结束)
    const isValidCommentStart = /^\s*(\/\/|\*|\/\*)\s*$/.test(textBeforeAt);

    if (!isValidCommentStart) {
      return undefined;
    }

    const replaceRange = new vscode.Range(position.line, atIndex, position.line, position.character);
    const marksConfig = this.getMarksConfig();
    const items: vscode.CompletionItem[] = [];

    for (const [markText, style] of Object.entries(marksConfig)) {
      // 显示 label 比如 "@success"
      const item = new vscode.CompletionItem(markText, vscode.CompletionItemKind.Color);

      item.detail = `Mark: ${markText}:`; // 提示中显示带冒号
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
      // 这里的 key 依然是 @success，但在 triggerUpdateDecorations 里我们会加上冒号匹配
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
   * ✨ 核心高亮逻辑 (已更新：严格校验)
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
      // markText 是 "@success"，我们查找 "@success:"
      const escapedText = markText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // 匹配 "@success:"
      const regex = new RegExp(`${escapedText}:`, 'g');

      let match;
      while ((match = regex.exec(text))) {
        const startPos = editor.document.positionAt(match.index);
        const endPos = editor.document.positionAt(match.index + match[0].length);
        const lineText = editor.document.lineAt(startPos.line).text;

        // 2. ✨ 严格校验：匹配项之前的内容
        // 截取当前行，从行首到 @success: 之前的所有文本
        const textBeforeMatch = lineText.substring(0, startPos.character);

        // 3. 校验规则：前缀必须且只能是 "空白 + 注释符 + 空白"
        // 匹配: "  // ", " * ", "   /* "
        // 不匹配: "var x = '// ", "text ", " // text "
        const isStrictCommentStart = /^\s*(\/\/|\*|\/\*)\s*$/.test(textBeforeMatch);

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
