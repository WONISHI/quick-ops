import * as vscode from 'vscode';
import { IFeature } from '../core/interfaces/IFeature';
import ColorLog from '../utils/ColorLog';

export class EditorHistoryFeature implements IFeature {
  public readonly id = 'EditorHistoryFeature';

  // 使用 Set 也可以，但数组方便取索引 (0是当前，1是上一个)
  private historyStack: string[] = [];

  public activate(context: vscode.ExtensionContext): void {
    // 1. 初始化：如果当前有打开的文件，加入历史
    if (vscode.window.activeTextEditor) {
      this.pushToHistory(vscode.window.activeTextEditor);
    }

    // 2. 监听编辑器激活变化
    context.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) {
          this.pushToHistory(editor);
        }
      }),
    );

    // 3. 注册命令
    context.subscriptions.push(
      vscode.commands.registerCommand('quick-ops.switchPreviousEditor', () => {
        this.switchToPrevious();
      }),
    );

    ColorLog.black(`[${this.id}]`, 'Activated.');
  }

  /**
   * 将当前编辑器压入历史栈顶
   */
  private pushToHistory(editor: vscode.TextEditor) {
    // 过滤掉 output 面板等非代码编辑器 (viewColumn 为 undefined 通常是面板)
    if (editor.viewColumn === undefined) return;

    const uri = editor.document.uri.toString();

    // 1. 如果栈顶已经是当前文件，不做操作 (防止重复触发)
    if (this.historyStack[0] === uri) return;

    // 2. 如果历史中已有该文件，先移除它 (我们要把它移到最新的位置)
    this.historyStack = this.historyStack.filter((u) => u !== uri);

    // 3. 压入栈顶
    this.historyStack.unshift(uri);

    // 4. 限制栈大小，防止无限增长 (保留最近 20 个足够了)
    if (this.historyStack.length > 20) {
      this.historyStack.pop();
    }
  }

  /**
   * 切换到上一个编辑器
   */
  private async switchToPrevious() {
    // 历史记录少于 2 个，说明没有“上一个”，无法切换
    if (this.historyStack.length < 2) return;

    // 索引 0 是当前文件，索引 1 是上一个文件
    const targetUriStr = this.historyStack[1];

    try {
      const uri = vscode.Uri.parse(targetUriStr);
      // 打开文档
      const doc = await vscode.workspace.openTextDocument(uri);
      // 显示文档 (preview: false 表示固定标签页，不开预览模式)
      await vscode.window.showTextDocument(doc, { preview: false });
    } catch (e) {
      // 如果文件被删除了或者无法打开，从历史中移除
      this.historyStack = this.historyStack.filter((u) => u !== targetUriStr);
      // 尝试递归切换到再上一个 (可选)
      // this.switchToPrevious();
    }
  }
}
