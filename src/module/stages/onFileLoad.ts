import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import NotificationService from '../../utils/notificationService';
import onPluginInit from '../../module/stages/onPluginInit';
import { ignoreArray, generateKeywords } from '../../utils/index';
import { MergeProperties, properties, computeGitChanges } from '../../global-object/properties';
import { CONFIG_FILES, type ConfigFile } from '../../types/Properties';

// 通用的配置读取
// 插件读取配置化文件
async function readConfigFile(uri: vscode.Uri): Promise<any | null> {
  try {
    try {
      await vscode.workspace.fs.stat(uri);
    } catch {
      console.log(`文件不存在: ${uri.fsPath}`);
      return null;
    }
    const document = await vscode.workspace.openTextDocument(uri);
    const text = document.getText();
    const basename = path.basename(uri.fsPath);
    if (text.trim().length === 0) {
      MergeProperties({ workspaceConfig: {}, configResult: true });
      return basename;
    }
    if (basename.endsWith('.json') || /^\.[^.]+rc(\.json)?$/i.test(basename)) {
      const content = JSON.parse(text);
      const fileName = basename.split('.')[0];
      // 读取logrc配置
      if (basename === '.logrc') {
        // 项目是否忽略配置文件
        MergeProperties({ ignorePluginConfig: [undefined, true].includes(content.excludedConfigFiles) });
        // 忽略配置文件情况
        /*封装方法比较旧值的properties.workspaceConfig.git(可能会出现properties.workspaceConfig不存在，
         * properties.workspaceConfig.git不存在，properties.workspaceConfig.git的长度为0）和新值的property.workspaceConfig
         * (可能会出现property.workspaceConfig不存在，property.workspaceConfig.git不存在，property.workspaceConfig.git的长度为0）找出新增和删除项，类型都是string[]
         */
        const gitChanges = computeGitChanges(properties.workspaceConfig!, content!);
        MergeProperties({ ignoredChanges: gitChanges });
        // 合并项目的配置文件
        MergeProperties({ workspaceConfig: content, configResult: true });
      }
      if (fileName === 'package') {
        const isVueProject = !!content.dependencies?.vue || !!content.devDependencies?.vue;
        const isReactProject = !!content.dependencies?.react || !!content.devDependencies?.react;
        const vueVersion = content.dependencies?.vue || content.devDependencies?.vue;
        const reactVersion = content.dependencies?.react || content.devDependencies?.react;
        const version = isVueProject ? vueVersion : reactVersion;
        MergeProperties({
          projectName: content.name || '',
          languagesCss: Object.keys(content.devDependencies).includes('sass') ? 'scss' : Object.keys(content.devDependencies).includes('less') ? 'less' : 'css',
          isVueProject: isVueProject,
          isReactProject: isReactProject,
          vueVersion: vueVersion,
          reactVersion: reactVersion,
          scripts: content.scripts || null,
          keywords: generateKeywords(isVueProject ? 'vue' : 'react', version),
        });
      }
    }
    if (basename.endsWith('.mjs')) {
    }
    // 忽略文件
    if (/^\.[^.]+ignore$/i.test(basename)) {
      if (basename === '.gitignore') {
        const workspaceIgnore = ignoreArray(text);
        MergeProperties({ ignorePluginConfig: !workspaceIgnore.includes('.logrc') ? properties.ignorePluginConfig : workspaceIgnore.includes('.logrc') });
      }
    }
    return basename;
  } catch (err) {
    console.log('err', err, uri);
    // NotificationService.error(`读取配置文件出错: ${uri.fsPath}, ${err}`);
    return null;
  }
}

// 通用的处理逻辑
async function handleConfig(uri: vscode.Uri, context?: vscode.ExtensionContext) {
  try {
    const config = await readConfigFile(uri);
    // 如果 .logrc 文件不存在 (configResult 为 false)，则显示菜单
    const logrcFound = properties.configResult;
    // 设置上下文键
    // 如果找到了 .logrc 文件，Extension.logrcNotFound 的值为 false
    // 否则为 true
    vscode.commands.executeCommand('setContext', 'Extension.logrcNotFound', !logrcFound);
    if (config) {
      onPluginInit(config);
    }
  } catch (err) {
    console.log('err', err);
  }
}

// 专门注册 onDidSaveTextDocument 监听器
function registerSaveWatcher(context: vscode.ExtensionContext) {
  // 这个监听器只需要注册一次
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((document) => {
      const basename = path.basename(document.uri.fsPath);
      if (CONFIG_FILES.includes(basename as ConfigFile)) {
        handleConfig(document.uri, context);
      }
    }),
  );
}

function registerConfigWatchers(context: vscode.ExtensionContext) {
  const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
  for (const folder of workspaceFolders) {
    for (const file of CONFIG_FILES) {
      const configPath = path.join(properties.rootFilePath, file);
      if (fs.existsSync(configPath)) {
        handleConfig(vscode.Uri.file(configPath), context);
      }

      // 监听变化
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, file));

      // watcher.onDidChange((uri) => handleConfig(uri));
      watcher.onDidCreate((uri) => handleConfig(uri, context));
      watcher.onDidDelete((uri) => {
        NotificationService.warn(`${file} 已删除`,3000);
        vscode.commands.executeCommand('setContext', 'Extension.logrcNotFound', true);
        MergeProperties({ workspaceConfig: {}, configResult: false });
        handleConfig(uri, context);
      });
      context.subscriptions.push(watcher);
    }
  }
}

export default function onFileLoad(context: vscode.ExtensionContext) {
  // 显示当前工作区信息
  const workspaceFolders = vscode.workspace.workspaceFolders?.[0];
  // 读取插件自身的配置文件
  const pluginConfigPath = path.join(context.extensionPath, '.logrc');
  if (fs.existsSync(pluginConfigPath)) {
    try {
      const content = JSON.parse(fs.readFileSync(pluginConfigPath, 'utf8'));
      MergeProperties({ pluginConfig: content });
    } catch (err) {
      NotificationService.error(`读取插件自身 .logrc 出错: ${err}`);
    }
  }
  const configPath = path.join(properties.rootFilePath, '.logrc');
  if (!fs.existsSync(configPath)) {
    MergeProperties({ configResult: false });
    vscode.commands.executeCommand('setContext', 'Extension.logrcNotFound', true);
    onPluginInit('.logrc');
  }
  // 读取每个工作区的配置文件
  registerConfigWatchers(context);
  // 分开调用，逻辑更清晰
  registerSaveWatcher(context);
}
