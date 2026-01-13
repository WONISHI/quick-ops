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
            'javascript', 'typescript', 'vue', 'javascriptreact', 'typescriptreact'
        ];

        const provider = vscode.languages.registerCompletionItemProvider(
            selector,
            {
                provideCompletionItems: (document, position) => {
                    return this.provideLogs(document, position);
                }
            }
        );

        context.subscriptions.push(provider);
        console.log(`[${this.id}] Activated.`);
    }

    private provideLogs(document: vscode.TextDocument, position: number | vscode.Position): vscode.CompletionItem[] {
        // 1. 获取当前配置
        const templateStr = this.configService.config.logger.template || '[icon]-[line]-[$0]';
        
        // 2. 准备上下文数据
        const fileState = this.workspaceState.state;
        if (!fileState.uri) return []; // 没有打开文件

        const ctx = {
            line: typeof position === 'number' ? position : position.line,
            fileName: fileState.fileName,
            filePath: fileState.uri.fsPath,
            rootPath: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || ''
        };

        // 3. 生成参数数组
        const args = LogHelper.parseTemplate(templateStr, ctx, this.configService.config);
        
        // 4. 构造 console.log 语句
        // 结果示例: '🚀🚀🚀', '第10行', 'Index.vue文件', $0
        const argsString = args.map(arg => arg === '$0' ? '$0' : `'${arg}'`).join(', ');
        const insertText = `console.log(${argsString});`;

        // 5. 构建补全项 (cng, cg, log)
        const triggers = ['log', 'cg', 'cng'];
        
        return triggers.map(label => {
            const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Method);
            item.detail = `Quick Log: ${templateStr}`;
            item.insertText = new vscode.SnippetString(insertText);
            item.documentation = new vscode.MarkdownString()
                .appendMarkdown("### 生成结果 preview:\n")
                .appendCodeblock(insertText, 'javascript');
            item.sortText = '0000'; // 保证排在最前
            return item;
        });
    }
}