import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { IFeature } from '../core/interfaces/IFeature';
import { ConfigurationService } from '../services/ConfigurationService';
import { WorkspaceStateService } from '../services/WorkspaceStateService';

// 定义 Snippet 接口
interface ISnippetItem {
  prefix: string;
  body: string[];
  description?: string;
  /**
   * Scope 定义:
   * index 0: 文件语言类型 (e.g., "vue", "javascript")
   * index 1: 项目依赖限制 (e.g., "vue2", "react")
   */
  scope?: string[];
}

export class CodeSnippetFeature implements IFeature {
  public readonly id = 'CodeSnippetFeature';

  // 缓存所有加载的片段
  private cachedSnippets: ISnippetItem[] = [];
  // 缓存当前项目的依赖分析结果 (如: ['vue', 'vue3', 'less'])
  private projectDependencies: Set<string> = new Set();

  constructor(
    private configService: ConfigurationService = ConfigurationService.getInstance(),
    private workspaceState: WorkspaceStateService = WorkspaceStateService.getInstance(),
  ) {}

  public activate(context: vscode.ExtensionContext): void {
    // 1. 初始化：分析项目依赖 & 加载片段
    this.analyzeProjectDependencies();
    this.loadAllSnippets(context);

    // 监听 package.json 变化，重新分析依赖
    this.watchPackageJson();

    // 2. 注册补全提供者
    // 涵盖主流前端语言
    const selector: vscode.DocumentSelector = ['javascript', 'typescript', 'vue', 'javascriptreact', 'typescriptreact', 'html', 'css', 'scss', 'less'];

    const provider = vscode.languages.registerCompletionItemProvider(selector, {
      provideCompletionItems: (document, position) => {
        return this.provideSnippets(document, position);
      },
    });

    context.subscriptions.push(provider);
    console.log(`[${this.id}] Activated. Loaded ${this.cachedSnippets.length} snippets.`);
  }

  /**
   * 核心逻辑：提供代码片段
   */
  private provideSnippets(document: vscode.TextDocument, position: number | vscode.Position): vscode.CompletionItem[] {
    if (this.cachedSnippets.length === 0) return [];
    // @ts-ignore
    const lineText = document.lineAt(position).text.trim();
    if (lineText.trim().startsWith('import') || lineText.trim().startsWith('export')) {
      return [];
    }
    const currentLangId = document.languageId; // 获取当前文件语言ID (如 'vue', 'typescript')

    // 1. 过滤：前缀匹配 + Scope 匹配
    const validSnippets = this.cachedSnippets.filter((item) => {
      // A. 前缀匹配 (交给 VS Code 模糊匹配，此处可选做初筛)
      // const prefixMatch = item.prefix.startsWith(lineText);

      // B. Scope 匹配 (根据新的 [文件类型, 依赖环境] 逻辑)
      const scopeMatch = this.checkScope(item.scope, currentLangId);

      return scopeMatch;
    });

    if (validSnippets.length === 0) return [];

    const currentState = this.workspaceState.state;
    const currentFileName = currentState.fileName || 'Unknown';

    // 2. 转换：生成 CompletionItem
    return validSnippets.map((item) => {
      const completion = new vscode.CompletionItem(item.prefix, vscode.CompletionItemKind.Snippet);
      completion.detail = item.description || item.prefix;

      // 排序权重：让匹配度高的靠前
      completion.sortText = '0';

      // 3. 处理 Body (动态变量替换)
      let bodyStr = item.body.join('\n');
      bodyStr = this.processDynamicVariables(bodyStr, currentFileName);

      completion.insertText = new vscode.SnippetString(bodyStr);
      // 这里为了更好的显示效果，可以将 markdown 语言设置为当前文件语言，或者默认 vue/js
      completion.documentation = new vscode.MarkdownString().appendCodeblock(bodyStr, currentLangId || 'javascript');

      return completion;
    });
  }

  /**
   * 变量替换核心逻辑
   * 处理 [[languagesCss]], {module-name} 等
   */
  private processDynamicVariables(body: string, fileName: string): string {
    let result = body;

    // 1. [[module-name]] -> 文件名 (去后缀)
    const moduleName = fileName.includes('.') ? fileName.split('.')[0] : fileName;
    result = result.replace(/\[\[module-name\]\]/g, moduleName);

    // 2. [[languages-css]] -> 样式语言 (scss/less/css)
    const cssLang = this.detectCssLanguage();
    result = result.replace(/\[\[languages-css\]\]/g, cssLang);

    return result;
  }

