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
      '?', // 触发字符 ?
    );

    context.subscriptions.push(provider);
    console.log(`[${this.id}] Activated.`);
  }

  private provideLogs(document: vscode.TextDocument, position: vscode.Position): vscode.ProviderResult<vscode.CompletionList | vscode.CompletionItem[]> {
    // 1. 获取光标处单词范围
    const rangeRegex = /[\w\?>]+/;
    const range = document.getWordRangeAtPosition(position, rangeRegex);
    if (!range) return [];

    const currentText = document.getText(range);

    // 2. 准备基础上下文
    const templateStr = this.configService.config.logger.template || '[icon]-[line]-[$0]';
    const fileState = this.workspaceState.state;
    if (!fileState.uri) return [];

    const ctx = {
      line: position.line,
      fileName: fileState.fileName,
      filePath: fileState.uri.fsPath,
      rootPath: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '',
    };

    // 3. 正则匹配：分离 Trigger、RawFlag、Remainder
    const triggerMatch = currentText.match(/^(\b(?:log|cg|cng|lg))(\??)(.+)$/);

    if (triggerMatch) {
      const modeSymbol = triggerMatch[2]; // "?" 或 ""
      const remainder = triggerMatch[3]; // ">>a>b"
      const isRawMode = modeSymbol === '?';

      const parserRegex = /(>>?)([^>]*)/g;
      const parsedArgs: string[] = [];
      let match;

      while ((match = parserRegex.exec(remainder)) !== null) {
        const operator = match[1]; // > 或 >>
        const content = match[2].trim();
        if (content) {
          if (operator === '>>') {
            parsedArgs.push(`'${content}'`);
          } else {
            parsedArgs.push(content);
          }
        }
      }

      // --- 生成最终参数 ---
      let finalArgs: string[];
      let labelDetail = '';

      if (isRawMode) {
        finalArgs = parsedArgs;
        labelDetail = 'Raw Log';
      } else {
        const baseArgs = LogHelper.parseTemplate(templateStr, ctx, this.configService.config);
        finalArgs = this.injectFinalArgs(baseArgs, parsedArgs);
        labelDetail = 'Template Log';
      }

      const insertText = `console.log(${finalArgs.join(', ')});`;

      // --- 构建补全项 (这里加入了你的 labelObj) ---

      // 【修改点】：在复杂模式下也使用 labelObj 来显示灰色文字
      const labelObj: vscode.CompletionItemLabel = {
        label: currentText, // 例如 "log>a"
        description: ' quick-ops', // 👈 这里就是你要的灰色文字
      };

      const item = new vscode.CompletionItem(labelObj, vscode.CompletionItemKind.Snippet);

      const preview = parsedArgs.length > 0 ? parsedArgs.join(', ') : '...';
      item.detail = `${labelDetail}: ${preview}`; // 这是最右侧的文字

      item.insertText = new vscode.SnippetString(insertText);
      item.range = range;
      item.filterText = currentText;
      item.sortText = '0000';
      item.documentation = new vscode.MarkdownString().appendCodeblock(insertText, 'javascript');

      return new vscode.CompletionList([item], true);
    } else {
      if (currentText.includes('?') || currentText.includes('>')) {
        return new vscode.CompletionList([], true);
      }

      const baseArgs = LogHelper.parseTemplate(templateStr, ctx, this.configService.config);
      const insertText = `console.log(${baseArgs.map((a) => (a === '$0' ? '$0' : `'${a}'`)).join(', ')});`;

      const triggers = ['log', 'cg', 'cng', 'lg'];

      const items = triggers.map((labelStr) => {
        // 【修改点】：基础模式同样保持统一
        const labelObj: vscode.CompletionItemLabel = {
          label: labelStr,
          description: ' quick-ops', // 👈 统一使用这个描述
        };

        const item = new vscode.CompletionItem(labelObj, vscode.CompletionItemKind.Snippet);

        item.detail = `Quick Log`;
        item.insertText = new vscode.SnippetString(insertText);

        if (currentText === labelStr) {
          item.range = range;
        }

        item.sortText = '!';
        item.preselect = true;
        item.documentation = new vscode.MarkdownString().appendCodeblock(insertText, 'javascript');

        return item;
      });

      return new vscode.CompletionList(items, false);
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
