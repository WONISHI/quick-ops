import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { useRegisterEditorSelection } from '../hook/useEditorSelection';
import { mergeGlobalVars, properties } from '../../global-object/properties';
import { findPackageJsonFolder } from '../mixin/mixin-config';
import VSCodeNotifier from '../../services/VSCodeNotifier';
// 加载插件自带的代码片段
// 插件开始注册
export default async function beforePluginInit(context: vscode.ExtensionContext) {
  // 注册hook
  useRegisterEditorSelection(context);

  mergeGlobalVars({ rootFilePath: await findPackageJsonFolder() });

  // mergeGlobalVars({ snippets: await MixinReadSnippets() });

  // 注册创建文件的命令
  let disposable = vscode.commands.registerCommand('extension.createLogrcFile', async (uri?: vscode.Uri) => {
    // 如果是在资源管理器里右键，uri 就是被点击的文件或文件夹
    const targetPath = uri?.fsPath;
    if (properties.rootFilePath !== targetPath) {
      vscode.window.showInformationMessage('请在根目录创建！');
      return;
    }

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      VSCodeNotifier.warn('请先打开一个工作区。', 3000);
      return;
    }

    const logrcPath = path.join(properties.rootFilePath, '.logrc');
    // 读取插件自身的配置文件
    const pluginConfigPath = path.join(context.extensionPath, 'resources', 'template', 'logrc-template.json');
    const fileContent = fs.readFileSync(pluginConfigPath, 'utf8'); // 或者一个空 JSON 对象

    try {
      // 1. 写入文件内容
      const fileUri = vscode.Uri.file(logrcPath);
      await vscode.workspace.fs.writeFile(fileUri, Buffer.from(fileContent));
      VSCodeNotifier.info('.logrc 文件已创建！', 3000);
      // 2. 打开并显示这个文件
      const document = await vscode.workspace.openTextDocument(fileUri);
      await vscode.window.showTextDocument(document, vscode.ViewColumn.One);
    } catch (error) {
      VSCodeNotifier.error(`创建文件失败: ${error}`, 3000);
    }
  });
  context.subscriptions.push(disposable);
}
