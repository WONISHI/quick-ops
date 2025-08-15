import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 读取当前工作区或插件自带的 .logrc 配置
 * @returns 解析后的配置对象 | null
 */
export function readLogrcConfig<T = any>() {
  const pkgPath = path.resolve(__dirname, '../../package.json');
  console.log('pkgPath',pkgPath);
 if (!fs.existsSync(pkgPath)) {
    vscode.window.showErrorMessage('找不到 package.json 文件');
    return null;
  }
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  console.log('pkg:', pkg);

//   const workspaceFolders = vscode.workspace.workspaceFolders;
//   const extensionPath = vscode.extensions.getExtension('你的发布者ID.你的插件名')?.extensionPath;

//   let configPath: string | null = null;

//   // 1. 优先读取项目根目录下的 .logrc
//   if (workspaceFolders && workspaceFolders.length > 0) {
//     const rootPath = workspaceFolders[0].uri.fsPath;
//     const projectConfig = path.join(rootPath, '.logrc');
//     if (fs.existsSync(projectConfig)) {
//       configPath = projectConfig;
//     }
//   }

//   // 2. 如果项目里没有，读取插件自带的 .logrc
//   if (!configPath && extensionPath) {
//     const defaultConfig = path.join(extensionPath, 'config', '.logrc');
//     if (fs.existsSync(defaultConfig)) {
//       configPath = defaultConfig;
//     }
//   }

//   if (!configPath) {
//     vscode.window.showWarningMessage('.logrc 文件不存在（项目 & 插件都没有）');
//     return null;
//   }

//   try {
//     const content = fs.readFileSync(configPath, 'utf-8').trim();
//     return JSON.parse(content) as T;
//   } catch (err) {
//     vscode.window.showErrorMessage(`读取或解析 .logrc 文件失败: ${err}`);
//     return null;
//   }
}
