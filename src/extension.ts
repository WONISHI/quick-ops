import * as vscode from 'vscode';
import { decorationType, registerAreaSearch } from './register/register-area-search';
import { registerCompletion } from './register/register-completion';
import { registerExtension } from './register/register-extension';

export function activate(context: vscode.ExtensionContext) {
  // 注册区域搜索
  registerAreaSearch(context);
  // 注册 console 插入
  registerCompletion(context);
  // 注册文件定位
  registerExtension(context);
}

export function deactivate() {
  if (decorationType) {
    decorationType.dispose();
  }
}