  /**
   * 依赖匹配逻辑 (核心修改)
   * 规则:
   * - 如果没有 scope，则所有环境通用
   * - scope[0]: 必须匹配当前文件类型 (languageId)
   * - scope[1]: 必须存在于当前项目依赖 (package.json)
   */
  private checkScope(scope: string[] | undefined, currentLangId: string): boolean {
    if (!scope || scope.length === 0) return true;
    const targetFileType = scope[0];
    // 如果定义了文件类型限制，且与当前文件类型不符，则不显示
    if (targetFileType && targetFileType !== currentLangId) {
      return false;
    }

    // 2. 检查依赖环境 (scope[1])
    if (scope.length > 1) {
      const targetDependency = scope[1];
      // 如果定义了依赖限制，但当前项目依赖中没有该依赖，则不显示
      if (targetDependency && !this.projectDependencies.has(targetDependency)) {
        return false;
      }
    }

    return true;
  }

  /**
   * 加载所有片段 (内部 + 用户自定义)
   */
  private loadAllSnippets(context: vscode.ExtensionContext) {
    this.cachedSnippets = [];

    // 1. 加载内部片段 (resources/snippets/*.json)
    const snippetDir = path.join(context.extensionPath, 'resources', 'snippets');
    if (fs.existsSync(snippetDir)) {
      try {
        const files = fs.readdirSync(snippetDir);
        files.forEach((file) => {
          if (file.endsWith('.json')) {
            const filePath = path.join(snippetDir, file);
            const content = fs.readFileSync(filePath, 'utf-8');
            const json = JSON.parse(content);
            if (Array.isArray(json)) {
              this.cachedSnippets.push(...json);
            }
          }
        });
      } catch (e) {
        console.error(`[${this.id}] Failed to load internal snippets`, e);
      }
    }

    // 2. 加载用户自定义片段 (从 .logrc)
    // 支持用户在 .logrc 中自定义 snippets
    const userSnippets = this.configService.config['snippets'];
    if (Array.isArray(userSnippets)) {
      // @ts-ignore
      this.cachedSnippets.push(...userSnippets);
    }
  }

  /**
   * 分析项目依赖 (package.json)
   */
  private analyzeProjectDependencies() {
    this.projectDependencies.clear();

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) return;

    const pkgPath = path.join(workspaceRoot, 'package.json');
    if (!fs.existsSync(pkgPath)) return;

    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };

      // 1. 基础依赖注入
      Object.keys(deps).forEach((dep) => this.projectDependencies.add(dep));

      // 2. 版本特定标记 (Vue2 vs Vue3)
      if (deps['vue']) {
        const version = deps['vue'];
        // 简单的版本判断逻辑
        if (version.match(/(^|[^0-9])2\./)) {
          this.projectDependencies.add('vue2');
          this.projectDependencies.add('vue2x');
        } else if (version.match(/(^|[^0-9])3\./)) {
          this.projectDependencies.add('vue3');
        }
      }

      // 3. React 标记
      if (deps['react']) {
        this.projectDependencies.add('react');
        // 可以扩展 react18 等判断
      }

      // 4. CSS 预处理器
      if (deps['less']) this.projectDependencies.add('less');
      if (deps['sass'] || deps['node-sass'] || deps['sass-loader']) this.projectDependencies.add('scss');

    } catch (e) {
      console.warn(`[${this.id}] Failed to parse package.json`);
    }
  }

  /**
   * 猜测 CSS 语言
   */
  private detectCssLanguage(): string {
    if (this.projectDependencies.has('less')) return 'less';
    if (this.projectDependencies.has('scss')) return 'scss';
    return 'css'; // 默认
  }

  private watchPackageJson() {
    const watcher = vscode.workspace.createFileSystemWatcher('**/package.json');
    watcher.onDidChange(() => this.analyzeProjectDependencies());
    watcher.onDidCreate(() => this.analyzeProjectDependencies());
    watcher.onDidDelete(() => this.projectDependencies.clear());
  }
}
