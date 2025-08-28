import * as vscode from 'vscode';
import type { EnvConfProps } from './types/EnvConf';
import type { FileType } from './types/utils';
import { properties, initProperties } from './global-object/properties';
import { registerConfig } from './register/register-config';
import { decorationType, registerAreaSearch } from './register/register-area-search';
import { registerCompletion } from './register/register-completion';
import { registerExtension } from './register/register-extension';
import { registerTop } from './register/register-top';
import { registerExport } from './register/register-export';
import { registerLogrcDecoration } from './register/register-logrc-decoration';

export function activate(context: vscode.ExtensionContext) {
  initProperties(vscode.window.activeTextEditor?.document!);
  vscode.workspace.onDidChangeTextDocument((e) => {
    properties.content = e.document.getText();
    properties.fileType = e.document.languageId as FileType;
  });

  // 5.注册全局配置，√
  registerConfig(context)?.then((res: EnvConfProps) => {
    // // 1.局部搜索
    // registerAreaSearch(context, res);
    // 3.代码补全 √
    registerCompletion(context, res);
    // 4.定位文件，√
    registerExtension(context, res);
    // 6.回到顶部或者底部，√
    registerTop(context);
    // 8.导入补全 √
    registerExport(context);
    // 2.tab切换

    // 7.合起文件夹

    // 9.其他代码补全以及自定义补全

    // 10.复制树结构

    // 11.css片段

    // 12.给.logrc文件添加logo √
    registerLogrcDecoration(context);

    // 13.todo标注
  });
}

export async function deactivate() {
  if (decorationType) {
    decorationType.dispose();
  }
}
