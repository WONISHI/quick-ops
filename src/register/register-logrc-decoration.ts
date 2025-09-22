import * as vscode from 'vscode';
import EventBus from '../utils/emitter';
import { properties } from '../global-object/properties';

export function registerLogrcDecoration(context: vscode.ExtensionContext) {
  const instance = EventBus.getInstance('add-ignore-file');
  let ignoreHint = !!properties?.settings?.git?.length;

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
      return undefined;
    },
  };

  EventBus.subscribe('add-ignore', (n: { hint: boolean }) => {
    ignoreHint = n.hint;
    // 通知 VSCode 刷新 .logrc 文件的装饰
    vscode.workspace.findFiles('**/*.logrc').then((uris: vscode.Uri[]) => {
      uris.forEach((uri) => instance.emitter.fire(uri));
    });
  });

  context.subscriptions.push(vscode.window.registerFileDecorationProvider(provider));
}
