import * as vscode from 'vscode';
import type { EnvConfProps } from './types/EnvConf';
import type { FileType } from './types/utils';
import { waitForResult } from './utils/promiseResolve';
import { properties, initProperties } from './global-object/properties';
import { registerConfig } from './register/register-config';
import { registerCompletion } from './register/register-completion';
import { registerExtension } from './register/register-extension';
import { registerTop } from './register/register-top';
import { registerExport } from './register/register-export';
import { registerLogrcDecoration } from './register/register-logrc-decoration';

export function activate(context: vscode.ExtensionContext) {
  // 监听文件打开
  initProperties(vscode.window.activeTextEditor?.document!);
  vscode.workspace.onDidChangeTextDocument((e) => {
    properties.content = e.document.getText();
    properties.fileType = e.document.languageId as FileType;
  });
  // 初始化读取文件配置
  registerConfig(context);

  // 初始化其他功能
  waitForResult().then((res) => {
    vscode.window.showInformationMessage('插件已激活！');
    // console代码补全
    registerCompletion(context);
    // 定位文件
    registerExtension(context);
    // 回调顶部
    registerTop(context);
    // 智能导出
    registerExport(context);
  });
}

export async function deactivate() {}
