import * as vscode from 'vscode';
import { waitForResult } from './utils/promiseResolve';
import onPrepareStart from './module/stages/onPrepareStart';
import onPluginReady from './module/stages/onPluginReady';

export function activate(context: vscode.ExtensionContext) {
  onPrepareStart(context);

  // 初始化其他功能
  waitForResult().then((res) => {
    onPluginReady(context);
  });
}

export async function deactivate() {}
