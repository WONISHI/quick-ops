import * as vscode from 'vscode';
import { IFeature } from '../core/interfaces/IFeature'; // 假设你有个接口定义
import { StyleStructureParser } from '../utils/StyleStructureParser';

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
        const langId = document.languageId; // vue, html, javascriptreact, typescriptreact

        console.log(text, langId);

        // 2. 调用解析工具
        try {
          const scssString = StyleStructureParser.parse(text, langId);

          if (!scssString) {
            vscode.window.showInformationMessage('未找到有效的 HTML/JSX 结构 (需要包含 class 或 id)');
            return;
          }

          // 3. 在光标位置插入生成的代码
          editor.edit((editBuilder) => {
            const position = editor.selection.active;
            editBuilder.insert(position, scssString);
          });
        } catch (error) {
          console.error(error);
          vscode.window.showErrorMessage('解析结构失败，请检查语法');
        }
      }),
    );

    console.log(`[${this.id}] Activated.`);
  }
}
