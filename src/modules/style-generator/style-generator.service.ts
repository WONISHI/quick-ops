import * as vscode from 'vscode';

export class StyleGeneratorService {
  public async generateStyleStructure(): Promise<void> {
    const editor = vscode.window.activeTextEditor;

    if (!editor) {
      vscode.window.showWarningMessage('请先打开一个文件');
      return;
    }

    const document = editor.document;
    const text = document.getText();
    const langId = document.languageId;

    try {
      const { StyleStructureParser } = await import(
        '../../utils/StyleStructureParser'
      );

      const scssString = await StyleStructureParser.parse(text, langId);

      if (!scssString) {
        vscode.window.showInformationMessage(
          '未找到有效的 HTML/JSX 结构 (需要包含 class 或 id)',
        );
        return;
      }

      await vscode.env.clipboard.writeText(scssString);

      vscode.window.showInformationMessage('✨ 样式结构已复制到剪贴板');
    } catch (error) {
      console.error('[StyleGeneratorService] parse failed:', error);
      vscode.window.showErrorMessage('解析结构失败，请检查语法');
    }
  }
}