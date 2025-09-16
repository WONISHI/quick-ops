import * as vscode from 'vscode';
import { getSelectionInfo, withTsType } from '../utils/index';
import { parseElTableColumnsFromSelection } from '../utils/parse';

const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
statusBarItem.command = 'extension.showSelectionInfo';

// 设置状态栏文本
function setSelectionStatusBarText() {
  const info = getSelectionInfo();
  statusBarItem.text = `选中 行：${info?.lineCount} 列：${info?.column} 字符：${info?.charCount}`;
  statusBarItem.show();
}

// 根据选中内容生成ts类型
async function setWithTsType(context: vscode.ExtensionContext) {
  const result = await withTsType();
  if (result) {
    vscode.commands.executeCommand('setContext', 'Extension.SelectTots', true);
    let disposable = vscode.commands.registerCommand('extension.CopyTsType', async () => {
      await vscode.env.clipboard.writeText(result);
      vscode.window.showInformationMessage('TypeScript 类型已复制到剪贴板！');
    });
    context.subscriptions.push(disposable);
  } else {
    vscode.commands.executeCommand('setContext', 'Extension.SelectTots', false);
  }
}

// 生成mock数据
async function generateMockData(context: vscode.ExtensionContext) {
  let result = await parseElTableColumnsFromSelection();
  if (result?.length) {
    vscode.commands.executeCommand('setContext', 'Extension.SelectToMock', true);
    let disposable = vscode.commands.registerCommand('extension.MockData', async () => {
      // 生成模拟数据
    });
  } else {
    vscode.commands.executeCommand('setContext', 'Extension.SelectToMock', false);
  }
}

export function registerSelectionCommand(context: vscode.ExtensionContext) {
  const disposable = vscode.window.onDidChangeTextEditorSelection((e) => {
    // 统计选中字符，行数
    setSelectionStatusBarText();
    // 转ts
    setWithTsType(context);
    // mock数据
    generateMockData(context);
    // html to scss
    // 折叠
    // try插入
  });

  context.subscriptions.push(disposable);
}
