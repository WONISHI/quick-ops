import * as vscode from 'vscode';
import { TextDecoder } from 'util'; // 用于将 Uint8Array 转为 string
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

    // 性能优化：快速检查前缀是否可能匹配（可选）
    // const linePrefix = document.lineAt(position).text.substr(0, position.character);

    const currentLangId = document.languageId;
    const ctx = this.contextService.context;

    // 1. 过滤逻辑
    const validSnippets = this.cachedSnippets.filter((item) => {
      // 如果没有定义 scope，默认对所有语言生效
      if (!item.scope || item.scope.length === 0) return true;

      // 获取第一个参数：语言范围
      const languageScope = item.scope[0];

      // 修改：支持字符串或数组
      if (languageScope) {
        if (Array.isArray(languageScope)) {
          //如果是数组，检查当前语言是否包含在内
          if (!languageScope.includes(currentLangId)) return false;
        } else {
          // 如果是字符串，检查是否相等
          if (languageScope !== currentLangId) return false;
        }
      }

      // 检查第二个参数：依赖库 (dependency)
      if (item.scope.length > 1 && item.scope[1]) {
        const dep = item.scope[1];
        // 特殊框架判断
        if (dep === 'vue3' && !ctx.isVue3) return false;
        if (dep === 'vue2' && ctx.isVue3) return false;
        if (dep === 'react' && !ctx.isReact) return false;

        // 通用依赖判断 (package.json dependencies/devDependencies)
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

    const snippetsUri = vscode.Uri.joinPath(context.extensionUri, 'resources', 'snippets');
    const decoder = new TextDecoder('utf-8');

    try {
      // 优化：vscode.workspace.fs.readDirectory 返回的是 [文件名, 文件类型] 的元组
      const entries = await vscode.workspace.fs.readDirectory(snippetsUri);

      // 并发读取处理
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
      // 目录不存在或读取失败，忽略
      console.warn('Snippets directory load failed or empty', e);
    }

    const userSnippets = this.configService.config['snippets'];
    if (Array.isArray(userSnippets)) {
      this.cachedSnippets.push(...userSnippets);
    }
  }
}
