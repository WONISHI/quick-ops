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
      '>', // 触发字符 >
      '?', // 新增触发字符 ? (确保 log? 能立即触发)
    );

    context.subscriptions.push(provider);
    console.log(`[${this.id}] Activated.`);
  }

  private provideLogs(document: vscode.TextDocument, position: vscode.Position): vscode.ProviderResult<vscode.CompletionList | vscode.CompletionItem[]> {
    // 1. 获取光标处单词范围
    // 【修改点】：正则加入 \?，允许匹配 log?>>a
    const rangeRegex = /[\w\?>]+/;
    const range = document.getWordRangeAtPosition(position, rangeRegex);
    if (!range) return [];

    const currentText = document.getText(range);

    // 2. 准备基础上下文
    const templateStr = this.configService.config.logger.template || '[icon]-[line]-[$0]';
    const fileState = this.workspaceState.state;
    // 注意：即使是纯净模式，最好也做一下文件校验，防止在非代码区乱弹
    if (!fileState.uri) return [];

    const ctx = {
      line: position.line,
      fileName: fileState.fileName,
      filePath: fileState.uri.fsPath,
      rootPath: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '',
    };

    // 3. 正则匹配：分离 Trigger、RawFlag、Remainder
    // Group 1: log/cg/cng
    // Group 2: ? (可选，纯净模式标志)
    // Group 3: 剩余内容 (>>a>b)
    const triggerMatch = currentText.match(/^(\b(?:log|cg|cng))(\??)(.+)$/);

    if (triggerMatch) {
      // === 混合链式模式 (含纯净模式支持) ===
      const modeSymbol = triggerMatch[2]; // "?" 或 ""
      const remainder = triggerMatch[3]; // ">>a>b"

      const isRawMode = modeSymbol === '?';

      // --- 解析参数 (逐段解析逻辑) ---
      // Regex: (>>?) 捕获操作符, ([^>]*) 捕获内容
      const parserRegex = /(>>?)([^>]*)/g;
      const parsedArgs: string[] = [];
      let match;

      while ((match = parserRegex.exec(remainder)) !== null) {
        const operator = match[1]; // > 或 >>
        const content = match[2].trim();

        if (content) {
          if (operator === '>>') {
            parsedArgs.push(`'${content}'`); // 字符串：加引号
          } else {
            parsedArgs.push(content); // 变量：原样
          }
        }
      }

      // --- 生成最终参数 ---
      let finalArgs: string[];
      let labelDetail = '';

      if (isRawMode) {
        // [纯净模式]: 只有用户输入的参数，没有 icon, line 等
        finalArgs = parsedArgs;
        labelDetail = 'Raw Log';
      } else {
        // [模板模式]: 解析模板并将参数注入
        const baseArgs = LogHelper.parseTemplate(templateStr, ctx, this.configService.config);
        finalArgs = this.injectFinalArgs(baseArgs, parsedArgs);
        labelDetail = 'Template Log';
      }

      const insertText = `console.log(${finalArgs.join(', ')});`;

      // --- 构建补全项 ---
      const item = new vscode.CompletionItem(currentText, vscode.CompletionItemKind.Snippet);

      const preview = parsedArgs.length > 0 ? parsedArgs.join(', ') : '...';
      item.detail = `${labelDetail}: ${preview}`;

      item.insertText = new vscode.SnippetString(insertText);
      item.range = range;
      item.filterText = currentText;
      item.sortText = '0000';
      item.documentation = new vscode.MarkdownString().appendCodeblock(insertText, 'javascript');

      return new vscode.CompletionList([item], true);
    } else {
      // 如果正在输入 log? 但还没输参数，返回 incomplete
      if (currentText.includes('?') || currentText.includes('>')) {
        return new vscode.CompletionList([], true);
      }
      // 普通 log 提示
      const baseArgs = LogHelper.parseTemplate(templateStr, ctx, this.configService.config);
      const insertText = `console.log(${baseArgs.map((a) => (a === '$0' ? '$0' : `'${a}'`)).join(', ')});`;
      const triggers = ['log', 'cg', 'cng'];

      const items = triggers.map((label) => {
        const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Snippet);
        item.detail = `Quick Log`;
        item.insertText = new vscode.SnippetString(insertText);

        if (currentText === label) {
          item.range = range;
        }

        item.sortText = '!';

        item.preselect = true;

        return item;
      });

      return new vscode.CompletionList(items, false);
    }
  }

  /**
   * 模板模式下：注入参数
   */
  private injectFinalArgs(baseArgs: string[], formattedInputs: string[]): string[] {
    if (formattedInputs.length === 0) {
      return baseArgs.map((arg) => (arg === '$0' ? '$0' : `'${arg}'`));
    }

    // 寻找模板中的 $0 并替换
    let hasReplaced = false;
    const newArgs = baseArgs.flatMap((arg) => {
      if (arg === '$0') {
        hasReplaced = true;
        return formattedInputs;
      }
      return [`'${arg}'`];
    });

    if (!hasReplaced) {
      newArgs.push(...formattedInputs);
    }

    return newArgs;
  }
}
