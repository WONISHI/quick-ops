import * as vscode from 'vscode';
import { camelCase, upperFirst, snakeCase, kebabCase } from 'lodash-es';
import { IFeature } from '../core/interfaces/IFeature';
import ColorLog from '../utils/ColorLog';

export class ClipboardTransformFeature implements IFeature {
  public readonly id = 'ClipboardTransformFeature';

  public activate(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
      vscode.commands.registerCommand('quick-ops.transformToCamel', () => this.handleTransform('camel')),
      vscode.commands.registerCommand('quick-ops.transformToPascal', () => this.handleTransform('pascal')),
      vscode.commands.registerCommand('quick-ops.transformToConstant', () => this.handleTransform('constant')),
      vscode.commands.registerCommand('quick-ops.transformToFirstUpper', () => this.handleTransform('firstUpper')),
      vscode.commands.registerCommand('quick-ops.transformToLower', () => this.handleTransform('lower')),
      vscode.commands.registerCommand('quick-ops.transformToKebab', () => this.handleTransform('kebab')),
    );

    ColorLog.black(`[${this.id}]`, 'Selection Transform Activated.');
  }

  private async handleTransform(type: 'camel' | 'pascal' | 'constant' | 'firstUpper' | 'lower' | 'kebab') {
    const editor = vscode.window.activeTextEditor;

    if (!editor) {
      vscode.window.showWarningMessage('没有活动的编辑器 (No active editor)');
      return;
    }

    // 过滤出真正有选中内容的选区（排除仅仅是光标闪烁没有实际选中文本的情况）
    const validSelections = editor.selections.filter((selection) => !selection.isEmpty);

    if (validSelections.length === 0) {
      vscode.window.showWarningMessage('请先选中要转换的英文内容 (No text selected)');
      return;
    }

    // 2. 原地替换：使用 editor.edit 修改文档内容
    await editor.edit((editBuilder) => {
      for (const selection of validSelections) {
        const text = editor.document.getText(selection);
        let result = '';

        try {
          if (type === 'lower') {
            result = text.toLowerCase();
          } else if (type === 'firstUpper') {
            result = upperFirst(text);
          } else {
            result = text.replace(/[a-zA-Z0-9_\-\.]+/g, (word) => {
              if (word === '.') return word;

              switch (type) {
                case 'camel':
                  return camelCase(word);
                case 'pascal':
                  return upperFirst(camelCase(word));
                case 'constant':
                  return snakeCase(word).toUpperCase();
                case 'kebab':
                  return kebabCase(word);
                default:
                  return word;
              }
            });
          }
          // 执行替换动作
          editBuilder.replace(selection, result);
        } catch (error) {
          console.error('Transform error:', error);
        }
      }
    });

    vscode.window.setStatusBarMessage(`✅ 选中内容已成功转换为 ${type} 格式`, 3000);
  }
}
