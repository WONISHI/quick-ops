import * as vscode from 'vscode';
import { camelCase, upperFirst, snakeCase, kebabCase } from 'lodash-es';
import { IFeature } from '../core/interfaces/IFeature';

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

    console.log(`[${this.id}] Activated.`);
  }

  private async handleTransform(type: 'camel' | 'pascal' | 'constant' | 'firstUpper' | 'lower' | 'kebab') {
    const text = await vscode.env.clipboard.readText();

    if (!text || !text.trim()) {
      vscode.window.showWarningMessage('剪贴板为空 (Clipboard is empty)');
      return;
    }

    const validationRegex = /^[a-zA-Z0-9_\-\.\s]+$/;

    if (!validationRegex.test(text)) {
      vscode.window.showErrorMessage(`类型错误：剪贴板内容包含非法字符（如中文、特殊符号）！`);
      return;
    }

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
    } catch (error) {
      vscode.window.showErrorMessage('转换失败，请检查内容格式');
      return;
    }

    await vscode.env.clipboard.writeText(result);

    const maxLength = 25;
    const cleanResult = result.replace(/\r?\n/g, '⏎'); 
    const displayResult = cleanResult.length > maxLength ? cleanResult.substring(0, maxLength) + '...' : cleanResult;

    vscode.window.setStatusBarMessage(`已转换并复制: ${displayResult}`, 3000);
  }
}
