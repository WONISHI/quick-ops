import * as http from 'http';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { withTsType, generateUUID } from '../../utils/index';
import { parseElTableColumnsFromSelection } from '../../utils/parse';
import { properties } from '../../global-object/properties';

// 根据选中内容生成ts类型
async function setWithTsType(context: vscode.ExtensionContext) {
  const result = await withTsType();
  if (result) {
    // 通知可以复制内容了
    vscode.commands.executeCommand('setContext', 'Extension.SelectTots', true);
    // 注册编辑右键菜单
    let copyCommands = vscode.commands.registerCommand('extension.CopyTsType', async () => {
      // 复制内容
      const doc = await vscode.workspace.openTextDocument({
        content: result,
        language: 'typescript',
      });
      // 显示到编辑器
      await vscode.window.showTextDocument(doc, vscode.ViewColumn.Active);
    });
    context.subscriptions.push(copyCommands);
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
        if ((properties.settings?.mockServerCount ?? 0) < (properties.server?.length ?? 0)) {
          serverResult =
            (await vscode.window.showWarningMessage(`已启动${properties.settings?.server?.length ?? 0}个Mock服务，如果需要启动则需要关闭最早先的服务，是否同意？`, '同意', '取消')) || '取消';
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

// 选中后防抖时候的触发时机
export function fireTrigger(context: vscode.ExtensionContext) {
  // 监听是否选中对象，是否可以转成ts
  setWithTsType(context);
  // 生成mock数据
  generateMockData(context);
  // 选中插入try
  // 折叠
}
