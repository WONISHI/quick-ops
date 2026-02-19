import * as vscode from 'vscode';
import { IFeature } from '../core/interfaces/IFeature';
import { StyleStructureParser } from '../utils/StyleStructureParser';
import ColorLog from '../utils/ColorLog';

export class StyleGeneratorFeature implements IFeature {
  public readonly id = 'StyleGeneratorFeature';

  public activate(context: vscode.ExtensionContext): void {
    const commandId = 'quick-ops.generateStyleStructure';

    // 1. 注册命令
    context.subscriptions.push(
      vscode.commands.registerCommand(commandId, async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          vscode.window.showWarningMessage('请先打开一个文件');
          return;
        }

        const document = editor.document;
        const text = document.getText();
        const langId = document.languageId;

        // 2. 调用解析工具
        try {
          const scssString = StyleStructureParser.parse(text, langId);

          if (!scssString) {
            vscode.window.showInformationMessage('未找到有效的 HTML/JSX 结构 (需要包含 class 或 id)');
            return;
          }

          await vscode.env.clipboard.writeText(scssString);

          vscode.window.showInformationMessage('✨ 样式结构已复制到剪贴板');
        } catch (error) {
          console.error(error);
          vscode.window.showErrorMessage('解析结构失败，请检查语法');
        }
      }),
    );

    ColorLog.black(`[${this.id}]`, 'Activated.');
  }
}
