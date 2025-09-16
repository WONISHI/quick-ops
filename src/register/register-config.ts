import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import NotificationService from '../utils/notificationService';
import { resolveResult } from '../utils/promiseResolve';
import { ignoreArray, ignoreFilesLocally, unignoreFilesLocally } from '../utils/index';
import { MergeProperties, properties } from '../global-object/properties';
import { is } from 'node_modules/cheerio/dist/commonjs/api/traversing';

const CONFIG_FILES = ['.prettierrc', '.gitignore', 'package.json', '.logrc', '.markdownlint.json', 'eslint.config.mjs', 'tsconfig.json'] as const;
type ConfigFile = (typeof CONFIG_FILES)[number];

// 通用的配置读取
async function readConfigFile(uri: vscode.Uri): Promise<any | null> {
  try {
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
        MergeProperties({ ignorePluginConfig: [undefined, true].includes(content.excludedConfigFiles) });
        MergeProperties({ workspaceConfig: content, configResult: true });
      }
      if (fileName === 'package') {
        MergeProperties({
          projectName: content.name || '',
          languagesCss: Object.keys(content.devDependencies).includes('sass') ? 'scss' : Object.keys(content.devDependencies).includes('less') ? 'less' : 'css',
          isVueProject: [2, 3].includes(content.dependencies?.vue) || [2, 3].includes(content.devDependencies?.vue),
          isReactProject: [16, 17].includes(content.dependencies?.react) || [16, 17].includes(content.devDependencies?.react),
          vueVersion: content.dependencies?.vue || content.devDependencies?.vue,
          reactVersion: content.dependencies?.react || content.devDependencies?.react,
          scripts: content.scripts || null,
        });
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
    NotificationService.error(`读取配置文件出错: ${uri.fsPath}, ${err}`);
    return null;
  }
}

// 通用的处理逻辑
async function handleConfig(uri: vscode.Uri, context?: vscode.ExtensionContext) {
  const config = await readConfigFile(uri);
  // 如果 .logrc 文件不存在 (configResult 为 false)，则显示菜单
  const logrcFound = properties.configResult && path.basename(uri.fsPath) === '.logrc';

  // 设置上下文键
  // 如果找到了 .logrc 文件，Extension.logrcNotFound 的值为 false
  // 否则为 true
  vscode.commands.executeCommand('setContext', 'Extension.logrcNotFound', !logrcFound);
  if (config) {
    initPlugins(config);
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
      const configPath = path.join(folder.uri.fsPath, file);
      if (fs.existsSync(configPath)) {
        handleConfig(vscode.Uri.file(configPath), context);
      }

      // 监听变化
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, file));

      // watcher.onDidChange((uri) => handleConfig(uri));
      watcher.onDidCreate((uri) => handleConfig(uri, context));
      watcher.onDidDelete((uri) => {
        NotificationService.warn(`${file} 已删除`);
        MergeProperties({ workspaceConfig: {}, configResult: false });
        handleConfig(uri, context);
      });
      context.subscriptions.push(watcher);
    }
  }
}

export async function registerConfig(context: vscode.ExtensionContext) {
  // 注册创建文件的命令
  let disposable = vscode.commands.registerCommand('extension.createLogrcFile', async () => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      NotificationService.warn('请先打开一个工作区。');
      return;
    }

    const logrcPath = path.join(workspaceFolder.uri.fsPath, '.logrc');
    // 读取插件自身的配置文件
    const pluginConfigPath = path.join(context.extensionPath, '/src/module/template/logrc.template.json');
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
  const configPath = path.join(workspaceFolders!.uri.fsPath, '.logrc');
  if (!fs.existsSync(configPath)) {
    vscode.commands.executeCommand('setContext', 'Extension.logrcNotFound', true);
    initPlugins('.logrc');
    return;
  }
  // 读取每个工作区的配置文件
  registerConfigWatchers(context);
  // 分开调用，逻辑更清晰
  registerSaveWatcher(context);
}

function initPlugins(config: ConfigFile) {
  switch (config) {
    case '.gitignore':
      return setIgnoredFiles();
    case '.logrc':
      return setLogrc();
    default:
      return;
  }
}

// 设置忽略文件
function setIgnoredFiles() {
  if (properties.ignorePluginConfig) {
    let result = ignoreFilesLocally(properties.ignore);
    MergeProperties({ isGitTracked: !!result });
    if (result) NotificationService.info('检测到 .gitignore 配置了 .logrc，插件将忽略对 .logrc 的跟踪');
  } else {
    let result = unignoreFilesLocally(properties.ignore);
    MergeProperties({ isGitTracked: !!result });
    if (result) NotificationService.info('检测到未忽略 .logrc，插件将跟踪对 .logrc 的更改');
  }
}

// 设置
function setLogrc() {
  setIgnoredFiles();
  resolveResult(true);
}

function createProject() {}
