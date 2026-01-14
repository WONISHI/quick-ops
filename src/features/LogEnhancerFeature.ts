import * as vscode from 'vscode';
import { IFeature } from '../core/interfaces/IFeature';
import { ConfigurationService } from '../services/ConfigurationService';
import { WorkspaceStateService } from '../services/WorkspaceStateService';
import { LogHelper } from '../utils/LogHelper';

export class LogEnhancerFeature implements IFeature {
  public readonly id = 'LogEnhancerFeature';

  // 防止递归调用的锁
  private isFetchingNative = false;

  constructor(
    private configService: ConfigurationService = ConfigurationService.getInstance(),
    private workspaceState: WorkspaceStateService = WorkspaceStateService.getInstance(),
  ) {}

  public activate(context: vscode.ExtensionContext): void {
    const selector: vscode.DocumentSelector = ['javascript', 'typescript', 'vue', 'javascriptreact', 'typescriptreact'];

    const provider = vscode.languages.registerCompletionItemProvider(
      selector,
      {
        provideCompletionItems: (document, position) => {
          return this.provideLogs(document, position);
        },
      },
      '>', // 触发字符
      '?', // 触发字符
      '.', // 触发字符
    );

    context.subscriptions.push(provider);

    // 🔥【核心修复】全自动触发逻辑
    vscode.workspace.onDidChangeTextDocument(
      (event) => {
        if (event.contentChanges.length === 0) return;

        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document !== event.document) return;

        const change = event.contentChanges[0];
        const changedLineIndex = change.range.start.line;
        const lineText = editor.document.lineAt(changedLineIndex).text;

        // 1. 只有当前行处于 log> 指令模式下才生效
        if (/(\b(?:log|cg|cng|lg))(\??)(>|>>)/.test(lineText)) {
          const text = change.text;

          // 2. 判断触发条件：
          // - 粘贴 (text.length > 1)
          // - 删除 (text === '' && rangeLength > 0)
          // - 输入普通字符 (text.length === 1)，但排除掉已经是触发字符的符号（防止重复触发闪烁）
          //   也就是：当你输入 'a' 时，这里会强制触发；当你输入 '>' 时，VS Code 原生触发，这里忽略
          const isTriggerChar = ['>', '?', '.', ' ', '\n', '\t', ';'].includes(text);

          if (text.length > 1 || (text.length === 0 && change.rangeLength > 0) || (text.length === 1 && !isTriggerChar)) {
            // 使用 0ms 或极短延时，保证打字跟手
            setTimeout(() => {
              vscode.commands.executeCommand('editor.action.triggerSuggest');
            }, 10);
          }
        }
      },
      null,
      context.subscriptions,
    );

