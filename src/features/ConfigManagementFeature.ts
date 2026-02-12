import * as vscode from 'vscode';
import { IFeature } from '../core/interfaces/IFeature';
import { ConfigurationService } from '../services/ConfigurationService';
import ColorLog from '../utils/ColorLog';

export class ConfigManagementFeature implements IFeature {
  public readonly id = 'ConfigManagementFeature';

  constructor(private configService: ConfigurationService = ConfigurationService.getInstance()) {}

  public activate(context: vscode.ExtensionContext): void {
    // 创建配置文件命令
    const createCmd = vscode.commands.registerCommand('quickOps.createConfigFile', () => {
      this.configService.createDefaultConfig();
    });

    // 1. 添加到忽略列表命令
    const addIgnoreCmd = vscode.commands.registerCommand('quickOps.addToIgnore', async (uri: vscode.Uri) => {
      const targetUri = uri || vscode.window.activeTextEditor?.document.uri;
      if (targetUri) {
        await this.configService.modifyIgnoreList(targetUri, 'add');
        this.refreshContext(targetUri);
      }
    });

    // 2. 从忽略列表移除命令
    const removeIgnoreCmd = vscode.commands.registerCommand('quickOps.removeFromIgnore', async (uri: vscode.Uri) => {
      const targetUri = uri || vscode.window.activeTextEditor?.document.uri;
      if (targetUri) {
        await this.configService.modifyIgnoreList(targetUri, 'remove');
        this.refreshContext(targetUri);
      }
    });

    context.subscriptions.push(createCmd, addIgnoreCmd, removeIgnoreCmd);

    // 3. 监听编辑器变化，更新上下文 (主要用于 Editor Title / Context Menu)
    context.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) {
          this.refreshContext(editor.document.uri);
        }
      }),
    );

    // 初始化一次
    if (vscode.window.activeTextEditor) {
      this.refreshContext(vscode.window.activeTextEditor.document.uri);
    }

    // 监听配置变化刷新 Context
    this.configService.on('configChanged', () => {
      if (vscode.window.activeTextEditor) {
        this.refreshContext(vscode.window.activeTextEditor.document.uri);
      }
    });

    ColorLog.black(`[${this.id}]`, 'Activated.');
  }

  private refreshContext(uri: vscode.Uri) {
    const isIgnored = this.configService.isIgnoredByExtension(uri.fsPath);
    vscode.commands.executeCommand('setContext', 'quickOps.isCurrentResourceIgnored', isIgnored);
  }
}
