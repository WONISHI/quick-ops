import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getWebviewContent, generateUUID } from '../utils/index';
import { MergeProperties, properties } from '../global-object/properties';
import HttpService from '../services/HttpService';

export function registerQuickPick(context: vscode.ExtensionContext) {
  let panel: vscode.WebviewPanel | undefined;

  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, -Infinity);
  statusBarItem.text = '$(book) quick-ops';
  statusBarItem.tooltip = '显示/隐藏控制台页面';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  statusBarItem.command = 'extension.toggleWebview';

  context.subscriptions.push(
    vscode.commands.registerCommand('extension.toggleWebview', () => {
      if (panel) {
        // Webview 已存在 → 点击状态栏按钮时直接销毁
        panel.dispose();
        panel = undefined;
        MergeProperties({ nonce: '', panel: undefined });
        return;
      }

      // Webview 不存在 → 创建新的
      panel = vscode.window.createWebviewPanel('reactWebview', 'quick-ops(控制台)', vscode.ViewColumn.Beside, {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, 'resources/webview'))],
      });

      panel.webview.html = getWebviewContent(panel, context);
      MergeProperties({ panel });
      panel.reveal();

      // 当 Webview 被关闭（dispose）时，清空 panel 引用
      panel.onDidDispose(
        () => {
          panel = undefined;
        },
        null,
        context.subscriptions,
      );

      // 接收 Webview 消息
      panel.webview.onDidReceiveMessage(
        (message) => {
          if (message.type === 'start-service') {
            const command = message.command;
            const workspaceFolders = vscode.workspace.workspaceFolders;
            const cwd = workspaceFolders ? properties.rootFilePath : process.cwd();

            const terminal = vscode.window.createTerminal({ name: '命令执行终端', cwd });
            terminal.show();
            terminal.sendText(command);
          } else if (message.type === 'debug') {
            vscode.window.showInformationMessage(`打印数据${JSON.stringify(message)}`);
          } else if (message.type === 'new-service') {
            // 新建服务
            const moduleRoute = HttpService.addRoute({
              ...message.data,
            });
            MergeProperties({ server: [...properties.server, moduleRoute] });
          } else if (message.type === 'enable-service') {
            // 运行停止服务
            const moduleRoute = HttpService.toggleServer({
              ...message.data,
            });
            const server = properties.server.find((item) => {
              return item.id === moduleRoute?.id;
            });
            server.active = moduleRoute?.active;
            MergeProperties({ server: [...properties.server] });
          } else if (message.type === 'update-service') {
            // 更新服务
            const moduleRoute = HttpService.updateRouteData({
              ...message.data,
            });
          } else if (message.type === 'delete-service') {
            // 删除服务
            const serviceStatus = HttpService.removeRoute({
              ...message.data,
            });
            if (serviceStatus) {
              const server = properties.server.filter((item) => item.id !== message.data.id);
              MergeProperties({ server });
              console.log('server',server)
            }
          }
        },
        undefined,
        context.subscriptions,
      );
    }),
  );
}
