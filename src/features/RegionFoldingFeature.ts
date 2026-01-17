import * as vscode from 'vscode';
import { IFeature } from '../core/interfaces/IFeature';

interface RegionStackItem {
  line: number;
  type: '+' | '-';
}

export class RegionFoldingFeature implements IFeature {
  public readonly id = 'RegionFoldingFeature';

  private readonly selector: vscode.DocumentSelector = [
    'javascript',
    'typescript',
    'vue',
    'javascriptreact',
    'typescriptreact',
    'java',
    'c',
    'cpp',
    'go',
    'python',
    'html',
    'xml',
    'markdown',
    'json',
    'jsonc',
    'css',
    'scss',
    'less',
  ];

  public activate(context: vscode.ExtensionContext): void {
    // 1. 注册折叠提供者
    const foldingProvider = vscode.languages.registerFoldingRangeProvider(this.selector, {
      provideFoldingRanges: (document: vscode.TextDocument, context: vscode.FoldingContext, token: vscode.CancellationToken) => {
        return this.parseFoldingRanges(document);
      },
    });

    // 2. 注册代码补全
    const completionProvider = vscode.languages.registerCompletionItemProvider(
      this.selector,
      {
        provideCompletionItems: (document, position) => {
          return this.provideCompletionItems(document, position);
        },
      },
      '!',
      '[',
    );

    // 3. 注册自动折叠逻辑 (打开文件时)
    context.subscriptions.push(
      vscode.workspace.onDidOpenTextDocument((doc) => {
        this.triggerAutoFold(doc);
      }),
    );

    // 4. 🔥 新增：监听正在编辑的文档 (实时自动折叠)
    context.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument((event) => {
        this.handleRealtimeFold(event);
      }),
    );

