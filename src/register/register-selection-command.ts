import * as vscode from 'vscode';
import { getSelectionInfo, withTsType } from '../utils/index';

const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
statusBarItem.command = 'extension.showSelectionInfo';

function setSelectionStatusBarText() {
  const info = getSelectionInfo();
  statusBarItem.text = `选中 行：${info?.lineCount} 列：${info?.column} 字符：${info?.charCount}`;
  statusBarItem.show();
}

async function setWithTsType(context: vscode.ExtensionContext) {
  const result = await withTsType();
  if (result) {
    vscode.commands.executeCommand('setContext', 'Extension.SelectTots', true);
    let disposable = vscode.commands.registerCommand('extension.CopyTsType', async () => {
      await vscode.env.clipboard.writeText(result);
      vscode.window.showInformationMessage('TypeScript 类型已复制到剪贴板！');
    });
    context.subscriptions.push(disposable);
  }else{
    vscode.commands.executeCommand('setContext', 'Extension.SelectTots', false);
  }
}

export function registerSelectionCommand(context: vscode.ExtensionContext) {
  // html to scss
  const disposable = vscode.window.onDidChangeTextEditorSelection((e) => {
    // 统计选中字符，行数
    setSelectionStatusBarText();
    // 转ts
    setWithTsType(context);
    // mock数据
  });

  context.subscriptions.push(disposable);
}
