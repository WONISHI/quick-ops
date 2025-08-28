import * as vscode from 'vscode';

export function registerLogrcDecoration(context: vscode.ExtensionContext) {
  const provider: vscode.FileDecorationProvider = {
    onDidChangeFileDecorations: new vscode.EventEmitter<vscode.Uri>().event,
    provideFileDecoration(uri: vscode.Uri) {
      if (uri.path.endsWith('.logrc')) {
        return {
          badge: '📜',
          tooltip: 'quick-ops配置文件',
          color: new vscode.ThemeColor('charts.yellow'), // 可选，设置颜色
        };
      }
      return undefined;
    },
  };

  context.subscriptions.push(vscode.window.registerFileDecorationProvider(provider));
}
