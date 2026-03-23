import * as vscode from 'vscode';
import { IFeature } from '../core/interfaces/IFeature';
import { WorkspaceContextService } from '../services/WorkspaceContextService';
import { ConfigurationService } from '../services/ConfigurationService';
import ColorLog from '../utils/ColorLog';

export class SnippetGeneratorFeature implements IFeature {
  public readonly id = 'SnippetGeneratorFeature';
  private extensionContext!: vscode.ExtensionContext;

  constructor(
    private contextService: WorkspaceContextService = WorkspaceContextService.getInstance(),
    // 🌟 注入 ConfigurationService，用作事件通知总线
    private configService: ConfigurationService = ConfigurationService.getInstance(),
  ) {}

  public activate(context: vscode.ExtensionContext): void {
    this.extensionContext = context;
    const commandId = 'quick-ops.addToSnippets';

    context.subscriptions.push(
      vscode.commands.registerTextEditorCommand(commandId, (textEditor) => {
        this.generateAndSaveSnippet(textEditor);
      }),
    );

    ColorLog.black(`[${this.id}]`, 'Activated.');
  }

  private async generateAndSaveSnippet(editor: vscode.TextEditor) {
    const selection = editor.selection;
    const text = editor.document.getText(selection);

    if (!text.trim()) {
      vscode.window.showWarningMessage('请先选择一段代码');
      return;
    }

    // 交互式输入：获取 Prefix 和 Description
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

    // 生成 Snippet 对象
    const snippetItem = this.createSnippetItem(editor.document, text, prefix, description || prefix);

    try {
      // 🌟 核心修改：从工作区内存中读取已有的 snippets
      let snippets = this.extensionContext.workspaceState.get<any[]>('quickOps.workspaceSnippets') || [];

      // 追加新的代码片段
      snippets.push(snippetItem);

      // 🌟 核心修改：将合并后的数组存回工作区内存
      await this.extensionContext.workspaceState.update('quickOps.workspaceSnippets', snippets);

      // 通知 CodeSnippetFeature 刷新它的内存缓存
      this.configService.emit('snippetsChanged');

      vscode.window.showInformationMessage(`✨ 代码片段 "${prefix}" 已保存至工作区内存！`);
    } catch (e) {
      vscode.window.showErrorMessage('保存代码片段失败');
    }
  }

  private createSnippetItem(document: vscode.TextDocument, rawText: string, prefix: string, description: string) {
    const ctx = this.contextService.context;
    const langId = document.languageId;

    const scope: string[] = [langId];

    if (langId === 'vue') {
      scope.push(ctx.isVue3 ? 'vue3' : 'vue2');
    } else if (langId === 'javascriptreact' || langId === 'typescriptreact' || ctx.isReact) {
      scope.push('react');
    }

    const body = this.formatBody(rawText);

    return {
      prefix: prefix,
      scope: scope,
      body: body,
      style: langId,
      description: description,
    };
  }

  /**
   * 智能处理代码缩进
   */
  private formatBody(text: string): string | string[] {
    const lines = text.split(/\r?\n/);
    if (lines.length <= 1) return lines[0];

    let minIndent = Infinity;
    lines.forEach((line) => {
      if (line.trim().length > 0) {
        const match = line.match(/^(\s*)/);
        if (match) {
          minIndent = Math.min(minIndent, match[1].length);
        }
      }
    });

    if (minIndent === Infinity) minIndent = 0;

    const formattedLines = lines.map((line) => {
      return line.length >= minIndent ? line.slice(minIndent) : '';
    });

    return formattedLines;
  }
}
