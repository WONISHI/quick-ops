import * as vscode from 'vscode';
import { QuickOpsApplication } from './app/QuickOpsApplication';

let app: QuickOpsApplication | undefined;

/**
 * 插件激活入口
 */
export function activate(context: vscode.ExtensionContext) {
  app = new QuickOpsApplication(context);
  app.start();
}

/**
 * 插件停用入口
 */
export function deactivate() {
  if (app) {
    app.dispose();
    app = undefined;
  }
}
