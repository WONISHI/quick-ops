import * as vscode from 'vscode';
import { registerConfig } from './register/register-config';
import { decorationType, registerAreaSearch } from './register/register-area-search';
import { registerCompletion } from './register/register-completion';
import { registerExtension } from './register/register-extension';
import type { EnvConf } from './types/EnvConf';

export function activate(context: vscode.ExtensionContext) {
  // 注册获取配置项
  registerConfig(context)?.then((res: Partial<EnvConf>) => {
    console.log('Logrc Config:', res);
  });
  // 注册区域搜索
  registerAreaSearch(context);
  // 注册 console 插入
  registerCompletion(context);
  // 注册文件定位
  registerExtension(context);
  // tab+a / tab+d 上下切换
}

export function deactivate() {
  if (decorationType) {
    decorationType.dispose();
  }
}
