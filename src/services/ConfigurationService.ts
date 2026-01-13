import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import { IService } from '../core/interfaces/IService';
import mergeClone from '../utils/mergeClone';

// 完整的配置接口定义
export interface ILogrcConfig {
  general: { debug: boolean; excludeConfigFiles: boolean };
  logger: { template: string; dateFormat: string };
  utils: { uuidLength: number };
  mock: { port: number; asyncMode: boolean; workerCount: number };
  git: { ignoreList: string[] };
  project: { alias: Record<string, string>; marks: Record<string, any> };
  [key: string]: any;
}

export class ConfigurationService extends EventEmitter implements IService {
  public readonly serviceId = 'ConfigurationService';
  private static _instance: ConfigurationService;

  // 配置文件名常量
  private readonly _configFileName = '.logrc';
  private readonly _templateConfigPath = 'resources/template/logrc-template.json';

  // 内部状态
  private _config: ILogrcConfig = {} as ILogrcConfig;
  private _watcher: fs.FSWatcher | null = null;
  private _context?: vscode.ExtensionContext;

  private constructor() {
    super();
  }

  public static getInstance(): ConfigurationService {
    if (!this._instance) this._instance = new ConfigurationService();
    return this._instance;
  }

  // 获取当前内存中的配置对象
  public get config(): Readonly<ILogrcConfig> {
    return this._config;
  }

  // 获取当前工作区 .logrc 文件的绝对路径
  public get workspaceConfigPath(): string | null {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) return null;
    return path.join(workspaceFolders[0].uri.fsPath, this._configFileName);
  }

  // 获取配置文件所在的目录（用于解析相对路径）
  public get configDir(): string | null {
    const configPath = this.workspaceConfigPath;
    return configPath ? path.dirname(configPath) : null;
  }

  public init(context?: vscode.ExtensionContext): void {
    this._context = context;
    this.loadConfig();
    this.watchConfigFile();

    // 初始化时立即更新上下文状态 (控制按钮显示/隐藏)
    this.updateContextKey();
    console.log(`[${this.serviceId}] Initialized.`);
  }

  /**
   * 加载配置：合并 默认配置 + 用户配置
   */
  public loadConfig(): void {
    const defaultConfig = this.loadInternalConfig();
    const userConfig = this.loadUserConfig();

    //通过深拷贝合并
    this._config = mergeClone(defaultConfig, userConfig);

    // 发射事件，通知外部（如 GitListenerFeature）配置已变更
    this.emit('configChanged', this._config);
  }

  /**
   * 设置 VS Code 上下文 'quickOps.context.configMissing'
   * 用于控制 package.json 中菜单项的显示与隐藏
   */
  private updateContextKey() {
    const filePath = this.workspaceConfigPath;
    const isNotFound = !filePath || !fs.existsSync(filePath);

    vscode.commands.executeCommand('setContext', 'quickOps.context.configMissing', isNotFound);
  }

  /**
   * 加载扩展内置的默认配置（兜底）
   */
  private loadInternalConfig(): ILogrcConfig {
    if (!this._context) return {} as ILogrcConfig;
    const internalPath = path.join(this._context.extensionPath, this._configFileName);

    if (fs.existsSync(internalPath)) {
      try {
        return JSON.parse(fs.readFileSync(internalPath, 'utf-8'));
      } catch (e) {
        console.error(`[${this.serviceId}] Failed to load internal config:`, e);
      }
    }
    return {} as ILogrcConfig;
  }

  /**
   * 加载用户工作区下的 .logrc 配置
   */
  private loadUserConfig(): Partial<ILogrcConfig> {
    const filePath = this.workspaceConfigPath;
    if (!filePath || !fs.existsSync(filePath)) return {};

    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch (error) {
      console.warn(`[${this.serviceId}] Failed to parse user config:`, error);
      return {};
    }
  }

  /**
   * 监听 .logrc 文件变化
   */
  private watchConfigFile() {
    const filePath = this.workspaceConfigPath;
    if (!filePath) return;

    // 如果文件不存在，监听目录以便文件创建时能感知
    const watchTarget = fs.existsSync(filePath) ? filePath : path.dirname(filePath);

    if (this._watcher) {
      this._watcher.close();
      this._watcher = null;
    }

    try {
      this._watcher = fs.watch(watchTarget, (eventType, filename) => {
        if (filename === this._configFileName || (filename && path.basename(filePath) === filename)) {
          // 稍微延迟，防止读到空文件
          let timer: NodeJS.Timeout = setTimeout(() => {
            if (timer) clearTimeout(timer);
            this.loadConfig();
          }, 100);

          // 文件可能被删除或新建，更新上下文
          this.updateContextKey();
        }
      });
    } catch (e) {
      console.warn(`[${this.serviceId}] Watch failed:`, e);
    }
  }

  /**
   * 创建默认配置文件（供命令调用）
   */
  public createDefaultConfig(): void {
    const targetPath = this.workspaceConfigPath;
    if (!targetPath) {
      vscode.window.showErrorMessage('Quick Ops: 请先打开一个文件夹。');
      return;
    }
    if (fs.existsSync(targetPath)) return;

    try {
      let contentToWrite = '{}';
      if (this._context) {
        const templatePath = path.join(this._context.extensionPath, this._templateConfigPath);
        if (fs.existsSync(templatePath)) {
          contentToWrite = fs.readFileSync(templatePath, 'utf-8');
        } else {
          // 如果找不到模板文件，使用当前内存中的默认配置
          contentToWrite = JSON.stringify(this._config, null, 2);
        }
      }
      fs.writeFileSync(targetPath, contentToWrite, 'utf-8');
      vscode.window.showInformationMessage(`已创建 ${this._configFileName}`);

      // 重新加载并建立监听
      this.loadConfig();
      this.watchConfigFile();
      this.updateContextKey();
    } catch (error: any) {
      vscode.window.showErrorMessage(`创建配置文件失败: ${error.message}`);
    }
  }

  public dispose(): void {
    if (this._watcher) {
      this._watcher.close();
      this._watcher = null;
    }
    this.removeAllListeners();
  }
}
