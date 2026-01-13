import * as vscode from 'vscode';
import * as path from 'path';
import { IFeature } from '../core/interfaces/IFeature';
import { ConfigurationService } from '../services/ConfigurationService';
import { GitService } from '../services/GitService';

export class GitListenerFeature implements IFeature {
  public readonly id = 'GitListenerFeature';

  constructor(
    private configService: ConfigurationService = ConfigurationService.getInstance(),
    private gitService: GitService = GitService.getInstance()
  ) {}

  public activate(context: vscode.ExtensionContext): void {
    // 初始化时先执行一次（处理刚打开项目时的状态）
    this.handleConfigUpdate();

    // 监听配置文件的变化事件
    this.configService.on('configChanged', () => {
      this.handleConfigUpdate();
    });

    console.log(`[${this.id}] Activated.`);
  }

  private handleConfigUpdate() {
    const config = this.configService.config;
    // 如果没有 git 配置或 ignoreList，传空数组以确保清空之前的设置（如果需要的话）或者跳过
    const ignoreList = config.git?.ignoreList || [];

    // 获取 .logrc 所在的目录，用于解析相对路径
    const configPath = this.configService.workspaceConfigPath;
    const configDir = configPath ? path.dirname(configPath) : (vscode.workspace.workspaceFolders?.[0].uri.fsPath || '');
    console.log(`[${this.id}] Updating Git ignore rules with configDir: ${configDir}`);
    if (configDir) {
      this.gitService.updateIgnoreRules(ignoreList, configDir);
    }
  }
}