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
        const selector: vscode.DocumentSelector = [
            'javascript', 'typescript', 'vue', 'javascriptreact', 'typescriptreact', 
            'html', 'css', 'scss', 'less'
        ];

        const provider = vscode.languages.registerCompletionItemProvider(
            selector, 
            {
                provideCompletionItems: (document, position) => {
                    return this.provideSnippets(document, position);
                }
            }
        );

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
        
        // 1. 过滤：前缀匹配 + Scope 匹配
        const validSnippets = this.cachedSnippets.filter(item => {
            // A. 前缀匹配 (简单的 startsWith，VSCode 会自己做模糊匹配，但这里先做一层初筛优化性能)
            // 如果你希望输入 'vu' 也能提示 'vue3'，可以去掉这个 strict check，交给 VS Code 处理
            // const prefixMatch = item.prefix.startsWith(lineText) || lineText.startsWith(item.prefix); 
            
            // B. Scope 匹配 (智能核心)
            const scopeMatch = this.checkScope(item.scope);
            
            return scopeMatch;
        });

        if (validSnippets.length === 0) return [];

        const currentState = this.workspaceState.state;
        const currentFileName = currentState.fileName || 'Unknown';

        // 2. 转换：生成 CompletionItem
        return validSnippets.map(item => {
            const completion = new vscode.CompletionItem(item.prefix, vscode.CompletionItemKind.Snippet);
            completion.detail = item.description || item.prefix;
            
            // 排序权重：让匹配度高的靠前
            completion.sortText = '0'; 

            // 3. 处理 Body (动态变量替换)
            let bodyStr = item.body.join('\n');
            bodyStr = this.processDynamicVariables(bodyStr, currentFileName);

            completion.insertText = new vscode.SnippetString(bodyStr);
            completion.documentation = new vscode.MarkdownString().appendCodeblock(bodyStr, 'vue'); // 默认高亮

            return completion;
        });
    }

    /**
     * 变量替换核心逻辑
     * 处理 [[languagesCss]], {module-name} 等
     */
    private processDynamicVariables(body: string, fileName: string): string {
        let result = body;

        // 1. {module-name} -> 文件名 (去后缀)
        // 例如: UserProfile.vue -> UserProfile
        const moduleName = fileName.includes('.') ? fileName.split('.')[0] : fileName;
        result = result.replace(/\{module-name\}/g, moduleName);

        // 2. [[languagesCss]] -> 样式语言 (scss/less/css)
        // 策略：优先读取配置，没有则根据项目依赖猜测，最后默认 scss
        const cssLang = this.detectCssLanguage();
        result = result.replace(/\[\[languagesCss\]\]/g, cssLang);

        return result;
    }

    /**
     * 依赖匹配逻辑
     * 检查 snippet 的 scope 是否符合当前项目的依赖
     */
    private checkScope(scope?: string[]): boolean {
        // 如果没有定义 scope，说明是通用的，直接通过
        if (!scope || scope.length === 0) return true;

        // 只要满足 scope 中的任意一个条件即可 (OR 逻辑)
        // 或者你需要 AND 逻辑？通常是 OR (例如 scope: ["vue2", "vue3"] 表示通用)
        // 但这里你的例子是 ["vue", "vue2"]，我们假设必须满足其中之一的关键依赖
        
        // 策略：snippet 的 scope 列表中的所有项，只要有一项在当前项目依赖中存在，就认为匹配
        // 例如：当前项目是 vue2。
        // Snippet A scope: ["vue", "vue2"] -> 匹配 (因为项目有 vue，且版本判断符合 vue2)
        // Snippet B scope: ["react"] -> 不匹配
        
        return scope.some(s => this.projectDependencies.has(s));
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
                files.forEach(file => {
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

        // 2. 加载用户自定义片段 (从 .logrc / ConfigService)
        // 假设 ConfigService 中有一个 customSnippets 字段
        // const userSnippets = this.configService.config['customSnippets'] as ISnippetItem[];
        // if (Array.isArray(userSnippets)) {
        //    this.cachedSnippets.push(...userSnippets);
        // }
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
            Object.keys(deps).forEach(dep => this.projectDependencies.add(dep));

            // 2. 版本特定标记 (Vue2 vs Vue3)
            if (deps['vue']) {
                const version = deps['vue'];
                if (version.startsWith('^2') || version.startsWith('~2') || version.startsWith('2')) {
                    this.projectDependencies.add('vue2');
                    this.projectDependencies.add('vue2x');
                } else if (version.startsWith('^3') || version.startsWith('~3') || version.startsWith('3')) {
                    this.projectDependencies.add('vue3');
                }
            }

            // 3. React 特定标记
            if (deps['react']) {
                this.projectDependencies.add('react');
                // 可以加 react18 等判断
            }

            // 4. CSS 预处理器
            if (deps['less']) this.projectDependencies.add('less');
            if (deps['sass'] || deps['node-sass']) this.projectDependencies.add('scss');

        } catch (e) {
            console.warn(`[${this.id}] Failed to parse package.json`);
        }
    }

    /**
     * 猜测 CSS 语言
     */
    private detectCssLanguage(): string {
        if (this.projectDependencies.has('less')) return 'less';
        if (this.projectDependencies.has('scss') || this.projectDependencies.has('sass')) return 'scss';
        return 'css'; // 默认
    }

    private watchPackageJson() {
        const watcher = vscode.workspace.createFileSystemWatcher('**/package.json');
        watcher.onDidChange(() => this.analyzeProjectDependencies());
        watcher.onDidCreate(() => this.analyzeProjectDependencies());
        watcher.onDidDelete(() => this.projectDependencies.clear());
    }
}