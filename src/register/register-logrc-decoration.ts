import * as vscode from 'vscode';
import EventBus from '../utils/emitter';

export function registerLogrcDecoration(context: vscode.ExtensionContext) {
  const instance = EventBus.getInstance('add-ignore-file');
  let ignoreHint = false;

  // 文件装饰提供器
  const provider: vscode.FileDecorationProvider = {
    onDidChangeFileDecorations: instance.event as vscode.Event<vscode.Uri>,
    provideFileDecoration(uri: vscode.Uri) {
      if (uri.path.endsWith('.logrc') && ignoreHint) {
        return {
          badge: '✔',
          tooltip: '已启用 ignore',
          color: new vscode.ThemeColor('charts.green'),
        };
      }
      console.log('9999', ignoreHint);
      return undefined;
    },
  };

  context.subscriptions.push(vscode.window.registerFileDecorationProvider(provider));

  EventBus.subscribe('add-ignore', (n: { hint: boolean }) => {
    ignoreHint = n.hint;
    // 通知 VSCode 刷新 .logrc 文件的装饰
    vscode.workspace.findFiles('**/*.logrc').then((uris: vscode.Uri[]) => {
      uris.forEach((uri) => instance.emitter.fire(uri));
    });
  });
}
