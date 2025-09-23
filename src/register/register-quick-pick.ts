import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { generateUUID } from '../utils/index';
import { MergeProperties } from '../global-object/properties';
import { spawn } from 'child_process';

export function registerQuickPick(context: vscode.ExtensionContext) {
  const panel: vscode.WebviewPanel = vscode.window.createWebviewPanel('reactWebview', 'quick-ops(控制台)', vscode.ViewColumn.Beside, {
    enableScripts: true,
    retainContextWhenHidden: true,
    localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, 'resources/webview'))],
  });

  // 读取 CSS
  const stylePath = path.join(context.extensionPath, 'resources/webview/css/index.css');
  let styleContent = '';
  if (fs.existsSync(stylePath)) {
    styleContent = fs.readFileSync(stylePath, 'utf8');
  }

  // 读取 JS
  const jsPath = path.join(context.extensionPath, 'resources/webview/js/index.js');
  let jsContent = '';
  if (fs.existsSync(jsPath)) {
    jsContent = fs.readFileSync(jsPath, 'utf8');
  }

  // 生成随机 nonce
  const nonce = generateUUID(32);
  //  存储nonce
  MergeProperties({ nonce: nonce });
  // 读取html
  const htmlPath = path.join(context.extensionPath, 'resources/webview/html/index.html');
  let htmlContent = '';
  if (fs.existsSync(htmlPath)) {
    htmlContent = fs.readFileSync(htmlPath, 'utf8');
  }
  htmlContent = htmlContent.replace(
    '%%metaContent%%',
    `<meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline';">`,
  );
  htmlContent = htmlContent.replace('%%styleContent%%', `<style>${styleContent}</style>`);
  htmlContent = htmlContent.replace(
    '%%jsContent%%',
    ` <script nonce="${nonce}">
      ${jsContent}
    </script>`,
  );
  panel.webview.html = htmlContent;
  panel.reveal();
  // panel.dispose();
  MergeProperties({ panel: panel });

  panel.webview.onDidReceiveMessage(
    (message) => {
      switch (message.type) {
        case 'run':
          const command = message.command;
          console.log('收到 webview 消息:', command);
          // 获取工作区路径
          const workspaceFolders = vscode.workspace.workspaceFolders;
          const cwd = workspaceFolders ? workspaceFolders[0].uri.fsPath : process.cwd();

          // 新建一个终端（可以复用一个固定名字的终端，避免开很多）
          const terminal = vscode.window.createTerminal({
            name: '命令执行终端',
            cwd, // 设置工作目录
          });

          terminal.show(); // 激活终端
          terminal.sendText(command); // 执行命令
          // 这里可以执行逻辑，比如调用 shell、执行任务、返回结果给 webview
          // 比如再发回消息：
          // panel.webview.postMessage({ type: 'result', success: true, output: `执行了: ${command}` });
          break;
      }
    },
    undefined,
    context.subscriptions,
  );
}
