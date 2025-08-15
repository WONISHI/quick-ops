import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

let currentConfig: any = null;
let watcher: vscode.FileSystemWatcher | null = null;

// 创建事件发射器
const _onDidChangeConfig = new vscode.EventEmitter<any>();
export const onDidChangeLogrcConfig = _onDidChangeConfig.event;

export function registerLogrcConfig<T = any>(context: vscode.ExtensionContext) {
  const pkgPath = path.join(context.extensionPath, 'package.json');
  if (!fs.existsSync(pkgPath)) return;

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  const id = `${pkg.publisher}.${pkg.name}`;

  const workspaceFolders = vscode.workspace.workspaceFolders;
  const rootPath = workspaceFolders && workspaceFolders.length > 0 ? workspaceFolders[0].uri.fsPath : null;
  const extensionPath = vscode.extensions.getExtension(id)?.extensionPath;

  const loadConfig = () => {
    let configPath: string | null = null;
    let isProjectConfig = false;

    if (rootPath) {
      const projectConfig = path.join(rootPath, '.logrc');
      if (fs.existsSync(projectConfig)) {
        configPath = projectConfig;
        isProjectConfig = true;
      }
    }

    // 项目没有 .logrc，使用插件默认配置（只在初始化）
    if (!configPath && extensionPath) {
      const pluginConfig = path.join(extensionPath, '.logrc');
      if (fs.existsSync(pluginConfig)) {
        configPath = pluginConfig;
        isProjectConfig = false;
      }
    }

    if (!configPath) {
      currentConfig = null;
      _onDidChangeConfig.fire(currentConfig);
      return;
    }

    try {
      const content = fs.readFileSync(configPath, 'utf-8').trim();
      currentConfig = JSON.parse(content) as T;
      _onDidChangeConfig.fire(currentConfig); // 🔹触发事件
      console.log('读取配置:', currentConfig);

      // 只监听项目 .logrc
      if (isProjectConfig && !watcher && rootPath) {
        watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(rootPath, '.logrc'));
        watcher.onDidChange(loadConfig);
        watcher.onDidCreate(loadConfig);
        watcher.onDidDelete(() => {
          currentConfig = null;
          _onDidChangeConfig.fire(currentConfig);
        });
        context.subscriptions.push(watcher);
      }
    } catch (err) {
      currentConfig = null;
      _onDidChangeConfig.fire(currentConfig);
      vscode.window.showErrorMessage(`读取或解析 .logrc 文件失败: ${err}`);
    }
  };

  // 初始加载
  loadConfig();
};

export function getLogrcConfig<T = any>() {
  return currentConfig as T | null;
}
