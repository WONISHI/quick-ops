import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { setEnvConf } from '../global-object/envconfig';
import { MergeProperties, properties } from '../global-object/properties';

export async function registerConfig(context: vscode.ExtensionContext) {
  // 显示当前工作区信息
  const workspaceFolders = vscode.workspace.workspaceFolders;

  // 1️⃣ 读取插件自身的配置文件
  const pluginConfigPath = path.join(context.extensionPath, '.logrc');
  if (fs.existsSync(pluginConfigPath)) {
    try {
      const content = JSON.parse(fs.readFileSync(pluginConfigPath, 'utf8'));
      setEnvConf(content);
      MergeProperties({ pluginConfig: content });
    } catch (err) {
      vscode.window.showErrorMessage(`读取插件自身 .logrc 出错: ${err}`);
    }
  }

  if (!workspaceFolders) {
    initPlugins();
    return;
  }

  // 2️⃣ 读取每个工作区的配置文件
  for (const folder of workspaceFolders) {
    const projectConfigPath = path.join(folder.uri.fsPath, '.logrc');
    if (fs.existsSync(projectConfigPath)) {
      try {
        const content = JSON.parse(fs.readFileSync(projectConfigPath, 'utf8'));
        setEnvConf(content);
        MergeProperties({ workspaceConfig: content, configResult: true });
        initPlugins();
      } catch (err) {
        vscode.window.showErrorMessage(`读取工作区 .logrc 出错: ${err}`);
      }
    }
    // 3️⃣ 监听配置文件变化
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, '.logrc'));
    watcher.onDidChange((uri) => loadConfig(uri));
    watcher.onDidCreate((uri) => loadConfig(uri));
    watcher.onDidDelete(() => {
      MergeProperties({ workspaceConfig: null, configResult: false });
      initPlugins();
      vscode.window.showWarningMessage('.logrc 已删除');
    });
    context.subscriptions.push(watcher);
  }
  async function loadConfig(uri: vscode.Uri) {
    try {
      const document = await vscode.workspace.openTextDocument(uri);
      const content = JSON.parse(document.getText());
      setEnvConf(content);
      MergeProperties({ workspaceConfig: content, configResult: true });
      initPlugins();
    } catch (err) {
      vscode.window.showErrorMessage(`加载 .logrc 出错: ${err}`);
    }
  }
}

function initPlugins() {
  setIgnoredFiles();
}

// 设置忽略文件
function setIgnoredFiles() {}
