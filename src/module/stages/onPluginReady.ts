import * as vscode from 'vscode';
import { registerQuickPick } from '../../register/register-quick-pick';
import { registerCompletion } from '../../register/register-completion';
import { registerExtension } from '../../register/register-extension';
import { registerTop } from '../../register/register-top';
import { registerExport } from '../../register/register-export';
import { registerWorkspaceFolders } from '../../register/register-workspace-folders';
import { registerSelectionCommand } from '../../register/register-selection-command';
import { registerMark } from '../../register/register-mark';
import { registerCodeSnippetsConfig } from '../../register/register-code-snippets-config';
import { registerLogrcDecoration } from '../../register/register-logrc-decoration';

export default function onPluginReady(context: vscode.ExtensionContext) {
  vscode.window.showInformationMessage('插件已激活！');
  console.log('初始化完成！');
  // 注册Quick Pick
  registerQuickPick(context);
  // console代码补全 √
  registerCompletion(context);
  // 定位文件 √
  registerExtension(context);
  // 回调顶部 √
  registerTop(context);
  // 智能导出 √
  registerExport(context);
  // 合起文件夹
  registerWorkspaceFolders(context);
  // 注册选中触发
  registerSelectionCommand(context);
  // 注册mark
  registerMark(context);
  // 设置代码片段 √
  registerCodeSnippetsConfig(context);
  // 监听是否有忽略文件 √
  registerLogrcDecoration(context);
  // 导出项目依赖关系
  // 高效清理node module
  // tab切换
  // 触发指令
  // 注册侧边栏
}
