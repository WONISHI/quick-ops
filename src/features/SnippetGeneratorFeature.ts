import * as vscode from 'vscode';
import { TextDecoder } from 'util';
import type { ISnippetItem } from '../core/types/snippet';
import { IFeature } from '../core/interfaces/IFeature';
import { ConfigurationService } from '../services/ConfigurationService';
import { WorkspaceContextService } from '../services/WorkspaceContextService';
import { TemplateEngine } from '../utils/TemplateEngine';
import ColorLog from '../utils/ColorLog';

export class SnippetGeneratorFeature implements IFeature {
  public readonly id = 'SnippetGeneratorFeature';
  private cachedSnippets: ISnippetItem[] = [];
  
  // 🌟 性能优化核心：标志位
  private isSnippetsLoaded = false;
  private extensionContext!: vscode.ExtensionContext;

  constructor(
    private configService: ConfigurationService = ConfigurationService.getInstance(),
    private contextService: WorkspaceContextService = WorkspaceContextService.getInstance(),
  ) {}

  public activate(context: vscode.ExtensionContext): void {
    this.extensionContext = context;

    // 🌟 优化 1：不再在 activate 中调用 loadAllSnippets！
    // 插件启动时什么都不读，真正的“零耗时”启动！

    // 🌟 优化 2：配置改变时，我们不去立刻读取文件，而是把标志位设为 false
    // 这样下次用户敲击键盘时，自然会重新触发最新的加载逻辑
    this.configService.on('configChanged', () => {
      this.isSnippetsLoaded = false;
    });

    // 注册“添加选中内容到代码片段”命令
    context.subscriptions.push(
      vscode.commands.registerTextEditorCommand('quick-ops.addToSnippets', (textEditor) => {
        this.generateAndSaveSnippet(textEditor, context);
      }),
    );

    const selector: vscode.DocumentSelector = ['javascript', 'typescript', 'vue', 'javascriptreact', 'typescriptreact', 'html', 'css', 'scss', 'less'];

    // 注册代码补全 Provider
    const provider = vscode.languages.registerCompletionItemProvider(selector, {
      // 🌟 优化 3：将提供者变成 async 函数，拦截第一次按键
      provideCompletionItems: async (document, position) => {
        // 懒加载：只有用户第一次试图获取补全提示时，才去拉取文件和内存
        if (!this.isSnippetsLoaded) {
          await this.loadAllSnippets(this.extensionContext);
          this.isSnippetsLoaded = true;
          ColorLog.green(`[${this.id}]`, 'Snippets Lazy Loaded on first keystroke!');
        }
        
        // 返回处理好的提示项
        return this.renderSnippets(document, position);
      },
    });

    context.subscriptions.push(provider);
    ColorLog.black(`[${this.id}]`, 'Activated (Standby Mode).');
  }

  // ============================================================================
  // 模块 1：生成与保存 (合并了原来的 SnippetGeneratorFeature)
  // ============================================================================

  private async generateAndSaveSnippet(editor: vscode.TextEditor, context: vscode.ExtensionContext) {
    const selection = editor.selection;
    const text = editor.document.getText(selection);

    if (!text.trim()) {
      vscode.window.showWarningMessage('请先选择一段代码');
      return;
    }

    const prefix = await vscode.window.showInputBox({
      title: '生成代码片段',
      placeHolder: '请输入触发前缀 (Prefix)',
      prompt: '例如: vue3-comp, log-error',
      validateInput: (val) => (val ? null : '前缀不能为空'),
    });
    if (!prefix) return;

    const description = await vscode.window.showInputBox({
      title: '生成代码片段',
      placeHolder: '请输入描述 (Description)',
      value: `User Snippet: ${prefix}`,
    });

    const snippetItem = this.createSnippetItem(editor.document, text, prefix, description || prefix);

    try {
      // 从工作区读取、追加、写回
      let workspaceSnippets = context.workspaceState.get<ISnippetItem[]>('quickOps.workspaceSnippets') || [];
      workspaceSnippets.push(snippetItem);
      await context.workspaceState.update('quickOps.workspaceSnippets', workspaceSnippets);

      // 🌟 优化 4：如果缓存已经激活，直接推入内存，即存即用；如果还没激活，什么都不做，下次按键自动全量拉取
      if (this.isSnippetsLoaded) {
        this.cachedSnippets.push(snippetItem);
      }

      vscode.window.showInformationMessage(`✨ 代码片段 "${prefix}" 已保存至工作区内存！`);
    } catch (e) {
      vscode.window.showErrorMessage('保存代码片段失败');
    }
  }

  private createSnippetItem(document: vscode.TextDocument, rawText: string, prefix: string, description: string): ISnippetItem {
    const ctx = this.contextService.context;
    const langId = document.languageId;
    const scope: string[] = [langId];

    if (langId === 'vue') {
      scope.push(ctx.isVue3 ? 'vue3' : 'vue2');
    } else if (langId === 'javascriptreact' || langId === 'typescriptreact' || ctx.isReact) {
      scope.push('react');
    }

    return {
      prefix,
      scope,
      body: this.formatBody(rawText),
      style: langId,
      description,
    };
  }

// 🌟 修复：把返回类型强制收拢为统一的 string[]
  private formatBody(text: string): string[] {
    const lines = text.split(/\r?\n/);
    
    // 🌟 修复：如果是单行，直接返回 lines 数组，而不是 lines[0] 字符串
    if (lines.length <= 1) return lines;

    let minIndent = Infinity;
    lines.forEach((line) => {
      if (line.trim().length > 0) {
        const match = line.match(/^(\s*)/);
        if (match) minIndent = Math.min(minIndent, match[1].length);
      }
    });

    if (minIndent === Infinity) minIndent = 0;
    return lines.map((line) => (line.length >= minIndent ? line.slice(minIndent) : ''));
  }

  // ============================================================================
  // 模块 2：读取与渲染提示 (优化后的渲染逻辑)
  // ============================================================================

  private renderSnippets(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] {
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