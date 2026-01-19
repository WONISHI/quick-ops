import * as vscode from 'vscode';
import { IFeature } from '../core/interfaces/IFeature';

interface RegionStackItem {
  line: number;
  type: '+' | '-';
}

export class RegionFoldingFeature implements IFeature {
  public readonly id = 'RegionFoldingFeature';

  // 1. 支持的语言列表
  private readonly selector: vscode.DocumentSelector = [
    'javascript', 'typescript', 'vue', 'javascriptreact', 'typescriptreact',
    'java', 'c', 'cpp', 'go', 'python', 'html', 'xml', 'markdown',
    'json', 'jsonc', 'css', 'scss', 'less', 'yaml', 'php', 'csharp', 'sql'
  ];

  // 2. 样式装饰器：用于高亮 region 标题
  private readonly titleDecorationType = vscode.window.createTextEditorDecorationType({
    color: '#4EC9B0', // 青色高亮，可根据主题调整
    fontWeight: 'bold',
    isWholeLine: false,
  });

  // 3. 正则表达式：严格匹配行首
  // ^\s*        -> 允许行首缩进
  // (?:\/\/...) -> 匹配常见注释符号
  // !\[region\] -> 匹配关键词
  private readonly startRegex = /^\s*(?:\/\/|#|<!--|\/\*|--)\s*!\[region\]:([+-])\s*(.*)/;
  private readonly endRegex = /^\s*(?:\/\/|#|<!--|\/\*|--)\s*!\[endregion\]/;

  public activate(context: vscode.ExtensionContext): void {
    // A. 注册折叠范围提供者 (告诉 VS Code 哪里可以折叠)
    const foldingProvider = vscode.languages.registerFoldingRangeProvider(this.selector, {
      provideFoldingRanges: (document, context, token) => {
        return this.parseFoldingRanges(document);
      },
    });

    // B. 注册代码补全 (输入 ! 自动提示)
    const completionProvider = vscode.languages.registerCompletionItemProvider(
      this.selector,
      { provideCompletionItems: (d, p) => this.provideCompletionItems(d, p) },
      '!', '['
    );

    // C. 监听：打开文档时 -> 强制执行折叠/展开状态 + 更新颜色
    context.subscriptions.push(
      vscode.workspace.onDidOpenTextDocument((doc) => {
        // 延时执行，确保 VS Code 初始化完毕
        setTimeout(() => {
          const editor = vscode.window.activeTextEditor;
          if (editor && editor.document === doc) {
            this.enforceRegionState(editor);
            this.updateDecorations(editor);
          }
        }, 500);
      }),
    );

    // D. 监听：切换回编辑器时 -> 强制检查状态 + 更新颜色
    context.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) {
          this.enforceRegionState(editor);
          this.updateDecorations(editor);
        }
      }),
    );

    // E. 监听：文档内容编辑时 -> 仅更新颜色 (不折叠)
    context.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument((event) => {
        const editor = vscode.window.activeTextEditor;
        if (editor && event.document === editor.document) {
          this.updateDecorations(editor);
        }
      }),
    );

    // F. 激活时立即检查当前编辑器
    if (vscode.window.activeTextEditor) {
      this.enforceRegionState(vscode.window.activeTextEditor);
      this.updateDecorations(vscode.window.activeTextEditor);
    }

    context.subscriptions.push(foldingProvider, completionProvider);
    console.log(`[${this.id}] Activated.`);
  }

  // --- 1. 核心：解析折叠范围 ---
  // 这让 VS Code 知道哪些行之间是可以折叠的，并在行号旁显示小箭头
  private parseFoldingRanges(document: vscode.TextDocument): vscode.FoldingRange[] {
    const ranges: vscode.FoldingRange[] = [];
    const stack: RegionStackItem[] = [];

    for (let i = 0; i < document.lineCount; i++) {
      const lineText = document.lineAt(i).text;

      // 检查开始标签
      const startMatch = lineText.match(this.startRegex);
      if (startMatch) {
        const type = startMatch[1] as '+' | '-';
        stack.push({ line: i, type });
        continue;
      }

      // 检查结束标签
      const endMatch = lineText.match(this.endRegex);
      if (endMatch) {
        const startItem = stack.pop();
        if (startItem) {
          // 创建折叠区域
          const range = new vscode.FoldingRange(startItem.line, i, vscode.FoldingRangeKind.Region);
          ranges.push(range);
        }
      }
    }
    return ranges;
  }

  // --- 2. 核心：强制执行折叠/展开状态 (进页面时触发) ---
  private async enforceRegionState(editor: vscode.TextEditor) {
    const document = editor.document;
    
    // 过滤非代码文件
    if (document.uri.scheme !== 'file' && document.uri.scheme !== 'untitled') return;

    const linesToFold: number[] = [];
    const linesToUnfold: number[] = [];

    for (let i = 0; i < document.lineCount; i++) {
      const lineText = document.lineAt(i).text;
      const match = lineText.match(this.startRegex);

      if (match) {
        const type = match[1]; // '+' 或 '-'
        
        // 如果是 ':-'，加入折叠列表
        if (type === '-') {
          linesToFold.push(i);
        } 
        // 如果是 ':+'，加入展开列表 (确保它是打开的)
        else if (type === '+') {
          linesToUnfold.push(i);
        }
      }
    }

    // 执行折叠 (Collapse)
    if (linesToFold.length > 0) {
      await vscode.commands.executeCommand('editor.fold', {
        levels: 1,
        direction: 'up',
        selectionLines: linesToFold,
      });
    }

    // 执行展开 (Expand)
    if (linesToUnfold.length > 0) {
      await vscode.commands.executeCommand('editor.unfold', {
        levels: 1,
        direction: 'up',
        selectionLines: linesToUnfold,
      });
    }
  }

  // --- 3. 装饰器逻辑 (颜色高亮) ---
  private updateDecorations(editor: vscode.TextEditor) {
    if (!editor) return;

    const document = editor.document;
    const titleDecorations: vscode.DecorationOptions[] = [];

    for (let i = 0; i < document.lineCount; i++) {
      const lineText = document.lineAt(i).text;
      const match = lineText.match(this.startRegex);

      // match[2] 是标题部分
      if (match && match[2] && match[2].trim().length > 0) {
        const titleText = match[2];
        
        // 找到标题在行内的位置用于高亮
        const startIndex = lineText.lastIndexOf(titleText);
        const endIndex = startIndex + titleText.length;

        const range = new vscode.Range(i, startIndex, i, endIndex);
        
        titleDecorations.push({
          range: range,
          hoverMessage: 'Custom Region'
        });
      }
    }

    editor.setDecorations(this.titleDecorationType, titleDecorations);
  }

  // --- 4. 代码补全提供者 ---
  private provideCompletionItems(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] {
    const lineText = document.lineAt(position).text;
    const prefix = lineText.substring(0, position.character);
    
    // 简单检查触发字符
    if (!prefix.includes('!')) return [];

    const triggerIndex = prefix.lastIndexOf('!');
    const replaceRange = new vscode.Range(position.line, triggerIndex, position.line, position.character);

    // 辅助函数：创建补全项
    const createSnippet = (label: string, detail: string, insertText: string) => {
      const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Snippet);
      item.detail = detail;
      item.insertText = new vscode.SnippetString(insertText);
      item.range = replaceRange;
      return item;
    };

    return [
      createSnippet('![region]:- (Collapse)', 'Start (Default Folded)', '![region]:- ${1:Title}'),
      createSnippet('![region]:+ (Expand)', 'Start (Default Expanded)', '![region]:+ ${1:Title}'),
      createSnippet('![endregion]', 'End Region', '![endregion]'),
    ];
  }
}