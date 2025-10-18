import * as vscode from 'vscode';
import beforePluginInit from '../module/stages/beforePluginInit';
import onFileLoad from '../module/stages/onFileLoad';

export async function registerConfig(context: vscode.ExtensionContext) {
  // 初始化注册其他内容
  await beforePluginInit(context);
  onFileLoad(context);
}
