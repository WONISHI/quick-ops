import * as vscode from 'vscode';
import * as http from 'http';
import { getSelectionInfo, withTsType, generateUUID } from '../utils/index';
import { parseElTableColumnsFromSelection } from '../utils/parse';
import { properties } from '../global-object/properties';

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
      const isAsync = properties.settings!.useAsyncMock === undefined ? true : properties.settings!.useAsyncMock;
      // 如果为异步的话可以启动服务
      if (isAsync) {
        let serverResult = '同意';
        if (properties.settings!.mockServerCount < properties.server.length) {
          serverResult = (await vscode.window.showWarningMessage(`已启动${properties.settings!.server?.length}个Mock服务，如果需要启动则需要关闭最早先的服务，是否同意？`, '同意', '取消')) || '取消';
        }
        if (serverResult === '同意') {
          let serverId = generateUUID(8);
          const server = http.createServer((req, res) => {
            if (req.url === `/${serverId}`) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(result));
            } else {
              res.writeHead(404);
              res.end('Not Found');
            }
          });
          server.listen(3100, () => {
            properties.server.push({
              id: serverId,
              server,
            });
            console.log('Mock server running at http://localhost:3100');
          });
        }
      } else {
      }
    });
    context.subscriptions.push(disposable);
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
