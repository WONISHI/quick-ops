import * as vscode from 'vscode';
import { IFeature } from '../core/interfaces/IFeature';
import { ConfigurationService, ILogrcConfig } from '../services/ConfigurationService';

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

  // 缓存装饰器类型
  private decorationTypes: Map<string, vscode.TextEditorDecorationType> = new Map();

  constructor(private configService: ConfigurationService = ConfigurationService.getInstance()) {}

  public activate(context: vscode.ExtensionContext): void {
    // 1. 初始化装饰器
    this.reloadDecorations();

    // 2. 首次触发渲染
    if (vscode.window.activeTextEditor) {
      this.triggerUpdateDecorations();
    }

    // 3. 监听编辑器切换
    context.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) {
          this.triggerUpdateDecorations();
        }
      }),
    );

    // 4. 监听文本内容变化 (用于更新高亮)
    let timeout: NodeJS.Timeout | undefined = undefined;
    context.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (vscode.window.activeTextEditor && event.document === vscode.window.activeTextEditor.document) {
          if (timeout) clearTimeout(timeout);
          timeout = setTimeout(() => this.triggerUpdateDecorations(), 100);
        }
      }),
    );

    // 5. 监听配置变化
    this.configService.on('configChanged', () => {
      this.reloadDecorations();
      this.triggerUpdateDecorations();
    });

    // =========================================================
    // ✨ 新增：注册代码补全提供者 (只在注释中触发 @)
    // =========================================================
    const selector: vscode.DocumentSelector = ['javascript', 'typescript', 'vue', 'javascriptreact', 'typescriptreact', 'java', 'c', 'cpp', 'go', 'python']; // 支持更多语言

    const completionProvider = vscode.languages.registerCompletionItemProvider(
      selector,
      {
        provideCompletionItems: (document, position) => {
          return this.provideMarkCompletions(document, position);
        },
      },
      '@', // 触发字符
    );
    context.subscriptions.push(completionProvider);

    console.log(`[${this.id}] Activated.`);
  }

  /**
   * ✨ 核心补全逻辑
   */
  private provideMarkCompletions(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] | undefined {
    const lineText = document.lineAt(position).text;
    const prefix = lineText.substring(0, position.character);

    // 1. 找到最后一个 '@' 的位置
    // 这一点很关键，因为我们可能是输入了 "// @s"，我们要找的是 @ 的位置
    const atIndex = prefix.lastIndexOf('@');
    if (atIndex === -1) return undefined;

    // 2. 检查 '@' 之前是否是注释环境
    // 我们截取 @ 之前的内容来判断，防止误判邮箱地址 user@email.com
    const textBeforeAt = prefix.substring(0, atIndex);
    const isComment = /(\/\/|^\s*\*|\/\*)/.test(textBeforeAt);

    if (!isComment) {
      return undefined;
    }

    // 3. ✨【关键修复】计算替换范围 Range
    // 这个 Range 覆盖了从 "@" 开始，一直到当前光标的位置
    // 比如输入 "@s" 时，Range 就是 "@s" 这两个字符
    // 补全时，VS Code 会用 "@success" 替换掉这个 Range，从而实现完美覆盖
    const replaceRange = new vscode.Range(position.line, atIndex, position.line, position.character);

    const marksConfig = this.getMarksConfig();
    const items: vscode.CompletionItem[] = [];

    for (const [markText, style] of Object.entries(marksConfig)) {
      // 这里的 markText 比如是 "@success"
      const item = new vscode.CompletionItem(markText, vscode.CompletionItemKind.Color);

      // 详情与文档
      item.detail = `Custom Mark (${style.backgroundColor})`;
      item.documentation = new vscode.MarkdownString(`Preview: **${markText}**\n\nColor: ${style.backgroundColor}`);

      // ✨【关键修复】强行置顶
      // 使用 "!" 确保排在 @ts-check 等内置提示的前面
      item.sortText = '!';

      // ✨【关键修复】绑定替换范围
      item.range = replaceRange;

      // 显式设置过滤文本，确保输入 "@s" 能匹配到 "@success"
      item.filterText = markText;

      // 插入文本就是完整的 markText
      item.insertText = markText;

      items.push(item);
    }

    return items;
  }

  /**
   * 根据配置生成/更新装饰器类型
   */
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
        before: { contentText: ' ', width: '2px' },
        after: { contentText: ' ', width: '2px' },
      });

      this.decorationTypes.set(text, decorationType);
    }
  }

  /**
   * 核心逻辑：扫描文本并应用装饰
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

      // 转义正则特殊字符
      const escapedText = markText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escapedText, 'g');

      let match;
      while ((match = regex.exec(text))) {
        const startPos = editor.document.positionAt(match.index);
        const lineText = editor.document.lineAt(startPos.line).text;

        // 高亮检查逻辑
        if (lineText.includes('//') || lineText.includes('*')) {
          const commentIndex = lineText.indexOf('//') > -1 ? lineText.indexOf('//') : lineText.indexOf('*');
          if (startPos.character > commentIndex) {
            const endPos = editor.document.positionAt(match.index + match[0].length);
            ranges.push(new vscode.Range(startPos, endPos));
          }
        }
      }
      editor.setDecorations(decorationType, ranges);
    }
  }

  /**
   * 获取配置 (合并逻辑：默认配置 + 用户配置)
   */
  private getMarksConfig(): Record<string, MarkStyle> {
    const defaultMarks: Record<string, MarkStyle> = {
      '@success': { backgroundColor: '#4caf50', color: '#ffffff', borderRadius: '4px', fontWeight: 'bold' },
      '@warning': { backgroundColor: '#ff9800', color: '#ffffff', borderRadius: '4px', fontWeight: 'bold' },
      '@error': { backgroundColor: '#f44336', color: '#ffffff', borderRadius: '4px', fontWeight: 'bold' },
      '@todo': { backgroundColor: '#ffeb3b', color: '#333333', borderRadius: '4px', fontWeight: 'bold' },
      '@note': { backgroundColor: '#2196f3', color: '#ffffff', borderRadius: '4px', fontWeight: 'bold' },
      '@head': { backgroundColor: '#607d8b', color: '#ffffff', borderRadius: '4px', fontWeight: 'bold' },
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
