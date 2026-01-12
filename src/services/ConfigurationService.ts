import * as vscode from 'vscode';
import { EventEmitter } from 'events';
import { IService } from '../core/interfaces/IService';

// 定义配置的类型结构
export interface IAppConfig {
  ignoreList: string[];
  devMode: boolean;
  gitEnabled: boolean;
  // 根据 package.json 中的 configuration 添加更多字段
}

export class ConfigurationService extends EventEmitter implements IService {
  public readonly serviceId = 'ConfigurationService';
  private static _instance: ConfigurationService;
  private _config: IAppConfig;

  private constructor() {
    super();
    this._config = this.loadConfig();
  }

  public static getInstance(): ConfigurationService {
    if (!this._instance) {
      this._instance = new ConfigurationService();
    }
    return this._instance;
  }

  public init(): void {
    this.watchConfigurationChanges();
    console.log(`[${this.serviceId}] Initialized.`);
  }

  /** 获取当前只读配置 */
  public get config(): Readonly<IAppConfig> {
    return this._config;
  }

  /** 从 VS Code 工作区加载配置 */
  private loadConfig(): IAppConfig {
    const config = vscode.workspace.getConfiguration('quickOps');
    return {
      ignoreList: config.get<string[]>('ignore', []),
      devMode: config.get<boolean>('dev', false),
      gitEnabled: config.get<boolean>('git.enabled', true),
    };
  }

  /** 监听配置文件的变化 */
  private watchConfigurationChanges() {
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('quickOps')) {
        const oldConfig = this._config;
        this._config = this.loadConfig();
        // 触发事件通知其他服务或功能
        this.emit('configChanged', { old: oldConfig, new: this._config });
        console.log(`[${this.serviceId}] Configuration updated.`);
      }
    });
  }
}
