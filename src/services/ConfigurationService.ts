import * as vscode from 'vscode';
import * as path from 'path';
import { EventEmitter } from 'events';
import { merge, isString } from 'lodash-es';
import { exec } from 'child_process';
import { promisify } from 'util';
import { TextDecoder, TextEncoder } from 'util';
import { IService } from '../core/interfaces/IService';
import type { ILogrcConfig } from '../core/types/config';
import ColorLog from '../utils/ColorLog';

const execAsync = promisify(exec);

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

  public get workspaceConfigUri(): vscode.Uri | null {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) return null;
    return vscode.Uri.joinPath(workspaceFolders[0].uri, this._configFileName);
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

    ColorLog.orange(`[${this.serviceId}]`, 'Initialized.');
  }

  public async loadConfig(): Promise<void> {
    try {
      const defaultConfig = await this.loadInternalConfig();
      const userConfig = await this.loadUserConfig();

      this._config = merge(defaultConfig, userConfig);

      // 异步执行 Git 同步，不阻塞启动
      this.handleGitConfiguration().catch((e) => console.warn(`[${this.serviceId}] Git sync warning:`, e));

      this._lastConfig = JSON.parse(JSON.stringify(this._config));
      this.emit('configChanged', this._config);
    } catch (error) {
      console.error(`[${this.serviceId}] Error loading config:`, error);
    }
  }

  /**
   * [新增] 通用配置更新方法
   * 用于 Mock Server 等功能模块更新配置并持久化到 .quickopsrc
   * @param section 配置节点 (e.g., 'mock', 'general')
   * @param value 新的配置值
   */
  public async updateConfig<K extends keyof ILogrcConfig>(section: K, value: ILogrcConfig[K]): Promise<void> {
    const configUri = this.workspaceConfigUri;

    // 1. 如果配置文件不存在，询问是否创建
    if (!configUri || !(await this.pathExists(configUri))) {
      const create = await vscode.window.showInformationMessage('配置文件 .quickopsrc 不存在，是否立即创建？', '创建', '取消');
      if (create === '创建') {
        await this.createDefaultConfig();
        // 如果创建失败或仍未找到，直接返回
        if (!this.workspaceConfigUri || !(await this.pathExists(this.workspaceConfigUri))) return;
      } else {
        return;
      }
    }

    // 再次确认 URI 存在（因为 createDefaultConfig 可能会失败）
    const targetUri = this.workspaceConfigUri;
    if (!targetUri) return;

    try {
      // 2. 读取现有配置
      const content = await this.readFile(targetUri);
      let currentConfig: any = {};
      try {
        currentConfig = JSON.parse(content);
      } catch (e) {
        // 如果文件为空或格式错误，尝试保留原内容或重置
        console.warn('Config file parse error, overwriting with new config structure.');
        currentConfig = {};
      }

      // 3. 更新指定节点
      currentConfig[section] = value;

      // 4. 更新内存中的配置 (Watcher 稍后会触发完全重载，这里先更新内存以保证响应速度)
      (this._config as any)[section] = value;

      // 5. 写回文件
      await this.writeFile(targetUri, JSON.stringify(currentConfig, null, 2));

      this.emit('configChanged', this._config);
    } catch (error: any) {
      vscode.window.showErrorMessage(`更新配置失败: ${error.message}`);
      console.error(`[${this.serviceId}] updateConfig error:`, error);
    }
  }

  public async modifyIgnoreList(fileUri: vscode.Uri, type: 'add' | 'remove'): Promise<void> {
    const configUri = this.workspaceConfigUri;

    // 优化：使用 VS Code API 检查文件是否存在
    if (!configUri || !(await this.pathExists(configUri))) {
      vscode.window.showErrorMessage('未找到 .quickopsrc 配置文件，请先创建。');
      return;
    }

    try {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
      if (!workspaceRoot) return;

      const relativePath = path.relative(workspaceRoot, fileUri.fsPath).replace(/\\/g, '/');

      // 优化：使用 VS Code FS 读取
      const content = await this.readFile(configUri);
      const json = JSON.parse(content);

      if (!json.general) json.general = {};
      if (!json.git) json.git = {};
      if (!Array.isArray(json.git.ignoreList)) json.git.ignoreList = [];

      // 清理残留
      if (relativePath === this._configFile || relativePath === this._telemetryFile) {
        json.git.ignoreList = json.git.ignoreList.filter((p: string) => p !== relativePath);
      }

      if (relativePath === this._configFile) {
        json.general.excludeConfigFiles = type === 'add';
      } else if (relativePath === this._telemetryFile) {
        json.general.excludeTelemetryFile = type === 'add';
      } else {
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

      // 优化：使用 VS Code FS 写入
      await this.writeFile(configUri, JSON.stringify(json, null, 2));

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

  private async updateContextKey() {
    const uri = this.workspaceConfigUri;
    let exists = false;
    try {
      exists = !!uri && (await this.pathExists(uri));
    } catch (e) {}
    vscode.commands.executeCommand('setContext', 'quickOps.context.configMissing', !exists);
  }

  private async loadInternalConfig(): Promise<ILogrcConfig> {
    if (this._context) {
      const templateUri = vscode.Uri.joinPath(this._context.extensionUri, this._templateConfigPath);
      if (await this.pathExists(templateUri)) {
        try {
          const content = await this.readFile(templateUri);
          return JSON.parse(content);
        } catch (e) {
          console.error(`[${this.serviceId}] Failed to load template config:`, e);
        }
      }
    }
    return {} as ILogrcConfig;
  }

  private async loadUserConfig(): Promise<Partial<ILogrcConfig>> {
    const uri = this.workspaceConfigUri;
    if (!uri) return {};

    try {
      if (!(await this.pathExists(uri))) return {};
      const content = await this.readFile(uri);
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

    // 防抖逻辑保持不变
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
    const targetUri = this.workspaceConfigUri;
    if (!targetUri) {
      vscode.window.showErrorMessage('Quick Ops: 请先打开一个文件夹。');
      return;
    }

    if (await this.pathExists(targetUri)) {
      const doc = await vscode.workspace.openTextDocument(targetUri);
      await vscode.window.showTextDocument(doc);
      return;
    }

    try {
      let contentToWrite = '{}';
      if (this._context) {
        const templateUri = vscode.Uri.joinPath(this._context.extensionUri, this._templateConfigPath);
        if (await this.pathExists(templateUri)) {
          contentToWrite = await this.readFile(templateUri);
        }
      }

      await this.writeFile(targetUri, contentToWrite);
      vscode.window.showInformationMessage(`已创建 ${this._configFileName}`);

      await this.loadConfig();
      this.updateContextKey();
      const doc = await vscode.workspace.openTextDocument(targetUri);
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

  // === 核心优化：Git 配置同步 ===

  private async handleGitConfiguration() {
    try {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
      if (!workspaceRoot) return;

      const currentFilesToIgnore = new Set<string>();

      this._alwaysIgnoreFiles.forEach((f) => currentFilesToIgnore.add(f));

      if (this._config.general?.excludeConfigFiles) currentFilesToIgnore.add(this._configFile);
      if (this._config.general?.excludeTelemetryFile) currentFilesToIgnore.add(this._telemetryFile);

      if (this._config.git?.ignoreList && Array.isArray(this._config.git.ignoreList)) {
        this._config.git.ignoreList.forEach((f) => currentFilesToIgnore.add(f));
      }

      this._ignoredAbsolutePaths.clear();
      for (const relativePath of currentFilesToIgnore) {
        const absPath = path.join(workspaceRoot, relativePath).replace(/\\/g, '/');
        this._ignoredAbsolutePaths.add(absPath);
      }

      // 计算 diff
      const lastFilesToIgnore = new Set<string>();
      if (this._lastConfig) {
        this._alwaysIgnoreFiles.forEach((f) => lastFilesToIgnore.add(f));
        if (this._lastConfig.general?.excludeConfigFiles) lastFilesToIgnore.add(this._configFile);
        if (this._lastConfig.general?.excludeTelemetryFile) lastFilesToIgnore.add(this._telemetryFile);
        if (this._lastConfig.git?.ignoreList) this._lastConfig.git.ignoreList.forEach((f) => lastFilesToIgnore.add(f));
      }

      const toAdd = [...currentFilesToIgnore].filter((x) => !lastFilesToIgnore.has(x));
      const toRemove = [...lastFilesToIgnore].filter((x) => !currentFilesToIgnore.has(x));

      if (toAdd.length > 0 || toRemove.length > 0) {
        // 优化：传入两个列表，一次性批量处理
        await this.batchProcessIgnoreFiles(toAdd, toRemove, workspaceRoot);
      }
    } catch (e) {
      console.warn(`[${this.serviceId}] Git config sync failed:`, e);
    }
  }

  /**
   * 【核心优化】批量处理 Git 忽略逻辑
   * 1. 批量修改 .git/info/exclude (读写一次文件)
   * 2. 批量执行 git update-index (执行两次命令处理所有文件)
   */
  private async batchProcessIgnoreFiles(filesToAdd: string[], filesToRemove: string[], cwd: string) {
    try {
      // 1. 批量更新 .git/info/exclude
      await this.batchUpdateGitInfoExclude(filesToAdd, filesToRemove, cwd);

      // 2. 批量处理 Tracked 文件的 skip-worktree
      // 只有已被 Git 跟踪的文件才需要设置 skip-worktree，未跟踪的文件由 info/exclude 处理
      if (filesToAdd.length > 0) {
        const trackedToAdd = await this.filterTrackedFiles(filesToAdd, cwd);
        if (trackedToAdd.length > 0) {
          // 将所有文件合并到一个命令中
          await this.runGitUpdateIndex(trackedToAdd, true, cwd);
        }
      }

      if (filesToRemove.length > 0) {
        // 恢复时，尝试恢复所有（即使可能未被设置），或者也先检查一下
        // 为了保险和性能平衡，这里也建议过滤一下，或者直接执行(Git不会报错如果本身没设置)
        // 使用 filterTrackedFiles 更稳妥
        const trackedToRemove = await this.filterTrackedFiles(filesToRemove, cwd);
        if (trackedToRemove.length > 0) {
          await this.runGitUpdateIndex(trackedToRemove, false, cwd);
        }
      }

      const count = filesToAdd.length + filesToRemove.length;
      if (count > 0) {
        ColorLog.green(`[${this.serviceId}]`, `Synced ${count} files to Git config.`);
      }
    } catch (e) {
      console.error(`[${this.serviceId}] Batch process failed:`, e);
    }
  }

  private async batchUpdateGitInfoExclude(toAdd: string[], toRemove: string[], cwd: string) {
    try {
      const gitDir = path.join(cwd, '.git');
      const excludePath = path.join(gitDir, 'info', 'exclude');
      const excludeUri = vscode.Uri.file(excludePath); // 这里必须用 file uri

      // 检查 .git 目录是否存在 (VSCode FS check)
      if (!(await this.pathExists(vscode.Uri.file(gitDir)))) return;

      const infoDir = path.dirname(excludePath);
      const infoDirUri = vscode.Uri.file(infoDir);
      if (!(await this.pathExists(infoDirUri))) {
        await vscode.workspace.fs.createDirectory(infoDirUri);
      }

      let content = '';
      if (await this.pathExists(excludeUri)) {
        content = await this.readFile(excludeUri);
      }

      let lines = content.split(/\r?\n/).filter((line) => line.trim() !== '');
      const originalCount = lines.length;

      // 内存中处理所有增删
      const toRemoveSet = new Set(toRemove.map((p) => p.replace(/\\/g, '/')));

      // 先删
      lines = lines.filter((line) => !toRemoveSet.has(line));

      // 后加
      toAdd.forEach((file) => {
        const normalized = file.replace(/\\/g, '/');
        if (!lines.includes(normalized)) {
          lines.push(normalized);
        }
      });

      if (lines.length !== originalCount || toRemove.length > 0) {
        await this.writeFile(excludeUri, lines.join('\n') + '\n');
      }
    } catch (e) {
      console.warn('Failed to batch update git info/exclude', e);
    }
  }

  /**
   * 过滤出 Git 已跟踪的文件
   * 使用 git ls-files 批量检查
   */
  private async filterTrackedFiles(files: string[], cwd: string): Promise<string[]> {
    if (files.length === 0) return [];
    try {
      // 加上 --error-unmatch 会报错，不加则只输出存在的
      // 注意文件名如果有空格需处理，这里假设文件名简单，或者用 quotes
      const fileArgs = files.map((f) => `"${f}"`).join(' ');
      // 使用 git ls-files 找出其中已被跟踪的文件
      const { stdout } = await execAsync(`git ls-files ${fileArgs}`, { cwd });

      const tracked = new Set(
        stdout
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean),
      );
      // 返回原始列表中在 tracked 集合里的项 (处理路径分隔符可能的不一致)
      return files.filter((f) => {
        const normalized = f.replace(/\\/g, '/');
        // git output usually matches repo root relative
        return tracked.has(normalized) || tracked.has(f);
      });
    } catch (e) {
      return [];
    }
  }

  private async runGitUpdateIndex(files: string[], skip: boolean, cwd: string) {
    try {
      const flag = skip ? '--skip-worktree' : '--no-skip-worktree';
      const fileArgs = files.map((f) => `"${f}"`).join(' ');
      // 批量执行
      await execAsync(`git update-index ${flag} ${fileArgs}`, { cwd });
    } catch (e) {
      console.warn('Git update-index failed', e);
    }
  }

  // === 工具方法：封装 VS Code FS ===

  private async pathExists(uri: vscode.Uri): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(uri);
      return true;
    } catch {
      return false;
    }
  }

  private async readFile(uri: vscode.Uri): Promise<string> {
    const uint8Array = await vscode.workspace.fs.readFile(uri);
    return new TextDecoder('utf-8').decode(uint8Array);
  }

  private async writeFile(uri: vscode.Uri, content: string): Promise<void> {
    const uint8Array = new TextEncoder().encode(content);
    await vscode.workspace.fs.writeFile(uri, uint8Array);
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
