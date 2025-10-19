import * as vscode from 'vscode';
import * as path from 'path';
import type { FileType } from '../../types/utils';
import { initProperties, mergeGlobalVars } from '../../global-object/properties';
import { registerConfig } from '../../register/register-config';

// 插件准备期间
export default function onPrepareStart(context: vscode.ExtensionContext) {
  // 监听文件打开
  initProperties(vscode.window.activeTextEditor?.document!);
  vscode.workspace.onDidChangeTextDocument((e) => {
    const filePath = e.document.fileName; // 完整路径
    const ext = path.extname(filePath).slice(1); // 去掉 "."，拿到后缀名
    const fileType = ext.toLowerCase() as FileType; // 这里才是真正的后缀
    mergeGlobalVars({
      content: e.document.getText(),
      fileType: fileType,
      supportsLessSyntax: fileType === 'less',
      supportsScssSyntax: fileType === 'scss',
    });
  });
  // 初始化读取文件配置 √
  // 没有logrc文件的时候创建logrc √
  // 取消git校验
  // 配置文件智能提示
  // 取消git校验
  registerConfig(context);
}
