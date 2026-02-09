import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { promises as fsPromises } from 'fs';
import { EventEmitter } from 'events';
import { merge } from 'lodash-es';
import { exec } from 'child_process';
import { promisify } from 'util';
import { IService } from '../core/interfaces/IService';

const execAsync = promisify(exec);

export interface ILogrcConfig {
  general: {
    debug: boolean;
    excludeConfigFiles: boolean;
    excludeTelemetryFile?: boolean; // 新增字段
    anchorViewMode?: 'menu' | 'mindmap';
    mindMapPosition?: 'left' | 'right';
  };
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

  private readonly _configFileName = '.quickopsrc';
  private readonly _templateConfigPath = 'resources/template/.quickopsrc.json';

  private _config: ILogrcConfig = {} as ILogrcConfig;
  private _lastConfig: ILogrcConfig | null = null;
  private _watcher: vscode.FileSystemWatcher | null = null;
  private _context?: vscode.ExtensionContext;

  private readonly _alwaysIgnoreFiles: string[] = [];

  private readonly _configFile: string = '.quickopsrc';
  private readonly _telemetryFile: string = '.telemetryrc';

  private _ignoredAbsolutePaths: Set<string> = new Set();

  private constructor() {
    super();
  }

  public static getInstance(): ConfigurationService {
    if (!this._instance) this._instance = new ConfigurationService();
    return this._instance;
  }

  public get config(): Readonly<ILogrcConfig> {
    return this._config;
  }

