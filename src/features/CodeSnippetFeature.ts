import * as vscode from 'vscode';
import { TextDecoder } from 'util';
import type { ISnippetItem } from '../core/types/snippet';
import { IFeature } from '../core/interfaces/feature.interface';
import { ConfigurationService } from '../common/services/configuration.service';
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

    const currentInputInfo = this.getCurrentInputInfo(document, position);

    // 光标前面没有输入内容，不主动返回片段
    if (!currentInputInfo.wordBefore) return [];

    // 光标后面还有单词内容，说明是在 a 和 b 中间输入，这种情况不提示
    if (currentInputInfo.wordAfter) return [];

    const currentLangId = document.languageId;
    const ctx = this.contextService.context;

    // 1. 过滤逻辑
    const validSnippets = this.cachedSnippets.filter((item) => {
      if (!this.isPrefixMatched(item.prefix, currentInputInfo.wordBefore)) {
        return false;
      }

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

      // 只替换当前输入的关键字，比如输入 v，选择 vue2 片段时只替换 v
      completion.range = new vscode.Range(currentInputInfo.startPosition, position);

      return completion;
    });
  }

  private getCurrentInputInfo(document: vscode.TextDocument, position: vscode.Position) {
    const lineText = document.lineAt(position.line).text;
    const beforeText = lineText.slice(0, position.character);
    const afterText = lineText.slice(position.character);

    const beforeMatch = beforeText.match(/[A-Za-z0-9_$-]+$/);
    const afterMatch = afterText.match(/^[A-Za-z0-9_$-]+/);

    const wordBefore = beforeMatch ? beforeMatch[0] : '';
    const wordAfter = afterMatch ? afterMatch[0] : '';

    const startPosition = new vscode.Position(position.line, position.character - wordBefore.length);

    return {
      wordBefore,
      wordAfter,
      startPosition,
    };
  }

  private isPrefixMatched(prefix: string | string[], input: string): boolean {
    if (!input) return false;

    if (Array.isArray(prefix)) {
      return prefix.some((item) => item.startsWith(input));
    }

    return prefix.startsWith(input);
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
