import * as vscode from 'vscode';
import { camelCase, kebabCase, snakeCase, upperFirst } from 'lodash-es';
import { IFeature } from '../core/interfaces/IFeature';

export class ClipboardTransformFeature implements IFeature {
  public readonly id = 'ClipboardTransformFeature';

  public activate(context: vscode.ExtensionContext) {
    // 🌟 定义所有转换规则的映射表
    const transformCommands = [
      { id: 'quick-ops.transformToLower', transform: (text: string) => text.toLowerCase() },
      { id: 'quick-ops.transformToCamel', transform: (text: string) => camelCase(text) },
      { id: 'quick-ops.transformToPascal', transform: (text: string) => upperFirst(camelCase(text)) },
      { id: 'quick-ops.transformToKebab', transform: (text: string) => kebabCase(text) },
      { id: 'quick-ops.transformToConstant', transform: (text: string) => snakeCase(text).toUpperCase() }
    ];

    // 🌟 遍历批量注册命令
    for (const cmd of transformCommands) {
      const disposable = vscode.commands.registerCommand(cmd.id, () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.selection.isEmpty) return;

        const text = editor.document.getText(editor.selection);
        const result = cmd.transform(text);

        // 执行替换
        editor.edit(editBuilder => {
          editBuilder.replace(editor.selection, result);
        });
      });

      context.subscriptions.push(disposable);
    }
  }
}