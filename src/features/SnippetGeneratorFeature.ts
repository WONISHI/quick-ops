import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { IFeature } from '../core/interfaces/IFeature';
import { WorkspaceContextService } from '../services/WorkspaceContextService';

export class SnippetGeneratorFeature implements IFeature {
  public readonly id = 'SnippetGeneratorFeature';

  constructor(
    private contextService: WorkspaceContextService = WorkspaceContextService.getInstance()
  ) {}

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

    // 1. 获取工作区根目录
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      vscode.window.showErrorMessage('请在工作区中打开文件以保存配置');
      return;
    }
    const rootPath = workspaceFolders[0].uri.fsPath;
    const configPath = path.join(rootPath, '.quickopsrc');

    // 2. 生成 Snippet 对象
    const snippetItem = this.createSnippetItem(editor.document, text);

    // 3. 读取或创建配置文件
    let config: any = {};
    if (fs.existsSync(configPath)) {
      try {
        const content = fs.readFileSync(configPath, 'utf-8');
        config = JSON.parse(content);
      } catch (e) {
        vscode.window.showErrorMessage('解析 .quickopsrc 失败，请检查文件格式');
        return;
      }
    }

    // 4. 写入配置
    if (!config.snippets) {
      config.snippets = [];
    }

    config.snippets.push(snippetItem);

    try {
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
      vscode.window.showInformationMessage(
        `代码片段 "${snippetItem.prefix}" 已添加至 .quickopsrc`
      );
    } catch (e) {
      vscode.window.showErrorMessage('写入配置文件失败');
    }
  }

  private createSnippetItem(document: vscode.TextDocument, text: string) {
    const ctx = this.contextService.context;
    const langId = document.languageId;

    // --- 1. 处理 Scope (依赖判断) ---
    const scope: string[] = [langId];
    
    // 根据当前上下文判断第二个依赖参数
    if (langId === 'vue') {
      if (ctx.isVue3) {
        scope.push('vue3');
      } else {
        // 默认为 vue2
        scope.push('vue2'); 
      }
    } else if (
      langId === 'javascriptreact' || 
      langId === 'typescriptreact' || 
      ctx.isReact
    ) {
      scope.push('react');
    }

    // --- 2. 处理 Body (字符串或数组) ---
    // 统一将制表符转换为空格，保持缩进一致性（可选）
    // text = text.replace(/\t/g, '  ');
    
    const lines = text.split(/\r?\n/);
    let body: string | string[];

    if (lines.length === 1) {
      body = lines[0];
    } else {
      body = lines;
    }

    // --- 3. 生成 Prefix (随机字符) ---
    const randomSuffix = Math.random().toString(36).substring(2, 7);
    const prefix = `snip_${randomSuffix}`;

    // --- 4. 组装对象 ---
    return {
      prefix: prefix,
      scope: scope,
      body: body,
      style: langId, // 当前文件语言即为 style
      description: `User Snippet (${new Date().toLocaleTimeString()}) - quick-ops`
    };
  }
}