import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
export function registerWorkspaceFolders(context: vscode.ExtensionContext) {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    vscode.window.showWarningMessage('当前没有打开任何工作区文件夹');
    return;
  }
}
