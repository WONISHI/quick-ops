import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { generateUUID,getWebviewContent } from '../utils/index';
import { MergeProperties, properties } from '../global-object/properties';
import { channel } from 'diagnostics_channel';

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
        retainContextWhenHidden: true, // 隐藏后保留状态
        localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, 'src/webview'))],
      });


      // const stylePath = path.join(context.extensionPath, 'resources/webview/css/index.css');
      // const styleContent = fs.existsSync(stylePath) ? fs.readFileSync(stylePath, 'utf8') : '';

      // const jsPath = path.join(context.extensionPath, 'resources/webview/js/index.js');
      // const jsContent = fs.existsSync(jsPath) ? fs.readFileSync(jsPath, 'utf8') : '';

      // const htmlPath = path.join(context.extensionPath, 'resources/webview/html/index.html');
      // let htmlContent = fs.existsSync(htmlPath) ? fs.readFileSync(htmlPath, 'utf8') : '';

      // const nonce = generateUUID(32);
      // MergeProperties({ nonce });

      // htmlContent = htmlContent
      //   .replace('%%metaContent%%', `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline';">`)
      //   .replace('%%styleContent%%', `<style>${styleContent}</style>`)
      //   .replace('%%jsContent%%', `<script nonce="${nonce}">${jsContent}</script>`);
      panel.webview.html = getWebviewContent(panel,context);
      panel.reveal();
      MergeProperties({ panel });

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
          if (message.type === 'run') {
            const command = message.command;
            const workspaceFolders = vscode.workspace.workspaceFolders;
            const cwd = workspaceFolders ? workspaceFolders[0].uri.fsPath : process.cwd();

            const terminal = vscode.window.createTerminal({ name: '命令执行终端', cwd });
            terminal.show();
            terminal.sendText(command);
          }
        },
        undefined,
        context.subscriptions,
      );
    }),
  );
}
