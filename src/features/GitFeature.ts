import * as vscode from 'vscode';
import { IFeature } from '../core/interfaces/IFeature';
import { GitWebviewProvider } from '../providers/GitWebviewProvider';
import ColorLog from '../utils/ColorLog';

export class GitFeature implements IFeature {
  public readonly id = 'GitFeature';

  public activate(context: vscode.ExtensionContext): void {
    // 实例化 Git Webview Provider
    const gitProvider = new GitWebviewProvider(context.extensionUri);

    // 注册侧边栏视图 (ID 必须和 package.json 中 views 里的 id 完全一致)
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider('quickOps.gitView', gitProvider)
    );

    // 如果后续你需要增加全局的快捷键命令，也可以注册在这里
    // context.subscriptions.push(vscode.commands.registerCommand('quick-ops.git.xxx', () => { ... }))

    ColorLog.black(`[${this.id}]`, 'Activated.');
  }
}