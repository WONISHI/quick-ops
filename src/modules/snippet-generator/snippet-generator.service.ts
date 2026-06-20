import * as vscode from 'vscode';
import type { ISnippetItem } from '../../core/types/snippet';
import { ExtensionContextProvider } from '../../common/providers/extension-context.provider';
import { WorkspaceContextService } from '../../common/services/workspace-context.service';
import { ConfigurationService } from '../../common/services/configuration.service';

export class SnippetGeneratorService {
  public static inject = [
    ExtensionContextProvider,
    WorkspaceContextService,
    ConfigurationService,
  ];

  private readonly storageKey = 'quickOps.workspaceSnippets';

  constructor(
    private readonly extensionContextProvider: ExtensionContextProvider,
    private readonly workspaceContextService: WorkspaceContextService,
    private readonly configurationService: ConfigurationService,
  ) {}

  public async generateAndSaveSnippet(editor: vscode.TextEditor): Promise<void> {
    const selection = editor.selection;
    const selectedText = editor.document.getText(selection);

    if (!selectedText.trim()) {
      vscode.window.showWarningMessage('请先选择一段代码');
      return;
    }

    const prefix = await vscode.window.showInputBox({
      title: '生成代码片段',
      placeHolder: '请输入触发前缀，例如 vue3-comp、log-error',
      prompt: 'Prefix 用于触发代码片段补全',
      validateInput: value => {
        if (!value.trim()) return '前缀不能为空';

        if (/\s/.test(value)) {
          return '前缀不能包含空格';
        }

        return null;
      },
    });

    if (!prefix) return;

    const description = await vscode.window.showInputBox({
      title: '生成代码片段',
      placeHolder: '请输入描述',
      value: `User Snippet: ${prefix}`,
    });

    const snippetItem = this.createSnippetItem(
      editor.document,
      selectedText,
      prefix.trim(),
      description?.trim() || prefix.trim(),
    );

    try {
      const context = this.extensionContextProvider.getContext();

      const workspaceSnippets = context.workspaceState.get<ISnippetItem[]>(
        this.storageKey,
        [],
      );

      const nextSnippets = [
        ...workspaceSnippets.filter(item => item.prefix !== snippetItem.prefix),
        snippetItem,
      ];

      await context.workspaceState.update(this.storageKey, nextSnippets);

      /**
       * 通知 CodeSnippetModule 重新加载缓存。
       * 前面 code-snippet.controller.ts 里如果监听了 snippetsChanged，
       * 保存后就可以马上生效。
       */
      this.configurationService.emit('snippetsChanged');

      vscode.window.showInformationMessage(
        `✨ 代码片段 "${snippetItem.prefix}" 已保存至工作区内存！`,
      );
    } catch (error) {
      console.error('[SnippetGeneratorService] save snippet failed:', error);
      vscode.window.showErrorMessage('保存代码片段失败');
    }
  }

  public async removeSnippet(prefix: string): Promise<void> {
    const context = this.extensionContextProvider.getContext();

    const workspaceSnippets = context.workspaceState.get<ISnippetItem[]>(
      this.storageKey,
      [],
    );

    const nextSnippets = workspaceSnippets.filter(item => item.prefix !== prefix);

    await context.workspaceState.update(this.storageKey, nextSnippets);

    this.configurationService.emit('snippetsChanged');

    vscode.window.showInformationMessage(`已删除代码片段 "${prefix}"`);
  }

  public getWorkspaceSnippets(): ISnippetItem[] {
    const context = this.extensionContextProvider.getContext();

    return context.workspaceState.get<ISnippetItem[]>(this.storageKey, []);
  }

  private createSnippetItem(
    document: vscode.TextDocument,
    rawText: string,
    prefix: string,
    description: string,
  ): ISnippetItem {
    const workspaceContext = this.workspaceContextService.context;
    const langId = document.languageId;
    const scope: string[] = [langId];

    if (langId === 'vue') {
      scope.push(workspaceContext.isVue3 ? 'vue3' : 'vue2');
    } else if (
      langId === 'javascriptreact' ||
      langId === 'typescriptreact' ||
      workspaceContext.isReact
    ) {
      scope.push('react');
    }

    return {
      prefix,
      scope,
      body: this.formatBody(rawText),
      style: langId,
      description,
      origin: 'workspace',
    };
  }

  private formatBody(text: string): string[] {
    const lines = text.split(/\r?\n/);

    if (lines.length <= 1) {
      return lines;
    }

    let minIndent = Infinity;

    for (const line of lines) {
      if (line.trim().length === 0) continue;

      const match = line.match(/^(\s*)/);

      if (match) {
        minIndent = Math.min(minIndent, match[1].length);
      }
    }

    if (minIndent === Infinity) {
      minIndent = 0;
    }

    return lines.map(line => {
      if (line.length >= minIndent) {
        return line.slice(minIndent);
      }

      return line;
    });
  }
}