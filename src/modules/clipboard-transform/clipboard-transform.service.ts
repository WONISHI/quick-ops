import * as vscode from 'vscode';
import { camelCase, kebabCase, snakeCase, upperFirst } from 'lodash-es';
import type { ClipboardTransformType } from '@modules/clipboard-transform/clipboard-transform.type';

export class ClipboardTransformService {
  public async transformSelection(type: ClipboardTransformType): Promise<void> {
    const editor = vscode.window.activeTextEditor;

    /**
     * 没有活跃编辑器时，也尝试使用剪贴板内容转换。
     *
     * 场景：
     * - 用户通过命令面板执行转换命令
     * - 当前没有打开文本编辑器
     */
    if (!editor) {
      await this.transformClipboard(type);
      return;
    }

    const selection = editor.selection;

    /**
     * 没有选中文本时：
     * - 读取剪贴板内容
     * - 转换后写回剪贴板
     * - 不替换编辑器内容
     */
    if (selection.isEmpty) {
      await this.transformClipboard(type);
      return;
    }

    /**
     * 有选中文本时：
     * - 转换选中文本
     * - 直接替换当前选区
     */
    const text = editor.document.getText(selection);
    const result = this.transformText(text, type);

    await editor.edit((editBuilder) => {
      editBuilder.replace(selection, result);
    });
  }

  /**
   * @description 转换剪贴板内容
   *
   * 注意：
   * - 这个方法只操作剪贴板
   * - 不修改编辑器内容
   */
  private async transformClipboard(type: ClipboardTransformType): Promise<void> {
    const text = await vscode.env.clipboard.readText();

    if (!text) {
      vscode.window.showInformationMessage('当前没有选中文本，且剪贴板内容为空');
      return;
    }

    const result = this.transformText(text, type);

    await vscode.env.clipboard.writeText(result);

    vscode.window.showInformationMessage('未选择文本，已将剪贴板内容转换后写回剪贴板');
  }

  public transformText(text: string, type: ClipboardTransformType): string {
    switch (type) {
      case 'lower':
        return text.toLowerCase();

      case 'camel':
        return camelCase(text);

      case 'pascal':
        return upperFirst(camelCase(text));

      case 'kebab':
        return kebabCase(text);

      case 'constant':
        return snakeCase(text).toUpperCase();

      default:
        return text;
    }
  }
}
