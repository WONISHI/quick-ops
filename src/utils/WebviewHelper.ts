import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export function getReactWebviewHtml(extensionUri: vscode.Uri, webview: vscode.Webview, routeName: string): string {
  const indexPath = path.join(extensionUri.fsPath, 'webview-ui', 'dist', 'index.html');
  
  if (!fs.existsSync(indexPath)) {
    return `<h1>React UI build not found. Please run 'npm run build:ui' in webview-ui folder</h1>`;
  }

  let html = fs.readFileSync(indexPath, 'utf-8');

  const asWebviewUri = (relativePath: string) => {
    const sanitizedPath = relativePath.startsWith('/') ? relativePath.substring(1) : relativePath;
    const localUri = vscode.Uri.joinPath(extensionUri, 'webview-ui', 'dist', sanitizedPath);
    return webview.asWebviewUri(localUri).toString();
  };

  html = html.replace(/(href|src)="([^"]*)"/g, (match, p1, p2) => {
    if (p2.startsWith('http') || p2.startsWith('data:')) return match;
    return `${p1}="${asWebviewUri(p2)}"`;
  });

  const scriptInjection = `<script>window.__ROUTE__ = "${routeName}";</script>`;
  html = html.replace('</head>', `${scriptInjection}\n</head>`);

  return html;
}