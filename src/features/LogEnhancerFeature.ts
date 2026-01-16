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
      '.', // 触发字符
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

        // 检测到 log> 模式时自动弹出提示
        if (/(\b(?:log|cg|cng|lg))(\??)(>|>>)/.test(lineText)) {
          const text = change.text;
          const isTriggerChar = ['>', '?', '.', '(', ')', ';', ' ', '\n'].includes(text);

          if ((text.length === 1 && !isTriggerChar) || text.length > 1) {
            if (triggerTimer) clearTimeout(triggerTimer);
            triggerTimer = setTimeout(() => {
              vscode.commands.executeCommand('editor.action.triggerSuggest');
            }, 20); // 极短延迟
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
    // ✅ 返回 CompletionList 以控制 isIncomplete

    // 1. 获取当前行光标前的文本
    const lineText = document.lineAt(position.line).text.substring(0, position.character);

    // 2. 正则匹配
    const triggerMatch = lineText.match(/(\b(?:log|cg|cng|lg))(\??)((?:>|>>).*)$/);

    // 如果没匹配到，返回空
    if (!triggerMatch) return new vscode.CompletionList([], false);

    const prefix = triggerMatch[1];
    const modeSymbol = triggerMatch[2];
    const remainder = triggerMatch[3];
    const isRawMode = modeSymbol === '?';

    // 3. 构建 Log Item
    const logItem = this.generateLogItem(document, position, prefix, remainder, isRawMode, lineText, triggerMatch[0].length);

    // 🔥🔥【核心修复】🔥🔥
    // 第二个参数 true 代表 isIncomplete。
    // 这告诉 VS Code："用户虽然还在打字，但这个列表还没完，每输入一个字符，请务必重新调用我！"
    // 这样当你输入 "response" 时，代码会重新生成 console.log(response) 而不是停留在 console.log()
    return new vscode.CompletionList([logItem], true);
  }

  private generateLogItem(
    document: vscode.TextDocument,
    position: vscode.Position,
    prefix: string,
    remainder: string,
    isRawMode: boolean,
    lineText: string,
    matchLength: number,
  ): vscode.CompletionItem {
    // --- 解析参数 ---
    const parserRegex = /(>>?)([^>]*)/g;
    const parsedArgs: string[] = [];
    let match;

    // 处理参数解析
    if (remainder.trim() === '>' || remainder.trim() === '>>') {
      // 空参数
    } else {
      while ((match = parserRegex.exec(remainder)) !== null) {
        const operator = match[1];
        const content = match[2].trim();
        if (content) {
          parsedArgs.push(operator === '>>' ? `'${content}'` : content);
        }
      }
    }

    // --- 准备模板上下文 ---
    const ctx = {
      line: position.line,
      fileName: this.workspaceState.state.fileName || 'unknown',
      filePath: this.workspaceState.state.uri?.fsPath || '',
      rootPath: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '',
    };

    // --- 生成最终参数 ---
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

    // --- 构建 Insert Text ---
    const insertText = `console.log(${finalArgs.join(', ')});`;

    // --- 构建 Label ---
    // 动态显示当前输入的内容，例如 "log?>response"
    const displayLabel = `${prefix}${isRawMode ? '?' : ''}${remainder}`;

    const logItemObj: vscode.CompletionItemLabel = {
      label: displayLabel,
      description: 'quick-ops',
    };

    const logItem = new vscode.CompletionItem(logItemObj, vscode.CompletionItemKind.Snippet);

    logItem.detail = `console.log(...)`;
    logItem.insertText = new vscode.SnippetString(insertText);

    // --- 计算替换范围 ---
    const fullStart = position.character - matchLength;
    logItem.range = new vscode.Range(position.line, fullStart, position.line, position.character);

    // 🔥【关键优化】
    // 1. filterText 设置为 displayLabel，确保 VS Code 认为这就是最佳匹配
    logItem.filterText = displayLabel;

    // 2. sortText 设置为 '!' (ASCII 33)，比数字 '0' (ASCII 48) 更靠前
    // 这能保证它死死地钉在列表的第一个，压制所有原生提示
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