  public get workspaceConfigPath(): string | null {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) return null;
    return path.join(workspaceFolders[0].uri.fsPath, this._configFileName);
  }

  public isIgnoredByExtension(filePath: string): boolean {
    const normalized = filePath.replace(/\\/g, '/');
    return this._ignoredAbsolutePaths.has(normalized);
  }

  public init(context?: vscode.ExtensionContext): void {
    this._context = context;
    this.loadConfig().catch((err) => console.error(`[${this.serviceId}] Init load failed:`, err));
    this.setupWatcher();
    this.updateContextKey();

    if (context) {
      context.subscriptions.push(vscode.window.registerFileDecorationProvider(new LogrcIgnoreDecorationProvider(this)));
    }

    console.log(`[${this.serviceId}] Initialized.`);
  }

  public async loadConfig(): Promise<void> {
    try {
      const defaultConfig = await this.loadInternalConfig();
      const userConfig = await this.loadUserConfig();

      this._config = merge(defaultConfig, userConfig);

      this.handleGitConfiguration().catch((e) => console.warn(`[${this.serviceId}] Git sync warning:`, e));

      this._lastConfig = JSON.parse(JSON.stringify(this._config));
      this.emit('configChanged', this._config);
    } catch (error) {
      console.error(`[${this.serviceId}] Error loading config:`, error);
    }
  }

  public async modifyIgnoreList(fileUri: vscode.Uri, type: 'add' | 'remove'): Promise<void> {
    const configPath = this.workspaceConfigPath;
    if (!configPath || !fs.existsSync(configPath)) {
      vscode.window.showErrorMessage('未找到 .quickopsrc 配置文件，请先创建。');
      return;
    }

    try {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
      if (!workspaceRoot) return;

      const relativePath = path.relative(workspaceRoot, fileUri.fsPath).replace(/\\/g, '/');
      const content = await fsPromises.readFile(configPath, 'utf-8');
      const json = JSON.parse(content);

      // 初始化对象结构，防止报错
      if (!json.general) json.general = {};
      if (!json.git) json.git = {};
      if (!Array.isArray(json.git.ignoreList)) json.git.ignoreList = [];

      // === 核心修复：清理残留 ===
      // 无论操作类型是什么，先从 git.ignoreList 数组中移除该文件
      // 防止文件既被 excludeTelemetryFile 控制，又在 ignoreList 数组中，导致死循环
      if (relativePath === this._configFile || relativePath === this._telemetryFile) {
        json.git.ignoreList = json.git.ignoreList.filter((p: string) => p !== relativePath);
      }

      // === 分支处理逻辑 ===
      if (relativePath === this._configFile) {
        // .quickopsrc -> 改 excludeConfigFiles
        json.general.excludeConfigFiles = type === 'add';
      } else if (relativePath === this._telemetryFile) {
        // .telemetryrc -> 改 excludeTelemetryFile
        json.general.excludeTelemetryFile = type === 'add';
      } else {
        // 普通文件 -> 操作 git.ignoreList
        if (type === 'add') {
          if (!json.git.ignoreList.includes(relativePath)) {
            json.git.ignoreList.push(relativePath);
          } else {
            return;
          }
        } else {
          json.git.ignoreList = json.git.ignoreList.filter((p: string) => p !== relativePath);
        }
      }

      await fsPromises.writeFile(configPath, JSON.stringify(json, null, 2), 'utf-8');

      // === 立即更新内存状态 ===
      const absPath = fileUri.fsPath.replace(/\\/g, '/');
      if (type === 'add') {
        this._ignoredAbsolutePaths.add(absPath);
      } else {
        this._ignoredAbsolutePaths.delete(absPath);
      }
      this.emit('configChanged', this._config);
    } catch (e: any) {
      vscode.window.showErrorMessage(`更新配置文件失败: ${e.message}`);
    }
  }

  private updateContextKey() {
    const filePath = this.workspaceConfigPath;
    let exists = false;
    try {
      exists = !!filePath && fs.existsSync(filePath);
    } catch (e) {}

    vscode.commands.executeCommand('setContext', 'quickOps.context.configMissing', !exists);
  }

  private async loadInternalConfig(): Promise<ILogrcConfig> {
    if (this._context) {
      const templatePath = path.join(this._context.extensionPath, this._templateConfigPath);
      if (fs.existsSync(templatePath)) {
        try {
          const content = await fsPromises.readFile(templatePath, 'utf-8');
          return JSON.parse(content);
        } catch (e) {
          console.error(`[${this.serviceId}] Failed to load template config:`, e);
        }
      }
    }
    return {} as ILogrcConfig;
  }

  private async loadUserConfig(): Promise<Partial<ILogrcConfig>> {
    const filePath = this.workspaceConfigPath;
    if (!filePath) return {};

    try {
      const content = await fsPromises.readFile(filePath, 'utf-8');
      if (!content.trim()) return {};
      return JSON.parse(content);
    } catch (error) {
      return {};
    }
  }

  private setupWatcher() {
    if (this._watcher) {
      this._watcher.dispose();
    }

    const pattern = new vscode.RelativePattern(vscode.workspace.workspaceFolders?.[0] || '', this._configFileName);

    this._watcher = vscode.workspace.createFileSystemWatcher(pattern);

    let debounceTimer: NodeJS.Timeout;
    const reload = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        this.loadConfig();
        this.updateContextKey();
      }, 300);
    };

    this._watcher.onDidChange(reload);
    this._watcher.onDidCreate(reload);
    this._watcher.onDidDelete(reload);

    if (this._context) {
      this._context.subscriptions.push(this._watcher);
    }
  }

  public async createDefaultConfig(): Promise<void> {
    const targetPath = this.workspaceConfigPath;
    if (!targetPath) {
      vscode.window.showErrorMessage('Quick Ops: 请先打开一个文件夹。');
      return;
    }

    if (fs.existsSync(targetPath)) {
      const doc = await vscode.workspace.openTextDocument(targetPath);
      await vscode.window.showTextDocument(doc);
      return;
    }

    try {
      let contentToWrite = '{}';
      if (this._context) {
        const templatePath = path.join(this._context.extensionPath, this._templateConfigPath);
        if (fs.existsSync(templatePath)) {
          contentToWrite = await fsPromises.readFile(templatePath, 'utf-8');
        }
      }

      await fsPromises.writeFile(targetPath, contentToWrite, 'utf-8');
      vscode.window.showInformationMessage(`已创建 ${this._configFileName}`);

      await this.loadConfig();
      this.updateContextKey();
      const doc = await vscode.workspace.openTextDocument(targetPath);
      await vscode.window.showTextDocument(doc);
    } catch (error: any) {
      vscode.window.showErrorMessage(`创建配置文件失败: ${error.message}`);
    }
  }

  public dispose(): void {
    if (this._watcher) {
      this._watcher.dispose();
    }
    this.removeAllListeners();
  }

  private async handleGitConfiguration() {
    try {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
      if (!workspaceRoot) return;

      const currentFilesToIgnore = new Set<string>();

      // 1. _alwaysIgnoreFiles 现在为空，不会强制添加
      this._alwaysIgnoreFiles.forEach((f) => currentFilesToIgnore.add(f));

      // 2. 检查 .quickopsrc 开关
      if (this._config.general?.excludeConfigFiles) {
        currentFilesToIgnore.add(this._configFile);
      }
      // 3. 检查 .telemetryrc 开关
      if (this._config.general?.excludeTelemetryFile) {
        currentFilesToIgnore.add(this._telemetryFile);
      }

      // 4. 添加 ignoreList 数组中的文件
      if (this._config.git?.ignoreList && Array.isArray(this._config.git.ignoreList)) {
        this._config.git.ignoreList.forEach((f) => currentFilesToIgnore.add(f));
      }

      this._ignoredAbsolutePaths.clear();
      for (const relativePath of currentFilesToIgnore) {
        const absPath = path.join(workspaceRoot, relativePath).replace(/\\/g, '/');
        this._ignoredAbsolutePaths.add(absPath);
      }

      const lastFilesToIgnore = new Set<string>();
      if (this._lastConfig) {
        this._alwaysIgnoreFiles.forEach((f) => lastFilesToIgnore.add(f));
        if (this._lastConfig.general?.excludeConfigFiles) lastFilesToIgnore.add(this._configFile);
        if (this._lastConfig.general?.excludeTelemetryFile) lastFilesToIgnore.add(this._telemetryFile);

        if (this._lastConfig.git?.ignoreList) this._lastConfig.git.ignoreList.forEach((f) => lastFilesToIgnore.add(f));
      }

      const toAdd = [...currentFilesToIgnore].filter((x) => !lastFilesToIgnore.has(x));
      const toRemove = [...lastFilesToIgnore].filter((x) => !currentFilesToIgnore.has(x));

      if (toAdd.length > 0) {
        await this.processIgnoreFiles(toAdd, true, workspaceRoot);
      }

      if (toRemove.length > 0) {
        await this.processIgnoreFiles(toRemove, false, workspaceRoot);
      }
    } catch (e) {
      console.warn(`[${this.serviceId}] Git config sync failed:`, e);
    }
  }

  private async processIgnoreFiles(files: string[], isIgnoring: boolean, cwd: string) {
    const filesProcessed: string[] = [];

    for (const file of files) {
      try {
        if (isIgnoring) {
          if (await this.isGitIgnored(file, cwd)) continue;

          const added = await this.updateGitInfoExclude(file, true, cwd);

          const fullPath = path.join(cwd, file);
          if (fs.existsSync(fullPath) && (await this.isGitTracked(file, cwd))) {
            await this.toggleSkipWorktree(file, true, cwd);
          }

          if (added) filesProcessed.push(file);
        } else {
          const removed = await this.updateGitInfoExclude(file, false, cwd);

          if (await this.isGitTracked(file, cwd)) {
            await this.toggleSkipWorktree(file, false, cwd);
          }

          if (removed) filesProcessed.push(file);
        }
      } catch (fileErr) {
        // ignore
      }
    }

    if (filesProcessed.length > 0) {
      const msg = isIgnoring ? `Quick Ops: 已忽略文件 ${filesProcessed.join(', ')} (Git)` : `Quick Ops: 已恢复文件跟踪 ${filesProcessed.join(', ')} (Git)`;
      vscode.window.showInformationMessage(msg);
    }
  }

  private async isGitIgnored(filePath: string, cwd: string): Promise<boolean> {
    try {
      await execAsync(`git check-ignore "${filePath}"`, { cwd });
      return true;
    } catch {
      return false;
    }
  }

  private async isGitTracked(filePath: string, cwd: string): Promise<boolean> {
    try {
      await execAsync(`git ls-files --error-unmatch "${filePath}"`, { cwd });
      return true;
    } catch {
      return false;
    }
  }

  private async toggleSkipWorktree(filePath: string, skip: boolean, cwd: string) {
    try {
      const flag = skip ? '--skip-worktree' : '--no-skip-worktree';
      await execAsync(`git update-index ${flag} "${filePath}"`, { cwd });
    } catch (e) {
      console.log(e);
    }
  }

  private async updateGitInfoExclude(filePath: string, add: boolean, cwd: string): Promise<boolean> {
    try {
      const gitDir = path.join(cwd, '.git');
      const excludePath = path.join(gitDir, 'info', 'exclude');

      if (!fs.existsSync(gitDir)) return false;

      const infoDir = path.dirname(excludePath);
      if (!fs.existsSync(infoDir)) {
        await fsPromises.mkdir(infoDir, { recursive: true });
      }

      let content = '';
      if (fs.existsSync(excludePath)) {
        content = await fsPromises.readFile(excludePath, 'utf-8');
      }

      let lines = content.split(/\r?\n/).filter((line) => line.trim() !== '');
      const normalizedPath = filePath.replace(/\\/g, '/');
      const exists = lines.includes(normalizedPath);

      if (add) {
        if (!exists) {
          lines.push(normalizedPath);
          await fsPromises.writeFile(excludePath, lines.join('\n') + '\n', 'utf-8');
          return true;
        }
      } else {
        if (exists) {
          lines = lines.filter((l) => l !== normalizedPath);
          await fsPromises.writeFile(excludePath, lines.join('\n') + '\n', 'utf-8');
          return true;
        }
      }
    } catch (e) {
      console.warn('Failed to update git info/exclude', e);
    }
    return false;
  }
}

class LogrcIgnoreDecorationProvider implements vscode.FileDecorationProvider {
  private _onDidChangeFileDecorations = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
  public readonly onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;

  constructor(private configService: ConfigurationService) {
    this.configService.on('configChanged', () => {
      this._onDidChangeFileDecorations.fire(undefined);
    });
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (this.configService.isIgnoredByExtension(uri.fsPath)) {
      return {
        badge: 'IG',
        tooltip: '该文件已被 .quickopsrc 配置忽略',
        color: new vscode.ThemeColor('gitDecoration.ignoredResourceForeground'),
        propagate: false,
      };
    }
    return undefined;
  }
}
