import * as vscode from 'vscode';
import { IFeature } from '../core/interfaces/IFeature';
import { ConfigurationService } from '../services/ConfigurationService';
import { WorkspaceStateService } from '../services/WorkspaceStateService';
import { LogHelper } from '../utils/LogHelper';

export class LogEnhancerFeature implements IFeature {
  public readonly id = 'LogEnhancerFeature';

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
      '>',
      '?',
      '.',
    );

    context.subscriptions.push(provider);

    // 监听输入，自动触发建议框
    let triggerTimer: NodeJS.Timeout | null = null;
    vscode.workspace.onDidChangeTextDocument(
      (event) => {
        if (event.contentChanges.length === 0) return;
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document !== event.document) return;

        const change = event.contentChanges[0];
        const lineText = editor.document.lineAt(change.range.start.line).text;

        // 正则修改：支持 log> 同时也支持单纯的 log 结尾
        // 1. (\b(?:log|cg|cng|lg)) 匹配关键字
        // 2. (?:\??(?:>|>>).*)?  后续的 >... 部分变成可选的了
        if (/(\b(?:log|cg|cng|lg))(?:\??(?:>|>>).*|$)/.test(lineText)) {
          const text = change.text;
          const isTriggerChar = ['>', '?', '.', '(', ')', ';', ' ', '\n'].includes(text);

          if ((text.length === 1 && !isTriggerChar) || text.length > 1) {
            if (triggerTimer) clearTimeout(triggerTimer);
            triggerTimer = setTimeout(() => {
              vscode.commands.executeCommand('editor.action.triggerSuggest');
            }, 20);
          }
        }
      },
      null,
      context.subscriptions,
    );

    console.log(`[${this.id}] Activated.`);
  }

  /**
   * 核心补全逻辑
   */
  private provideLogs(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionList {
    const lineText = document.lineAt(position.line).text.substring(0, position.character);

    // === 分支 1: 复杂模式 (log>abc) ===
    // 匹配: log>..., log>>..., log?>...
    const complexMatch = lineText.match(/(\b(?:log|cg|cng|lg))(\??)((?:>|>>).*)$/);

    if (complexMatch) {
      const prefix = complexMatch[1];
      const modeSymbol = complexMatch[2];
      const remainder = complexMatch[3];
      const isRawMode = modeSymbol === '?';
      const matchLength = complexMatch[0].length;

      const item = this.generateComplexItem(document, position, prefix, remainder, isRawMode, lineText, matchLength);
      return new vscode.CompletionList([item], true); // isIncomplete=true 保证后续输入持续响应
    }

    // === 分支 2: 基础模式 (log) ===
    // 匹配: 仅以 log, lg, cg, cng 结尾，后面没有 >
    const simpleMatch = lineText.match(/(\b(?:log|cg|cng|lg))$/);

    if (simpleMatch) {
      const prefix = simpleMatch[1];
      const matchLength = simpleMatch[0].length;

      const item = this.generateSimpleItem(document, position, prefix, matchLength);
      return new vscode.CompletionList([item], false); // 基础模式不需要 incomplete
    }

    return new vscode.CompletionList([], false);
  }

  /**
   * 生成基础 Log (输入 log 回车 -> 打印带行号的模板)
   */
  private generateSimpleItem(document: vscode.TextDocument, position: vscode.Position, prefix: string, matchLength: number): vscode.CompletionItem {
    const ctx = {
      line: position.line,
      fileName: this.workspaceState.state.fileName || 'unknown',
      filePath: this.workspaceState.state.uri?.fsPath || '',
      rootPath: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '',
    };

    // 获取配置的模板
    const templateStr = this.configService.config.logger.template || '[icon]-[line]-[$0]';
    // 解析模板，得到 args 数组
    const baseArgs = LogHelper.parseTemplate(templateStr, ctx, this.configService.config);

    // 构造插入文本，例如: console.log('🚀', 'file.ts', 'line 10', $0);
    // 注意：LogHelper 解析出的 $0 会被当作光标位置
    const argsString = baseArgs
      .map((arg) => {
        if (arg === '$0') return '$0'; // 光标位置
        return `'${arg}'`; // 其他参数加引号
      })
      .join(', ');

    const insertText = `console.log(${argsString});`;

    const logItemObj: vscode.CompletionItemLabel = {
      label: prefix,
      description: `quick-ops/${prefix}`,
    };

    const item = new vscode.CompletionItem(logItemObj, vscode.CompletionItemKind.Snippet);
    item.detail = 'Print Template Log';
    item.insertText = new vscode.SnippetString(insertText);
    item.documentation = new vscode.MarkdownString().appendCodeblock(insertText, 'javascript');

    // 替换范围：覆盖掉输入的 "log"
    const range = new vscode.Range(position.line, position.character - matchLength, position.line, position.character);
    item.range = range;

    item.sortText = '0'; // 置顶
    item.preselect = true;

    return item;
  }

  /**
   * 生成复杂 Log (输入 log>var -> 打印 console.log(var))
   */
  private generateComplexItem(
    document: vscode.TextDocument,
    position: vscode.Position,
    prefix: string,
    remainder: string,
    isRawMode: boolean,
    lineText: string,
    matchLength: number,
  ): vscode.CompletionItem {
    // 解析参数
    const parserRegex = /(>>?)([^>]*)/g;
    const parsedArgs: string[] = [];
    let match;

    if (remainder.trim() === '>' || remainder.trim() === '>>') {
      // empty args
    } else {
      while ((match = parserRegex.exec(remainder)) !== null) {
        const operator = match[1];
        const content = match[2].trim();
        if (content) {
          parsedArgs.push(operator === '>>' ? `'${content}'` : content);
        }
      }
    }

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
      labelDetail = 'Raw';
    } else {
      const templateStr = this.configService.config.logger.template || '[icon]-[line]-[$0]';
      const baseArgs = LogHelper.parseTemplate(templateStr, ctx, this.configService.config);
      finalArgs = this.injectFinalArgs(baseArgs, parsedArgs);
      labelDetail = 'Template';
    }

    const insertText = `console.log(${finalArgs.join(', ')});`;

    const displayLabel = `${prefix}${isRawMode ? '?' : ''}${remainder}`;

    const logItemObj: vscode.CompletionItemLabel = {
      label: displayLabel,
      description: 'quick-ops',
    };

    const logItem = new vscode.CompletionItem(logItemObj, vscode.CompletionItemKind.Snippet);

    logItem.detail = `console.log(...)`;
    logItem.insertText = new vscode.SnippetString(insertText);

    const fullStart = position.character - matchLength;
    logItem.range = new vscode.Range(position.line, fullStart, position.line, position.character);

    logItem.filterText = displayLabel;
    logItem.sortText = '!';
    logItem.preselect = true;

    return logItem;
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
