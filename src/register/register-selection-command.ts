import * as vscode from 'vscode';
import { getSelectionInfo, withTsType } from '../utils/index';

const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
statusBarItem.command = 'extension.showSelectionInfo';

function setSelectionStatusBarText() {
  const info = getSelectionInfo();
  statusBarItem.text = `选中 行：${info?.lineCount} 列：${info?.column} 字符：${info?.charCount}`;
  statusBarItem.show();
}

async function setWithTsType() {
  const result = await withTsType();
  console.log(result);
}

export function registerSelectionCommand(context: vscode.ExtensionContext) {
  // html to scss
  const disposable = vscode.window.onDidChangeTextEditorSelection((e) => {
    // 统计选中字符，行数
    setSelectionStatusBarText();
    // 转ts
    setWithTsType();
    // mock数据
  });

  context.subscriptions.push(disposable);
}
