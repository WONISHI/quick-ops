import * as vscode from 'vscode';
import { TextDecoder } from 'util';

import { TemplateEngine } from '../../utils/TemplateEngine';
import { ExtensionContextProvider } from '../../common/providers/extension-context.provider';
import { WorkspaceContextService } from '../../common/services/workspace-context.service';

import type { IWorkspaceContext } from '../../core/types/work-space';
import type {
  CodeSnippetDependencyScope,
  CodeSnippetInputInfo,
  CodeSnippetItem,
  CodeSnippetLanguageScope,
} from './code-snippet.type';

export class CodeSnippetService {
  public static inject = [ExtensionContextProvider, WorkspaceContextService];

  private cachedSnippets: CodeSnippetItem[] = [];

  constructor(
    private readonly extensionContextProvider: ExtensionContextProvider,
    private readonly workspaceContextService: WorkspaceContextService,
  ) {}

  public async loadAllSnippets(): Promise<void> {
    this.cachedSnippets = [];

    await this.loadExtensionSnippets();
    await this.loadWorkspaceSnippets();
  }

  public provideSnippets(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.CompletionItem[] {
    if (this.cachedSnippets.length === 0) return [];

    const inputInfo = this.getCurrentInputInfo(document, position);

    if (!inputInfo.wordBefore) return [];

    /**
     * 光标后面还有单词，说明是在 abc 中间输入。
     * 这种情况不要提示，行为更接近 VSCode 原生。
     */
    if (inputInfo.wordAfter) return [];

    const currentLangId = document.languageId;
    const workspaceContext = this.workspaceContextService.context;

    const validSnippets = this.cachedSnippets.filter(item => {
      return this.isSnippetAvailable(item, inputInfo.wordBefore, currentLangId, workspaceContext);
    });

    return validSnippets.map(item => {
      return this.createCompletionItem(item, inputInfo, position, currentLangId, workspaceContext);
    });
  }

  public getCachedSnippets(): CodeSnippetItem[] {
    return [...this.cachedSnippets];
  }

  public clearCache(): void {
    this.cachedSnippets = [];
  }

  private async loadExtensionSnippets(): Promise<void> {
    const context = this.extensionContextProvider.getContext();
    const snippetsUri = vscode.Uri.joinPath(context.extensionUri, 'resources', 'snippets');
    const decoder = new TextDecoder('utf-8');

    try {
      const entries = await vscode.workspace.fs.readDirectory(snippetsUri);

      const readTasks = entries
        .filter(([name, type]) => {
          return type === vscode.FileType.File && name.endsWith('.json');
        })
        .map(async ([name]) => {
          try {
            const fileUri = vscode.Uri.joinPath(snippetsUri, name);
            const contentBytes = await vscode.workspace.fs.readFile(fileUri);
            const content = decoder.decode(contentBytes);
            const jsonData = JSON.parse(content);
            const origin = name.replace(/\.json$/, '');

            if (!Array.isArray(jsonData)) return [];

            return jsonData
              .filter(Boolean)
              .map((item: any) => this.normalizeSnippetItem(item, origin))
              .filter(Boolean) as CodeSnippetItem[];
          } catch (error) {
            console.error(`[CodeSnippetService] Error parsing snippet ${name}:`, error);
            return [];
          }
        });

      const results = await Promise.all(readTasks);

      results.forEach(items => {
        this.cachedSnippets.push(...items);
      });
    } catch (error) {
      console.warn('[CodeSnippetService] Snippets directory load failed or empty:', error);
    }
  }

  private async loadWorkspaceSnippets(): Promise<void> {
    const context = this.extensionContextProvider.getContext();

    const workspaceSnippets = context.workspaceState.get<CodeSnippetItem[]>(
      'quickOps.workspaceSnippets',
      [],
    );

    if (!Array.isArray(workspaceSnippets) || workspaceSnippets.length === 0) {
      return;
    }

    const normalizedSnippets = workspaceSnippets
      .map(item => this.normalizeSnippetItem(item, item.origin || 'workspace'))
      .filter(Boolean) as CodeSnippetItem[];

    this.cachedSnippets.push(...normalizedSnippets);
  }

  private normalizeSnippetItem(item: any, origin: string): CodeSnippetItem | null {
    if (!item || typeof item !== 'object') return null;

    if (!item.prefix || !item.body) return null;

    return {
      prefix: item.prefix,
      body: item.body,
      description: item.description,
      origin: item.origin || origin,
      params: item.params || {},
      scope: item.scope,
      style: item.style,
    };
  }

  private isSnippetAvailable(
    item: CodeSnippetItem,
    input: string,
    currentLangId: string,
    context: IWorkspaceContext,
  ): boolean {
    if (!this.isPrefixMatched(item.prefix, input)) {
      return false;
    }

    if (!item.scope || item.scope.length === 0) {
      return true;
    }

    const languageScope = item.scope[0];

    if (languageScope) {
      if (!this.isLanguageMatched(languageScope, currentLangId)) {
        return false;
      }
    }

    const dependencyScope = item.scope[1];

    if (dependencyScope) {
      if (!this.isDependencyMatched(dependencyScope, context)) {
        return false;
      }
    }

    return true;
  }

  private isLanguageMatched(
    languageScope: CodeSnippetLanguageScope,
    currentLangId: string,
  ): boolean {
    if (Array.isArray(languageScope)) {
      return languageScope.includes(currentLangId);
    }

    return languageScope === currentLangId;
  }

  private isDependencyMatched(
    dependencyScope: CodeSnippetDependencyScope,
    context: IWorkspaceContext,
  ): boolean {
    if (dependencyScope === 'vue') {
      return context.isVue3 || context.hasDependency('vue');
    }

    if (dependencyScope === 'vue3') {
      return context.isVue3;
    }

    if (dependencyScope === 'vue2') {
      return context.hasDependency('vue') && !context.isVue3;
    }

    if (dependencyScope === 'react') {
      return context.isReact;
    }

    return context.hasDependency(dependencyScope);
  }

  private createCompletionItem(
    item: CodeSnippetItem,
    inputInfo: CodeSnippetInputInfo,
    position: vscode.Position,
    currentLangId: string,
    context: IWorkspaceContext,
  ): vscode.CompletionItem {
    const label = this.getSnippetLabel(item.prefix);

    const completion = new vscode.CompletionItem(
      {
        label,
        description: `quick-ops/${item.origin || 'user'}`,
      },
      vscode.CompletionItemKind.Snippet,
    );

    const renderContext: IWorkspaceContext = {
      ...context,
      ...(item.params || {}),
    };

    const { result } = TemplateEngine.render(item.body, renderContext);

    completion.detail = item.description || `Snippet for ${label}`;
    completion.sortText = '0';
    completion.insertText = new vscode.SnippetString(result);

    completion.documentation = new vscode.MarkdownString().appendCodeblock(
      result,
      item.style || currentLangId,
    );

    completion.range = new vscode.Range(inputInfo.startPosition, position);

    return completion;
  }

  private getCurrentInputInfo(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): CodeSnippetInputInfo {
    const lineText = document.lineAt(position.line).text;
    const beforeText = lineText.slice(0, position.character);
    const afterText = lineText.slice(position.character);

    const beforeMatch = beforeText.match(/[A-Za-z0-9_$-]+$/);
    const afterMatch = afterText.match(/^[A-Za-z0-9_$-]+/);

    const wordBefore = beforeMatch ? beforeMatch[0] : '';
    const wordAfter = afterMatch ? afterMatch[0] : '';

    const startPosition = new vscode.Position(
      position.line,
      position.character - wordBefore.length,
    );

    return {
      wordBefore,
      wordAfter,
      startPosition,
    };
  }

  private isPrefixMatched(prefix: string | string[], input: string): boolean {
    if (!input) return false;

    if (Array.isArray(prefix)) {
      return prefix.some(item => item.startsWith(input));
    }

    return prefix.startsWith(input);
  }

  private getSnippetLabel(prefix: string | string[]): string {
    if (Array.isArray(prefix)) {
      return prefix[0] || '';
    }

    return prefix;
  }
}