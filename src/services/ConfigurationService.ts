import * as vscode from 'vscode';
import * as path from 'path';
import { EventEmitter } from 'events';
import { IService } from '../core/interfaces/IService';

export class ConfigurationService extends EventEmitter implements IService {
  public readonly serviceId = 'ConfigurationService';
  private static instance: ConfigurationService;
  
  // 🌟 内存缓存，获取配置时直接读内存，速度极快
  public config: any = {};
  private configUri: vscode.Uri | undefined;
  private watcher: vscode.FileSystemWatcher | undefined;

  private constructor() {
    super();
    // 🌟 性能优化：构造函数内绝对不进行任何磁盘读写！
  }

  public static getInstance(): ConfigurationService {
    if (!ConfigurationService.instance) {
      ConfigurationService.instance = new ConfigurationService();
    }
    return ConfigurationService.instance;
  }

  // 🌟 1. 异步初始化阶段
  public async init(context?: vscode.ExtensionContext): Promise<void> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return;

    this.configUri = vscode.Uri.joinPath(folders[0].uri, '.quickopsrc');
    
    // 初始化时异步把配置文件加载到内存
    await this.loadConfig();

    // 使用 VS Code 原生的非阻塞文件监听器
    this.watcher = vscode.workspace.createFileSystemWatcher(this.configUri.fsPath);
    this.watcher.onDidChange(() => this.loadConfig());
    this.watcher.onDidCreate(() => this.loadConfig());
    this.watcher.onDidDelete(() => {
      this.config = {};
      this.emit('configChanged', this.config);
    });
  }

  // 🌟 2. 纯异步读取：使用 Buffer 代替报错的 TextDecoder
  public async loadConfig(): Promise<void> {
    if (!this.configUri) return;
    try {
      const fileData = await vscode.workspace.fs.readFile(this.configUri);
      const content = Buffer.from(fileData).toString('utf-8');
      this.config = JSON.parse(content || '{}');
    } catch (error) {
      // 文件不存在时，重置为空配置
      this.config = {}; 
    }
    this.emit('configChanged', this.config);
  }

  // 🌟 3. 纯异步写入：使用 Buffer 编码
  public async updateConfig(key: string, value: any): Promise<void> {
    if (!this.configUri) return;
    this.config[key] = value;
    try {
      const content = JSON.stringify(this.config, null, 2);
      const fileData = Buffer.from(content, 'utf-8');
      await vscode.workspace.fs.writeFile(this.configUri, fileData);
    } catch (error) {
      vscode.window.showErrorMessage(`配置保存失败: ${error}`);
    }
  }

  public isIgnoredByExtension(filePath: string): boolean {
    const ignores = this.config?.general?.ignores || [];
    const normalizedPath = filePath.replace(/\\/g, '/');
    return ignores.some((ignorePattern: string) => {
      const pattern = ignorePattern.replace(/\/\*\*$/, '');
      return normalizedPath.includes(pattern);
    });
  }

  public async modifyIgnoreList(targetUri: vscode.Uri, action: 'add' | 'remove'): Promise<void> {
    if (!this.configUri) return;
    const rootPath = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
    if (!rootPath) return;

    let relativePath = path.relative(rootPath, targetUri.fsPath).replace(/\\/g, '/');
    
    // 使用异步 stat 判断是否为目录
    try {
      const stat = await vscode.workspace.fs.stat(targetUri);
      if (stat.type === vscode.FileType.Directory) {
        relativePath += '/**';
      }
    } catch (e) {}

    if (!this.config.general) this.config.general = {};
    if (!this.config.general.ignores) this.config.general.ignores = [];

    const ignores: string[] = this.config.general.ignores;

    if (action === 'add' && !ignores.includes(relativePath)) {
      ignores.push(relativePath);
    } else if (action === 'remove') {
      const idx = ignores.indexOf(relativePath);
      if (idx > -1) ignores.splice(idx, 1);
    }

    await this.updateConfig('general', this.config.general);
  }

  public async createDefaultConfig(): Promise<void> {
    if (!this.configUri) {
      vscode.window.showWarningMessage('请先打开一个工作区！');
      return;
    }
    try {
      await vscode.workspace.fs.stat(this.configUri);
      vscode.window.showInformationMessage('.quickopsrc 已存在');
    } catch (e) {
      const defaultConfig = {
        general: { ignores: [] },
        proxy: [],
        mock: []
      };
      const fileData = Buffer.from(JSON.stringify(defaultConfig, null, 2), 'utf-8');
      await vscode.workspace.fs.writeFile(this.configUri, fileData);
      vscode.window.showInformationMessage('✨ .quickopsrc 配置文件已创建！');
    }
  }

  public dispose() {
    if (this.watcher) {
      this.watcher.dispose();
    }
    this.removeAllListeners();
  }
}