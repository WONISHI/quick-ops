import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import type { ISnippetItem } from '../core/types/snippet';
import { IFeature } from '../core/interfaces/IFeature';
import { ConfigurationService } from '../services/ConfigurationService';
import { WorkspaceContextService } from '../services/WorkspaceContextService';
import { TemplateEngine } from '../utils/TemplateEngine';

export class CodeSnippetFeature implements IFeature {
  public readonly id = 'CodeSnippetFeature';
  private cachedSnippets: ISnippetItem[] = [];

  constructor(
    private configService: ConfigurationService = ConfigurationService.getInstance(),
    private contextService: WorkspaceContextService = WorkspaceContextService.getInstance(),
  ) {}

  public activate(context: vscode.ExtensionContext): void {
    this.loadAllSnippets(context);

    // 监听配置变化重新加载
    this.configService.on('configChanged', () => this.loadAllSnippets(context));

    const selector: vscode.DocumentSelector = ['javascript', 'typescript', 'vue', 'javascriptreact', 'typescriptreact', 'html', 'css', 'scss', 'less'];

    const provider = vscode.languages.registerCompletionItemProvider(selector, {
      provideCompletionItems: (document, position) => {
        return this.provideSnippets(document, position);
      },
    });

    context.subscriptions.push(provider);
    console.log(`[${this.id}] Activated.`);
  }

  private provideSnippets(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] {
    if (this.cachedSnippets.length === 0) return [];

    // 性能优化：快速检查前缀是否可能匹配（可选）
    // const linePrefix = document.lineAt(position).text.substr(0, position.character);

    const currentLangId = document.languageId;
    const ctx = this.contextService.context;

    // 1. 过滤逻辑
    const validSnippets = this.cachedSnippets.filter((item) => {
      if (!item.scope || item.scope.length === 0) return true;

      if (item.scope[0] && item.scope[0] !== currentLangId) return false;

      if (item.scope.length > 1 && item.scope[1]) {
        const dep = item.scope[1];
        if (dep === 'vue3' && !ctx.isVue3) return false;
        if (dep === 'vue2' && ctx.isVue3) return false;
        if (dep === 'react' && !ctx.isReact) return false;

        if (!['vue', 'vue2', 'vue3', 'react'].includes(dep) && !ctx.hasDependency(dep)) {
          return false;
        }
      }
      return true;
    });

    // 2. 渲染逻辑
    return validSnippets.map((item) => {
      const completion = new vscode.CompletionItem(item.prefix, vscode.CompletionItemKind.Snippet);
      completion.detail = item.description || `Snippet for ${item.prefix}`;
      completion.sortText = '0'; // 置顶

      const { result, payload } = TemplateEngine.render(item.body, { ...ctx, ...(item.params || {}) });

      console.log('payload', payload);

      completion.insertText = new vscode.SnippetString(result);
      completion.documentation = new vscode.MarkdownString().appendCodeblock(result, currentLangId);

      return completion;
    });
  }

  private loadAllSnippets(context: vscode.ExtensionContext) {
    this.cachedSnippets = [];

    // 1. Load Internal
    const snippetDir = path.join(context.extensionPath, 'resources', 'snippets');
    if (fs.existsSync(snippetDir)) {
      try {
        const files = fs.readdirSync(snippetDir);
        files.forEach((file) => {
          if (file.endsWith('.json')) {
            const content = fs.readFileSync(path.join(snippetDir, file), 'utf-8');
            this.cachedSnippets.push(...JSON.parse(content));
          }
        });
      } catch (e) {}
    }

    const userSnippets = this.configService.config['snippets'];
    if (Array.isArray(userSnippets)) {
      this.cachedSnippets.push(...userSnippets);
    }
  }
}
