import * as vscode from 'vscode';
import * as path from "path";
import type { FileType } from './types/utils';
import { waitForResult } from './utils/promiseResolve';
import { initProperties, MergeProperties } from './global-object/properties';
import { registerConfig } from './register/register-config';
import { registerCompletion } from './register/register-completion';
import { registerExtension } from './register/register-extension';
import { registerTop } from './register/register-top';
import { registerExport } from './register/register-export';
import { registerWorkspaceFolders } from './register/register-workspace-folders';
import { registerSelectionCommand } from './register/register-selection-command';
import { registerMark } from './register/register-mark';
import { registerCodeSnippetsConfig } from './register/register-code-snippets-config';
import { registerLogrcDecoration } from './register/register-logrc-decoration';

export function activate(context: vscode.ExtensionContext) {
  // 监听文件打开
  initProperties(vscode.window.activeTextEditor?.document!);
  vscode.workspace.onDidChangeTextDocument((e) => {
    const filePath = e.document.fileName; // 完整路径
    const ext = path.extname(filePath).slice(1); // 去掉 "."，拿到后缀名
    const fileType = ext.toLowerCase() as FileType; // 这里才是真正的后缀
    MergeProperties({
      content: e.document.getText(),
      fileType: fileType,
      supportsLessSyntax: fileType === 'less',
      supportsScssSyntax: fileType === 'scss',
    });
  });
  // 初始化读取文件配置
  // 没有logrc文件的时候创建logrc
  // 取消git校验
  // 配置文件智能提示
  registerConfig(context);

  // 初始化其他功能
  waitForResult().then((res) => {
    vscode.window.showInformationMessage('插件已激活！');
    console.log('初始化完成！');
    // console代码补全
    registerCompletion(context);
    // 定位文件
    registerExtension(context);
    // 回调顶部
    registerTop(context);
    // 智能导出
    registerExport(context);
    // 合起文件夹
    registerWorkspaceFolders(context);
    // 注册选中触发
    registerSelectionCommand(context);
    // 注册mark
    registerMark(context);
    // 设置代码片段
    registerCodeSnippetsConfig(context);
    // 取消警告
    // 标签补全
    // 导出项目依赖关系
    // 高效清理node module
  });
}

export async function deactivate() {}
