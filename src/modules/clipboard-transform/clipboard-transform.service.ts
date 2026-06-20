import * as vscode from 'vscode';
import { camelCase, kebabCase, snakeCase, upperFirst } from 'lodash-es';

export type ClipboardTransformType =
  | 'lower'
  | 'camel'
  | 'pascal'
  | 'kebab'
  | 'constant';

export class ClipboardTransformService {
  public async transformSelection(type: ClipboardTransformType): Promise<void> {
    const editor = vscode.window.activeTextEditor;

    if (!editor) {
      vscode.window.showWarningMessage('当前没有活跃的编辑器');
      return;
    }

    if (editor.selection.isEmpty) {
      vscode.window.showInformationMessage('请先选择需要转换的文本');
      return;
    }

    const selection = editor.selection;
    const text = editor.document.getText(selection);
    const result = this.transformText(text, type);

    await editor.edit(editBuilder => {
      editBuilder.replace(selection, result);
    });
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