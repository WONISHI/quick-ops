import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

let currentConfig: any = null;
let watchers: vscode.FileSystemWatcher[] = [];

// 创建事件发射器
const _onDidChangeConfig = new vscode.EventEmitter<any>();
export const onDidChangeLogrcConfig = _onDidChangeConfig.event;

/**
 * 注册读取并监听项目 & 插件自带的 .logrc 配置
 */
export function registerLogrcConfig<T = any>(context: vscode.ExtensionContext) {

  const workspaceFolders = vscode.workspace.workspaceFolders;
  const rootPath = workspaceFolders && workspaceFolders.length > 0 ? workspaceFolders[0].uri.fsPath : null;

  const loadConfig = () => {
    let configPath: string | null = null;

    // 1️⃣ 优先读取项目根目录
    if (rootPath) {
      const projectConfig = path.join(rootPath, '.logrc');
      if (fs.existsSync(projectConfig)) configPath = projectConfig;
    }

    if (!configPath) {
      currentConfig = null;
      _onDidChangeConfig.fire(currentConfig);
      return;
    }

    try {
      const content = fs.readFileSync(configPath, 'utf-8').trim();
      currentConfig = JSON.parse(content) as T;
      _onDidChangeConfig.fire(currentConfig);
    } catch (err) {
      currentConfig = null;
      _onDidChangeConfig.fire(currentConfig);
      vscode.window.showErrorMessage(`读取或解析 .logrc 文件失败: ${err}`);
    }
  };

  // 初次加载配置
  loadConfig();

  // 创建安全 watcher
  const createWatcher = (watchFolder: string) => {
    if (!watchFolder || !fs.existsSync(watchFolder)) return;

    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(watchFolder, '.logrc')
    );

    watcher.onDidChange(loadConfig);
    watcher.onDidCreate(loadConfig);
    watcher.onDidDelete(() => {
      currentConfig = null;
      _onDidChangeConfig.fire(currentConfig);
    });

    context.subscriptions.push(watcher);
    watchers.push(watcher);
  };

  // 监听项目根目录 .logrc
  if (rootPath) createWatcher(rootPath);
};

