import * as vscode from 'vscode';
import { IFeature } from '../core/interfaces/IFeature';
import { ConfigurationService } from '../services/ConfigurationService';
import ColorLog from '../utils/ColorLog';

export class ConfigManagementFeature implements IFeature {
  public readonly id = 'ConfigManagementFeature';

  constructor(private configService: ConfigurationService = ConfigurationService.getInstance()) {}

  public activate(context: vscode.ExtensionContext): void {
    // 🌟 核心修改 1：不再创建物理文件，而是直接打开 VS Code 的原生设置面板并定位到 quick-ops！
    const openSettingsCmd = vscode.commands.registerCommand('quick-ops.createConfigFile', () => {
      // 打开原生设置 UI，并自动搜索 quick-ops
      vscode.commands.executeCommand('workbench.action.openSettings', 'quick-ops');
      vscode.window.showInformationMessage('✨ Quick Ops 现已升级为 VS Code 原生配置，请直接在此面板中修改。');
    });

    // 🌟 核心修改 2：Toggle 命令底层已被 ConfigurationService 接管，逻辑保持不变
    const toggleIgnoreCmd = vscode.commands.registerCommand('quick-ops.toggleIgnore', async (uri: vscode.Uri, selectedUris?: vscode.Uri[]) => {
      // 1. 获取目标文件列表（优先使用多选，其次右键单选，最后兜底当前激活的编辑器）
      let targets: vscode.Uri[] = [];
      if (selectedUris && selectedUris.length > 0) {
        targets = selectedUris;
      } else if (uri) {
        targets = [uri];
      } else if (vscode.window.activeTextEditor) {
        targets = [vscode.window.activeTextEditor.document.uri];
      }

      if (targets.length === 0) return;

      let addedCount = 0;
      let removedCount = 0;

      // 2. 遍历处理（智能切换：如果已忽略则移除，未忽略则添加）
      for (const targetUri of targets) {
        const isIgnored = this.configService.isIgnoredByExtension(targetUri.fsPath);
        await this.configService.modifyIgnoreList(targetUri, isIgnored ? 'remove' : 'add');
        if (isIgnored) removedCount++;
        else addedCount++;
      }

      // 3. 刷新上下文状态
      if (vscode.window.activeTextEditor) {
        this.refreshContext(vscode.window.activeTextEditor.document.uri);
      }

      // 4. 给出明确的操作反馈，用户不需要看菜单名字，看弹窗就知道做了什么
      if (targets.length === 1) {
        const actionMsg = removedCount > 0 ? '已从 QuickOps Git 隔离列表中移除' : '已添加到 QuickOps Git 隔离列表';
        vscode.window.showInformationMessage(`✨ ${actionMsg}`);
      } else {
        vscode.window.showInformationMessage(`✨ 已批量处理 ${targets.length} 个文件`);
      }
    });

    context.subscriptions.push(openSettingsCmd, toggleIgnoreCmd);

    // 3. 监听编辑器变化，更新上下文 (主要用于 Editor Title 按钮的高亮显示等)
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
