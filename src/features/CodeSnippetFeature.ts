import * as vscode from 'vscode';
import { IFeature } from '../core/interfaces/IFeature';
import { ConfigurationService } from '../services/ConfigurationService';
import { WorkspaceStateService } from '../services/WorkspaceStateService';

export class CodeSnippetFeature implements IFeature {
  public readonly id = 'CodeSnippetFeature';

  constructor(
    private configService: ConfigurationService = ConfigurationService.getInstance(),
    private workspaceState: WorkspaceStateService = WorkspaceStateService.getInstance(),
  ) {}

  public activate(context: vscode.ExtensionContext): void {
    const selector: vscode.DocumentSelector = ['javascript', 'typescript', 'vue', 'javascriptreact', 'typescriptreact'];

    const provider = vscode.languages.registerCompletionItemProvider(selector, {
      provideCompletionItems: (document, position) => {
        return this.provideSnippets(document, position);
      },
    });

    context.subscriptions.push(provider);
    console.log(`[${this.id}] Activated.`);
  }

  private provideSnippets(document: vscode.TextDocument, position: number | vscode.Position): vscode.CompletionItem[] {
    const lineText = document.lineAt(position).text.trim();
    // 这里简化了原来的 properties 读取，改为从 ConfigurationService 获取
    // 假设 configService 已经适配了 snippets 数据结构
    const snippets = this.configService.config.snippets || [];

    // 简单的匹配逻辑，实际可复用 matchKeyword 工具
    const matchedSnippets = snippets.filter((s) => lineText.startsWith(s.prefix));

    if (matchedSnippets.length === 0) return [];

    const currentState = this.workspaceState.state;

    return matchedSnippets.map((item) => {
      const completion = new vscode.CompletionItem(item.prefix, vscode.CompletionItemKind.Snippet);
      completion.detail = item.description;

      // 处理 body 中的变量替换
      let body = Array.isArray(item.body) ? item.body.join('\n') : item.body;
      if (currentState.fileName) {
        const moduleName = currentState.fileName.split('.')[0]; // 简化逻辑
        body = body.replace(/\{module-name\}/g, moduleName);
      }

      completion.insertText = new vscode.SnippetString(body);
      completion.documentation = new vscode.MarkdownString().appendCodeblock(body, item.style || 'javascript');

      return completion;
    });
  }
}
