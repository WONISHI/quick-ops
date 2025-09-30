import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { useEditorSelection } from '../hook/useEditorSelection';
import { MergeProperties } from '../../global-object/properties';
import { findPackageJsonFolder } from '../mixin/mixin-config';
import NotificationService from '../../utils/notificationService';
// 加载插件自带的代码片段
export default async function beforePluginInit(context: vscode.ExtensionContext) {
  // 注册hook
  useEditorSelection(context);

  MergeProperties({ rootFilePath: await findPackageJsonFolder() });

  // MergeProperties({ snippets: await MixinReadSnippets() });

  // 注册创建文件的命令
  let disposable = vscode.commands.registerCommand('extension.createLogrcFile', async () => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      NotificationService.warn('请先打开一个工作区。');
      return;
    }

    const logrcPath = path.join(workspaceFolder.uri.fsPath, '.logrc');
    // 读取插件自身的配置文件
    const pluginConfigPath = path.join(context.extensionPath, 'resources', 'template', 'logrc-template.json');
    const fileContent = fs.readFileSync(pluginConfigPath, 'utf8'); // 或者一个空 JSON 对象

    try {
      // 1. 写入文件内容
      const fileUri = vscode.Uri.file(logrcPath);
      await vscode.workspace.fs.writeFile(fileUri, Buffer.from(fileContent));
      NotificationService.info('.logrc 文件已创建！');
      // 2. 打开并显示这个文件
      const document = await vscode.workspace.openTextDocument(fileUri);
      await vscode.window.showTextDocument(document, vscode.ViewColumn.One);
    } catch (error) {
      NotificationService.error(`创建文件失败: ${error}`);
    }
  });
  context.subscriptions.push(disposable);
}
