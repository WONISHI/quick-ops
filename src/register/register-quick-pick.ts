import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { generateUUID } from '../utils/index';

export function registerQuickPick(context: vscode.ExtensionContext) {
  const panel = vscode.window.createWebviewPanel('reactWebview', 'quick-ops(控制台)', vscode.ViewColumn.Beside, {
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
}
