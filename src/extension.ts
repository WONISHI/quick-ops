import * as vscode from 'vscode';
import { QuickOpsApplication } from './app/quick-ops.application';

let app: QuickOpsApplication | undefined;

/**
 * 插件激活入口
 */
export async function activate(context: vscode.ExtensionContext) {
  app = new QuickOpsApplication(context);
  await app.start();
}

/**
 * 插件停用入口
 */
export async function deactivate() {
  if (app) {
    await app.dispose();
    app = undefined;
  }
}