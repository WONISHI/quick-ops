import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ignoreArray } from '@/utils/index';
import { setEnvConf } from '@/global-object/envconfig';
import { MergeProperties, properties } from '@/global-object/properties';

const CONFIG_FILES = ['.prettierrc', '.gitignore', '.logrc', '.markdownlint.json', 'eslint.config.mjs', 'tsconfig.json'] as const;
type ConfigFile = (typeof CONFIG_FILES)[number];
// 通用的配置读取
async function readConfigFile(uri: vscode.Uri): Promise<any | null> {
  try {
    const document = await vscode.workspace.openTextDocument(uri);
    const text = document.getText();
    const basename = path.basename(uri.fsPath);
    if (basename.endsWith('.json') || /^\.[^.]+rc(\.json)?$/i.test(basename)) {
      const content = JSON.parse(text);
      if (basename === '.logrc') {
        MergeProperties({ workspaceConfig: content, configResult: true });
      }
    }
    if (basename.endsWith('.mjs')) {
    }
    // 忽略文件
    if (/^\.[^.]+ignore$/i.test(basename)) {
      if (basename === '.gitignore') {
        const workspaceIgnore = ignoreArray(text);
        MergeProperties({ ignorePluginConfig: workspaceIgnore.includes('.logrc') });
      }
    }
    return basename;
  } catch (err) {
    vscode.window.showErrorMessage(`读取配置文件出错: ${uri.fsPath}, ${err}`);
    return null;
  }
}

// 通用的处理逻辑
async function handleConfig(uri: vscode.Uri) {
  const config = await readConfigFile(uri);
  if (config) {
    initPlugins(config);
  }
}

function registerConfigWatchers(context: vscode.ExtensionContext) {
  const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
  for (const folder of workspaceFolders) {
    for (const file of CONFIG_FILES) {
      const configPath = path.join(folder.uri.fsPath, file);
      if (fs.existsSync(configPath)) {
        handleConfig(vscode.Uri.file(configPath));
      }

      // 监听变化
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, file));

      watcher.onDidChange((uri) => handleConfig(uri));
      watcher.onDidCreate((uri) => handleConfig(uri));
      watcher.onDidDelete(() => {
        MergeProperties({ workspaceConfig: null, configResult: false });
        // initPlugins();
        vscode.window.showWarningMessage(`${file} 已删除`);
      });

      context.subscriptions.push(watcher);
    }
  }
}

export async function registerConfig(context: vscode.ExtensionContext) {
  // 显示当前工作区信息
  const workspaceFolders = vscode.workspace.workspaceFolders;

  // 读取插件自身的配置文件
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
    initPlugins('.logrc');
    return;
  }

  // 读取每个工作区的配置文件
  registerConfigWatchers(context);
}

function initPlugins(config: ConfigFile) {
  switch (config) {
    case '.gitignore':
      return setIgnoredFiles();
    default:
      return;
  }
}

// 设置忽略文件
function setIgnoredFiles() {
  if (properties.ignorePluginConfig) return;
  console.log(properties);
}
