import * as vscode from 'vscode';
import * as path from 'path';

export class HtmlParserService {

  public static async parseAndResolveHtml(htmlFilePath: string, webview: vscode.Webview): Promise<string> {
    try {
      const fileUri = vscode.Uri.file(htmlFilePath);
      const contentBytes = await vscode.workspace.fs.readFile(fileUri);
      let content: string = Buffer.from(contentBytes).toString('utf8');
      const baseDir = path.dirname(htmlFilePath);
      const linkRegex = /(src|href)\s*=\s*(['"])(.*?)\2/gi;

      content = content.replace(linkRegex, (match, attr, quote, relPath) => {
        if (relPath.startsWith('http://') || relPath.startsWith('https://') || relPath.startsWith('data:') || relPath.startsWith('vscode-webview://') || relPath.startsWith('#')) {
          return match;
        }
        try {
          const [cleanPath, queryAndHash] = relPath.split(/(?=[?#])/);
          const absolutePath = path.resolve(baseDir, cleanPath);
          const absoluteUri = vscode.Uri.file(absolutePath);
          const webviewUri = webview.asWebviewUri(absoluteUri).toString();
          return `${attr}=${quote}${webviewUri}${queryAndHash || ''}${quote}`;
        } catch (e) {
          console.error('[HtmlParserService] Resolve path failed for:', relPath, e);
          return match;
        }
      });

      return content;
    } catch (error) {
      console.error('[HtmlParserService] Read HTML failed:', error);
      return `<h2>页面解析失败</h2><p>${String(error)}</p>`;
    }
  }
}