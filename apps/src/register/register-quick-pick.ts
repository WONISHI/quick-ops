import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getWebviewContent, generateUUID } from '../utils/index';
import { mergeGlobalVars, properties } from '../global-object/properties';
import { MixinSubscribeCommandChannel } from '../module/mixin/mixin-quick-pick';

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
        mergeGlobalVars({ nonce: '', panel: undefined });
        return;
      }

      // Webview 不存在 → 创建新的
      panel = vscode.window.createWebviewPanel('reactWebview', 'quick-ops(控制台)', vscode.ViewColumn.Beside, {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, 'resources/webview'))],
      });

      panel.webview.html = getWebviewContent(panel, context);
      panel.reveal();
      mergeGlobalVars({ panel });

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
          MixinSubscribeCommandChannel(message);
        },
        undefined,
        context.subscriptions,
      );
    }),
  );
}