    console.log(`[${this.id}] Activated.`);
  }

  private async provideLogs(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.CompletionList | vscode.CompletionItem[]> {
    // 1. 获取当前行文本
    const lineText = document.lineAt(position.line).text.substring(0, position.character);

    // 2. 正则匹配
    const triggerMatch = lineText.match(/(\b(?:log|cg|cng|lg))(\??)((?:>|>>).*)$/);
    if (!triggerMatch) {
      return [];
    }

    const prefix = triggerMatch[1];
    const modeSymbol = triggerMatch[2];
    const remainder = triggerMatch[3];
    const isRawMode = modeSymbol === '?';

    // 获取最后一个 > 的位置
    const lastGtIndex = remainder.lastIndexOf('>');

    // === 解析已存在的参数 ===
    const parserRegex = /(>>?)([^>]*)/g;
    const parsedArgs: string[] = [];
    let match;
    while ((match = parserRegex.exec(remainder)) !== null) {
      const operator = match[1];
      const content = match[2].trim();
      if (content) {
        parsedArgs.push(operator === '>>' ? `'${content}'` : content);
      }
    }

    // === 构建 LogItem (Generate Code) ===
    const ctx = {
      line: position.line,
      fileName: this.workspaceState.state.fileName || 'unknown',
      filePath: this.workspaceState.state.uri?.fsPath || '',
      rootPath: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '',
    };

    let finalArgs: string[];
    let labelDetail = '';

    if (isRawMode) {
      finalArgs = [...parsedArgs];
      labelDetail = 'Raw Log';
    } else {
      const templateStr = this.configService.config.logger.template || '[icon]-[line]-[$0]';
      const baseArgs = LogHelper.parseTemplate(templateStr, ctx, this.configService.config);
      finalArgs = this.injectFinalArgs(baseArgs, parsedArgs);
      labelDetail = 'Template Log';
    }

    const insertText = `console.log(${finalArgs.join(', ')});`;
    const logItemObj: vscode.CompletionItemLabel = {
      label: lineText.substring(lineText.lastIndexOf(prefix)),
      description: ' Generate Code',
    };

    const logItem = new vscode.CompletionItem(logItemObj, vscode.CompletionItemKind.Method);
    const preview = parsedArgs.length > 0 ? parsedArgs.join(', ') : '...';

    logItem.detail = `${labelDetail}: ${preview}`;
    logItem.insertText = new vscode.SnippetString(insertText);
    const fullStart = position.character - triggerMatch[0].length;
    logItem.range = new vscode.Range(position.line, fullStart, position.line, position.character);
    logItem.filterText = lineText;
    logItem.sortText = '0'; // 绝对置顶
    logItem.preselect = true;
    logItem.documentation = new vscode.MarkdownString().appendCodeblock(insertText, 'javascript');

    // 如果锁是开着的，直接返回 LogItem
    if (this.isFetchingNative) {
      return [logItem];
    }

    // === 剪贴板建议 ===
    let clipboardItem: vscode.CompletionItem | undefined;
    const clipboardText = await vscode.env.clipboard.readText();
    const cleanClipboard = clipboardText?.trim();

    if (cleanClipboard && cleanClipboard.length > 0 && cleanClipboard.length < 100 && !parsedArgs.includes(cleanClipboard)) {
      if (!remainder.endsWith(cleanClipboard)) {
        const baseArgs = LogHelper.parseTemplate(this.configService.config.logger.template || '[icon]-[line]-[$0]', ctx, this.configService.config);
        const clipArgs = this.injectFinalArgs(baseArgs, [cleanClipboard]);
        const clipInsert = `console.log(${clipArgs.join(', ')});`;

        clipboardItem = new vscode.CompletionItem(
          {
            label: `${prefix}> 📋 ${cleanClipboard}`,
            description: ' Log Clipboard',
          },
          vscode.CompletionItemKind.Snippet,
        );

        clipboardItem.insertText = new vscode.SnippetString(clipInsert);
        clipboardItem.range = logItem.range;
        clipboardItem.filterText = lineText;
        clipboardItem.sortText = '00';
        clipboardItem.documentation = new vscode.MarkdownString(`Generate:\n\`\`\`javascript\n${clipInsert}\n\`\`\``);
      }
    }

    // === 上下文变量补全 ===
    let contextSuggestions: vscode.CompletionItem[] = [];

    // 获取当前正在输入的变量部分
    const fullInputVar = remainder.substring(lastGtIndex + 1);
    const lastDotIndex = fullInputVar.lastIndexOf('.');
    let varToReplace = fullInputVar;
    if (lastDotIndex !== -1) {
      varToReplace = fullInputVar.substring(lastDotIndex + 1);
    }

    const replaceRange = new vscode.Range(position.line, position.character - varToReplace.length, position.line, position.character);

    this.isFetchingNative = true;
    try {
      const triggerChar = lineText.endsWith('.') ? '.' : undefined;
      contextSuggestions = await this.getContextVariables(document, position, replaceRange, triggerChar);
    } finally {
      this.isFetchingNative = false;
    }

    const items = [];
    if (clipboardItem) items.push(clipboardItem);
    items.push(logItem);
    items.push(...contextSuggestions);

    // 🔥【关键】永远返回 true，保证持续监听键盘输入刷新预览
    return new vscode.CompletionList(items, true);
  }

  private async getContextVariables(document: vscode.TextDocument, position: vscode.Position, replaceRange: vscode.Range, triggerChar?: string): Promise<vscode.CompletionItem[]> {
    try {
      const result = await vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider', document.uri, position, triggerChar);

      if (!result || !result.items) return [];

      const validKinds = new Set([
        vscode.CompletionItemKind.Variable,
        vscode.CompletionItemKind.Property,
        vscode.CompletionItemKind.Field,
        vscode.CompletionItemKind.Function,
        vscode.CompletionItemKind.Method,
        vscode.CompletionItemKind.Constant,
        vscode.CompletionItemKind.EnumMember,
        vscode.CompletionItemKind.Value,
        vscode.CompletionItemKind.Keyword,
        vscode.CompletionItemKind.Text,
        vscode.CompletionItemKind.Reference,
        vscode.CompletionItemKind.Interface,
        vscode.CompletionItemKind.Class,
      ]);

      const relevantItems = result.items.filter((item) => {
        if (item.label === 'log' || (typeof item.label !== 'string' && item.label.label === 'log')) return false;

        if (item.kind === vscode.CompletionItemKind.Keyword) {
          const label = typeof item.label === 'string' ? item.label : item.label.label;
          if (label !== 'this' && label !== 'super' && label !== 'true' && label !== 'false') {
            return false;
          }
        }

        return validKinds.has(item.kind || vscode.CompletionItemKind.Text);
      });

      return relevantItems.map((item) => {
        const label = typeof item.label === 'string' ? item.label : item.label.label;
        const newItem = new vscode.CompletionItem(label, item.kind);

        newItem.detail = item.detail;
        newItem.documentation = item.documentation;
        newItem.insertText = label;
        newItem.range = replaceRange;

        newItem.sortText = '1' + label;
        newItem.preselect = false;

        return newItem;
      });
    } catch (e) {
      return [];
    }
  }

  private injectFinalArgs(baseArgs: string[], formattedInputs: string[]): string[] {
    if (formattedInputs.length === 0) {
      return baseArgs.map((arg) => (arg === '$0' ? '$0' : `'${arg}'`));
    }
    let hasReplaced = false;
    const newArgs = baseArgs.flatMap((arg) => {
      if (arg === '$0') {
        hasReplaced = true;
        return formattedInputs;
      }
      return [`'${arg}'`];
    });
    if (!hasReplaced) newArgs.push(...formattedInputs);
    return newArgs;
  }
}
