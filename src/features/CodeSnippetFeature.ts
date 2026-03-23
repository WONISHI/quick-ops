import * as vscode from 'vscode';
import { TextDecoder } from 'util';
import type { ISnippetItem } from '../core/types/snippet';
import { IFeature } from '../core/interfaces/IFeature';
import { ConfigurationService } from '../services/ConfigurationService';
import { WorkspaceContextService } from '../services/WorkspaceContextService';
import { TemplateEngine } from '../utils/TemplateEngine';
import ColorLog from '../utils/ColorLog';

export class CodeSnippetFeature implements IFeature {
  public readonly id = 'CodeSnippetFeature';
  private cachedSnippets: ISnippetItem[] = [];

  constructor(
    private configService: ConfigurationService = ConfigurationService.getInstance(),
    private contextService: WorkspaceContextService = WorkspaceContextService.getInstance(),
  ) {}

  public activate(context: vscode.ExtensionContext): void {
    this.loadAllSnippets(context);

    this.configService.on('configChanged', () => this.loadAllSnippets(context));

    // 🌟 监听 SnippetGeneratorFeature 发来的更新事件，实时重载！
    this.configService.on('snippetsChanged', () => this.loadAllSnippets(context));

    const selector: vscode.DocumentSelector = ['javascript', 'typescript', 'vue', 'javascriptreact', 'typescriptreact', 'html', 'css', 'scss', 'less'];

    const provider = vscode.languages.registerCompletionItemProvider(selector, {
      provideCompletionItems: (document, position) => {
        return this.provideSnippets(document, position);
      },
    });

    context.subscriptions.push(provider);
    ColorLog.black(`[${this.id}]`, 'Activated.');
  }

  private provideSnippets(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] {
    if (this.cachedSnippets.length === 0) return [];

    const currentLangId = document.languageId;
    const ctx = this.contextService.context;

    // 1. 过滤逻辑
    const validSnippets = this.cachedSnippets.filter((item) => {
      if (!item.scope || item.scope.length === 0) return true;

      const languageScope = item.scope[0];

      if (languageScope) {
        if (Array.isArray(languageScope)) {
          if (!languageScope.includes(currentLangId)) return false;
        } else {
          if (languageScope !== currentLangId) return false;
        }
      }

      if (item.scope.length > 1 && item.scope[1]) {
        const dep = item.scope[1];
        if (dep === 'vue3' && !ctx.isVue3) return false;
        if (dep === 'vue2' && ctx.isVue3) return false;
        if (dep === 'react' && !ctx.isReact) return false;

        if (!['vue', 'vue2', 'vue3', 'react'].includes(dep as string) && !ctx.hasDependency(dep as string)) {
          return false;
        }
      }
      return true;
    });

    // 2. 渲染逻辑
    return validSnippets.map((item) => {
      const logItemObj: vscode.CompletionItemLabel = {
        label: item.prefix,
        description: `quick-ops/${item.origin || 'user'}`,
      };
      const completion = new vscode.CompletionItem(logItemObj, vscode.CompletionItemKind.Snippet);
      completion.detail = item.description || `Snippet for ${item.prefix}`;
      completion.sortText = '0';

      const { result } = TemplateEngine.render(item.body, { ...ctx, ...(item.params || {}) });

      completion.insertText = new vscode.SnippetString(result);
      completion.documentation = new vscode.MarkdownString().appendCodeblock(result, item.style || currentLangId);

      return completion;
    });
  }

  private async loadAllSnippets(context: vscode.ExtensionContext) {
    this.cachedSnippets = [];

    // 1. 加载默认预置片段
    const snippetsUri = vscode.Uri.joinPath(context.extensionUri, 'resources', 'snippets');
    const decoder = new TextDecoder('utf-8');

    try {
      const entries = await vscode.workspace.fs.readDirectory(snippetsUri);

      const readPromises = entries
        .filter(([name, type]) => type === vscode.FileType.File && name.endsWith('.json'))
        .map(async ([name]) => {
          try {
            const fileUri = vscode.Uri.joinPath(snippetsUri, name);
            const contentBytes = await vscode.workspace.fs.readFile(fileUri);
            const content = decoder.decode(contentBytes);

            const jsonData = JSON.parse(content);
            const fileName = name.replace(/\.json$/, '');

            if (Array.isArray(jsonData) && jsonData.length) {
              return jsonData.map((item: any) => ({ ...item, origin: fileName }));
            }
          } catch (e) {
            console.error(`Error parsing snippet ${name}:`, e);
          }
          return [];
        });

      const results = await Promise.all(readPromises);
      results.forEach((items) => this.cachedSnippets.push(...items));
    } catch (e) {
      console.warn('Snippets directory load failed or empty', e);
    }

    // 2. 加载存在工作区内存里的用户片段
    const workspaceSnippets = context.workspaceState.get<ISnippetItem[]>('quickOps.workspaceSnippets') || [];
    if (workspaceSnippets.length > 0) {
      this.cachedSnippets.push(...workspaceSnippets);
    }
  }
}
