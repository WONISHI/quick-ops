import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

// 🌟 修改第一个参数为 extensionUri: vscode.Uri
export function getReactWebviewHtml(extensionUri: vscode.Uri, webview: vscode.Webview, routeName: string): string {
  // 🌟 使用 extensionUri.fsPath 替代 context.extensionPath
  const indexPath = path.join(extensionUri.fsPath, 'webview-ui', 'dist', 'index.html');
  
  if (!fs.existsSync(indexPath)) {
    return `<h1>React UI build not found. Please run 'npm run build:ui' in webview-ui folder</h1>`;
  }

  let html = fs.readFileSync(indexPath, 'utf-8');

  // 将相对路径的资源转换为 VS Code 认可的安全 URI
  const asWebviewUri = (relativePath: string) => {
    const sanitizedPath = relativePath.startsWith('/') ? relativePath.substring(1) : relativePath;
    // 🌟 直接使用传入的 extensionUri
    const localUri = vscode.Uri.joinPath(extensionUri, 'webview-ui', 'dist', sanitizedPath);
    return webview.asWebviewUri(localUri).toString();
  };

  html = html.replace(/(href|src)="([^"]*)"/g, (match, p1, p2) => {
    if (p2.startsWith('http') || p2.startsWith('data:')) return match;
    return `${p1}="${asWebviewUri(p2)}"`;
  });

  // 注入路由标识！
  const scriptInjection = `<script>window.__ROUTE__ = "${routeName}";</script>`;
  html = html.replace('</head>', `${scriptInjection}\n</head>`);

  return html;
}