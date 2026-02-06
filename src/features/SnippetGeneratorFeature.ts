import * as vscode from 'vscode';
import { TextDecoder, TextEncoder } from 'util';
import { IFeature } from '../core/interfaces/IFeature';
import { WorkspaceContextService } from '../services/WorkspaceContextService';

export class SnippetGeneratorFeature implements IFeature {
  public readonly id = 'SnippetGeneratorFeature';

  constructor(private contextService: WorkspaceContextService = WorkspaceContextService.getInstance()) {}

  public activate(context: vscode.ExtensionContext): void {
    const commandId = 'quick-ops.addToSnippets';

    // 注册文本编辑器命令，可以直接获取 textEditor
    context.subscriptions.push(
      vscode.commands.registerTextEditorCommand(commandId, (textEditor) => {
        this.generateAndSaveSnippet(textEditor);
      })
    );

    console.log(`[${this.id}] Activated.`);
  }

  private async generateAndSaveSnippet(editor: vscode.TextEditor) {
    const selection = editor.selection;
    const text = editor.document.getText(selection);

    if (!text.trim()) {
      vscode.window.showWarningMessage('请先选择一段代码');
      return;
    }

    // 1. 获取工作区根目录 Uri
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
    if (!workspaceFolder) {
      vscode.window.showErrorMessage('请在工作区中打开文件以保存配置');
      return;
    }
    const configUri = vscode.Uri.joinPath(workspaceFolder.uri, '.quickopsrc');

    // 2. 交互式输入：获取 Prefix 和 Description (优化体验)
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

    // 3. 生成 Snippet 对象 (带智能去缩进)
    const snippetItem = this.createSnippetItem(editor.document, text, prefix, description || prefix);

    // 4. 读取配置 (使用 VS Code FS)
    let config: any = {};
    const decoder = new TextDecoder('utf-8');

    try {
      const contentUint8 = await vscode.workspace.fs.readFile(configUri);
      const content = decoder.decode(contentUint8);
      config = JSON.parse(content);
    } catch (e) {
      // 文件不存在，初始化为空对象，继续执行
      config = {};
    }

    // 5. 写入配置
    if (!Array.isArray(config.snippets)) {
      config.snippets = [];
    }

    config.snippets.push(snippetItem);

    try {
      const encoder = new TextEncoder();
      const newContent = JSON.stringify(config, null, 2);
      await vscode.workspace.fs.writeFile(configUri, encoder.encode(newContent));

      const action = await vscode.window.showInformationMessage(`代码片段 "${prefix}" 已保存!`, '查看配置文件');

      if (action === '查看配置文件') {
        const doc = await vscode.workspace.openTextDocument(configUri);
        await vscode.window.showTextDocument(doc);
      }
    } catch (e) {
      vscode.window.showErrorMessage('写入配置文件失败');
    }
  }

  private createSnippetItem(document: vscode.TextDocument, rawText: string, prefix: string, description: string) {
    const ctx = this.contextService.context;
    const langId = document.languageId;

    // --- 1. 处理 Scope (依赖判断) ---
    const scope: string[] = [langId];

    if (langId === 'vue') {
      scope.push(ctx.isVue3 ? 'vue3' : 'vue2');
    } else if (langId === 'javascriptreact' || langId === 'typescriptreact' || ctx.isReact) {
      scope.push('react');
    }

    // --- 2. 处理 Body (智能去缩进) ---
    const body = this.formatBody(rawText);

    // --- 3. 组装对象 ---
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
   * 移除所有行共有的最小缩进，防止粘贴时缩进翻倍
   */
  private formatBody(text: string): string | string[] {
    const lines = text.split(/\r?\n/);
    if (lines.length <= 1) return lines[0]; // 单行直接返回

    // 1. 找到所有非空行的最小缩进量
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

    // 2. 移除公共缩进
    const formattedLines = lines.map((line) => {
      // 如果该行比最小缩进还短（通常是空行），直接给空串
      return line.length >= minIndent ? line.slice(minIndent) : '';
    });

    return formattedLines;
  }
}
