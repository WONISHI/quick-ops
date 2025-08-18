import * as vscode from 'vscode';
import type { EnvConfProps } from './types/EnvConf';
import { properties, initProperties } from './global-object/properties';
import { registerConfig } from './register/register-config';
import { decorationType, registerAreaSearch } from './register/register-area-search';
import { registerCompletion } from './register/register-completion';
import { registerExtension } from './register/register-extension';
import { registerTop } from './register/register-top';

export function activate(context: vscode.ExtensionContext) {
  initProperties(vscode.window.activeTextEditor?.document!);
  vscode.workspace.onDidChangeTextDocument((e) => {
    properties.content = e.document.getText();
    properties.fileType = e.document.languageId;
  });

  // 注册全局配置
  registerConfig(context)?.then((res: EnvConfProps) => {
    // 局部搜索
    registerAreaSearch(context, res);
    // 代码补全
    registerCompletion(context, res);
    // 定位文件
    registerExtension(context, res);
    // 回到顶部
    registerTop(context);
  });
}

export async function deactivate() {
  if (decorationType) {
    decorationType.dispose();
  }
}