    // 切换编辑器时检查
    context.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) {
          this.triggerAutoFold(editor.document);
        }
      }),
    );

    if (vscode.window.activeTextEditor) {
      this.triggerAutoFold(vscode.window.activeTextEditor.document);
    }

    context.subscriptions.push(foldingProvider, completionProvider);
    console.log(`[${this.id}] Activated.`);
  }

  // --- 核心功能实现 ---

  private parseFoldingRanges(document: vscode.TextDocument): vscode.FoldingRange[] {
    const ranges: vscode.FoldingRange[] = [];
    const stack: RegionStackItem[] = [];

    const startRegex = /!\[region\]:([+-])/;
    const endRegex = /!\[endregion\]/;

    for (let i = 0; i < document.lineCount; i++) {
      const lineText = document.lineAt(i).text;

      const startMatch = lineText.match(startRegex);
      if (startMatch) {
        const type = startMatch[1] as '+' | '-';
        stack.push({ line: i, type });
        continue;
      }

      const endMatch = lineText.match(endRegex);
      if (endMatch) {
        const startItem = stack.pop();
        if (startItem) {
          const range = new vscode.FoldingRange(startItem.line, i, vscode.FoldingRangeKind.Region);
          ranges.push(range);
        }
      }
    }

    return ranges;
  }

  private provideCompletionItems(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] {
    const lineText = document.lineAt(position).text;
    const prefix = lineText.substring(0, position.character);
    const triggerIndex = prefix.lastIndexOf('!');

    if (triggerIndex === -1) return [];

    const replaceRange = new vscode.Range(position.line, triggerIndex, position.line, position.character);

    const expandItem = new vscode.CompletionItem('![region]:+ (Start)', vscode.CompletionItemKind.Snippet);
    expandItem.label = '![region]:+';
    expandItem.detail = 'Region Start (Default Expanded)';
    expandItem.insertText = new vscode.SnippetString('![region]:+ ${1:Region Title}');
    expandItem.filterText = '![region]+';
    expandItem.range = replaceRange;

    const collapseItem = new vscode.CompletionItem('![region]:- (Start)', vscode.CompletionItemKind.Snippet);
    collapseItem.label = '![region]:-';
    collapseItem.detail = 'Region Start (Default Collapsed)';
    collapseItem.insertText = new vscode.SnippetString('![region]:- ${1:Region Title}');
    collapseItem.filterText = '![region]-';
    collapseItem.range = replaceRange;

    const endItem = new vscode.CompletionItem('![endregion] (End)', vscode.CompletionItemKind.Snippet);
    endItem.label = '![endregion]';
    endItem.detail = 'Region End';
    endItem.insertText = new vscode.SnippetString('![endregion]');
    endItem.filterText = '![endregion]';
    endItem.range = replaceRange;

    return [expandItem, collapseItem, endItem];
  }

  // --- 自动折叠逻辑 ---

  /**
   * 打开文件时：扫描全文，折叠所有 :-
   */
  private async triggerAutoFold(document: vscode.TextDocument) {
    if (document.uri.scheme !== 'file' && document.uri.scheme !== 'untitled') return;

    setTimeout(async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document !== document) return;

      const linesToFold: number[] = [];
      const regex = /!\[region\]:-/;

      for (let i = 0; i < document.lineCount; i++) {
        const lineText = document.lineAt(i).text;
        if (regex.test(lineText)) {
          linesToFold.push(i);
        }
      }

      if (linesToFold.length > 0) {
        await vscode.commands.executeCommand('editor.fold', {
          levels: 1,
          direction: 'up',
          selectionLines: linesToFold,
        });
      }
    }, 500);
  }

  /**
   * 🔥 核心新增：实时输入监听
   * 当用户输入 ![endregion] 时，检测是否闭合了一个 :- 区域，如果是，立即折叠
   */
  private handleRealtimeFold(event: vscode.TextDocumentChangeEvent) {
    // 1. 基本检查
    const editor = vscode.window.activeTextEditor;
    if (!editor || event.document !== editor.document) return;
    if (event.contentChanges.length === 0) return;

    // 2. 检查刚输入的内容是否包含结束标签的关键部分
    // 我们检测最后一次改动及其所在行
    const change = event.contentChanges[0];
    const currentLineIndex = change.range.start.line;
    const currentLineText = event.document.lineAt(currentLineIndex).text;

    // 如果这一行现在包含了闭合标签
    if (currentLineText.includes('![endregion]')) {
      // 3. 向上寻找最近的匹配开始标签
      // 我们需要一个小延迟，等待 VS Code 更新折叠范围 provider
      setTimeout(async () => {
        // 重新获取该行（防止短时间多次输入）
        if (currentLineIndex >= event.document.lineCount) return;

        // 向上查找
        let startLineIndex = -1;
        let nestedLevel = 0; // 处理嵌套情况

        for (let i = currentLineIndex - 1; i >= 0; i--) {
          const lineText = event.document.lineAt(i).text;

          // 如果遇到另一个闭合标签，说明有嵌套，层级+1
          if (lineText.includes('![endregion]')) {
            nestedLevel++;
          }
          // 如果遇到开始标签
          else if (lineText.includes('![region]:')) {
            if (nestedLevel > 0) {
              nestedLevel--; // 抵消内部的嵌套
            } else {
              // 找到了匹配的开始标签！
              // 🔥 关键判断：只有当它是 "默认为 -" (收起) 的类型时，我们才自动折叠
              // 如果是 :+ (展开)，用户通常还在编辑，不应该折叠
              if (lineText.includes('![region]:-')) {
                startLineIndex = i;
              }
              break; // 只要找到匹配的 start 无论类型都停止查找
            }
          }
        }

        // 4. 如果找到了对应的 :- 开始标签，执行折叠
        if (startLineIndex !== -1) {
          await vscode.commands.executeCommand('editor.fold', {
            levels: 1,
            direction: 'up',
            selectionLines: [startLineIndex], // 只折叠这一行
          });
        }
      }, 200); // 200ms 延迟，确保 FoldingRangeProvider 计算完成
    }
  }
}
