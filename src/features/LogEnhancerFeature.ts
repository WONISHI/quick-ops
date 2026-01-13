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
    const selector: vscode.DocumentSelector = [
      'javascript',
      'typescript',
      'vue',
      'javascriptreact',
      'typescriptreact',
    ];

    const provider = vscode.languages.registerCompletionItemProvider(
      selector,
      {
        provideCompletionItems: (document, position) => {
          return this.provideLogs(document, position);
        },
      },
      '>' // 触发字符
    );

    context.subscriptions.push(provider);
    console.log(`[${this.id}] Activated.`);
  }

  // 注意：返回值类型改成了 ProviderResult<CompletionList | CompletionItem[]>
  private provideLogs(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.ProviderResult<vscode.CompletionList | vscode.CompletionItem[]> {

    // 1. 获取光标处的“扩展单词”范围
    // 这个正则的意思是：向前向后把所有 字母、数字、> 连在一起当成一个词
    const rangeRegex = /[\w>]+/;
    const range = document.getWordRangeAtPosition(position, rangeRegex);
    
    // 如果没有 range，说明可能是在空行，直接返回
    if (!range) return [];

    // 获取当前像 "log>a" 这样的文本
    const currentText = document.getText(range);

    // 调试日志：打开 "开发者工具" (Help -> Toggle Developer Tools) 可以看到这个输出
    // 如果你输入 log>a 看不到这条日志，说明 VS Code 没重新触发函数

    // 2. 解析配置
    const templateStr = this.configService.config.logger.template || '[icon]-[line]-[$0]';
    const fileState = this.workspaceState.state;
    // 如果没有文件信息，安全返回
    if (!fileState.uri) return []; 

    const ctx = {
      line: position.line,
      fileName: fileState.fileName,
      filePath: fileState.uri.fsPath,
      rootPath: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '',
    };
    const baseArgs = LogHelper.parseTemplate(templateStr, ctx, this.configService.config);

    // 3. 正则匹配指令
    const match = currentText.match(/^(\b(?:log|cg|cng))(>>?)(.*)$/);

    if (match) {
      // === 高级模式 (匹配到 log>a) ===
      const triggerWord = match[1];
      const modeSymbol = match[2];
      const inputContent = match[3]; // 这里就是 'a'

      const isStringMode = modeSymbol === '>>';
      const finalArgs = this.injectInputToArgs(baseArgs, inputContent, isStringMode);
      const insertText = `console.log(${finalArgs.join(', ')});`;

      const item = new vscode.CompletionItem(
        currentText, // Label 直接用当前的文本，比如 log>a，这样肯定能匹配上
        vscode.CompletionItemKind.Snippet
      );
      
      item.detail = isStringMode ? `Log String: "${inputContent}"` : `Log Variable: ${inputContent}`;
      item.insertText = new vscode.SnippetString(insertText);
      item.range = range; // 覆盖整个 log>a
      item.filterText = currentText; // 关键：让过滤文本等于当前输入
      item.sortText = '0000';
      item.documentation = new vscode.MarkdownString().appendCodeblock(insertText, 'javascript');

      // ★★★ 核心修复：返回 CompletionList 并设置 isIncomplete: true ★★★
      // 这告诉 VS Code：“列表不完整，用户接着打字时（比如打 'a'），请再调我一次！”
      return new vscode.CompletionList([item], true);
      
    } else {
      // === 普通模式 (只有 log 或 log>) ===
      // 如果已经输入了 log> 但还没输参数，我们也要 isIncomplete，等待参数输入
      if (currentText.endsWith('>') || currentText.endsWith('>>')) {
         // 这里的 item 生成逻辑同上，或者返回空列表等待用户输入
         // 但为了保证 > 后能立即看到提示，建议返回一个占位提示
         return new vscode.CompletionList([], true); 
      }

      // 正常的 log 补全
      const insertText = `console.log(${baseArgs.map(a => a === '$0' ? '$0' : `'${a}'`).join(', ')});`;
      const triggers = ['log', 'cg', 'cng'];
      
      const items = triggers.map(label => {
        const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Method);
        item.detail = `Quick Log`;
        item.insertText = new vscode.SnippetString(insertText);
        // 如果当前是 log，且光标在 log 上，设置 range 覆盖它
        if (currentText === label) {
             item.range = range;
        }
        return item;
      });

      // 普通模式下，列表是完整的，不需要刷新
      return new vscode.CompletionList(items, false);
    }
  }

  private injectInputToArgs(baseArgs: string[], input: string, isStringMode: boolean): string[] {
    if (!input) return baseArgs.map(arg => arg === '$0' ? '$0' : `'${arg}'`);
    const formatted = isStringMode ? `'${input}'` : input;
    let replaced = false;
    const newArgs = baseArgs.map(arg => {
      if (arg === '$0') { replaced = true; return formatted; }
      return `'${arg}'`;
    });
    if (!replaced) newArgs.push(formatted);
    return newArgs;
  }
}