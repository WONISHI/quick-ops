import * as vscode from 'vscode';
import * as path from 'path';
import { EventEmitter } from 'events';
import { merge } from 'lodash-es';
import { exec } from 'child_process';
import { promisify } from 'util';
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

  public async init(context?: vscode.ExtensionContext): Promise<void> {
    this._context = context;

    if (context) {
      const cachedConfig = context.workspaceState.get<ILogrcConfig>('quickops.config.cache');
      if (cachedConfig) {
        this._config = cachedConfig;
        this._lastConfig = JSON.parse(JSON.stringify(this._config));
        this.emit('configChanged', this._config);
        ColorLog.green(`[${this.serviceId}]`, 'Loaded from Workspace Cache instantly.');
      }
    }

    // 2. 后台静默读取真实配置并覆盖，成功后由 loadConfig 更新缓存以备下次秒开
    this.loadConfig().catch((err) => console.error(`[${this.serviceId}] Init load failed:`, err));

    this.setupWatcher();
    this.updateContextKey();

    if (context) {
      context.subscriptions.push(vscode.window.registerFileDecorationProvider(new LogrcIgnoreDecorationProvider(this)));
    }
  }

  public async loadConfig(): Promise<void> {
    try {
      const defaultConfig = await this.loadInternalConfig();
      const userConfig = await this.loadUserConfig();

      this._config = merge(defaultConfig, userConfig);

      this.handleGitConfiguration().catch((e) => console.warn(`[${this.serviceId}] Git sync warning:`, e));

      this._lastConfig = JSON.parse(JSON.stringify(this._config));
      this.emit('configChanged', this._config);

      // 🌟 成功读取最新配置后，同步更新到本地缓存
      if (this._context) {
        this._context.workspaceState.update('quickops.config.cache', this._config);
      }
    } catch (error) {
      console.error(`[${this.serviceId}] Error loading config:`, error);
    }
  }

  public async updateConfig<K extends keyof ILogrcConfig>(section: K, value: ILogrcConfig[K]): Promise<void> {
    const configUri = this.workspaceConfigUri;

    if (!configUri || !(await this.pathExists(configUri))) {
      const create = await vscode.window.showInformationMessage('配置文件 .quickopsrc 不存在，是否立即创建？', '创建', '取消');
      if (create === '创建') {
        await this.createDefaultConfig();
        if (!this.workspaceConfigUri || !(await this.pathExists(this.workspaceConfigUri))) return;
      } else {
        return;
      }
    }

    const targetUri = this.workspaceConfigUri;
    if (!targetUri) return;

    try {
      const content = await this.readFile(targetUri);
      let currentConfig: any = {};
      try {
        currentConfig = JSON.parse(content);
      } catch (e) {
        console.warn('Config file parse error, overwriting with new config structure.');
        currentConfig = {};
      }

      currentConfig[section] = value;
      (this._config as any)[section] = value;

      await this.writeFile(targetUri, JSON.stringify(currentConfig, null, 2));

      this.emit('configChanged', this._config);

      if (this._context) {
        this._context.workspaceState.update('quickops.config.cache', this._config);
      }
    } catch (error: any) {
      vscode.window.showErrorMessage(`更新配置失败: ${error.message}`);
      console.error(`[${this.serviceId}] updateConfig error:`, error);
    }
  }

  public async modifyIgnoreList(fileUri: vscode.Uri, type: 'add' | 'remove'): Promise<void> {
    const configUri = this.workspaceConfigUri;

    if (!configUri || !(await this.pathExists(configUri))) {
      vscode.window.showErrorMessage('未找到 .quickopsrc 配置文件，请先创建。');
      return;
    }

    try {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
      if (!workspaceRoot) return;

      let relativePath = path.relative(workspaceRoot, fileUri.fsPath).replace(/\\/g, '/');

      try {
        const stat = await vscode.workspace.fs.stat(fileUri);
        if (stat.type === vscode.FileType.Directory) {
          relativePath += '/**';
        }
      } catch (e) {}

      const content = await this.readFile(configUri);
      const json = JSON.parse(content);

      if (!json.general) json.general = {};
      if (!json.git) json.git = {};
      if (!Array.isArray(json.git.ignoreList)) json.git.ignoreList = [];

      if (relativePath === this._configFile) {
        json.git.ignoreList = json.git.ignoreList.filter((p: string) => p !== relativePath);
        json.general.excludeConfigFiles = type === 'add';
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

      await this.writeFile(configUri, JSON.stringify(json, null, 2));

      const absPath = fileUri.fsPath.replace(/\\/g, '/');
      if (type === 'add') {
        this._ignoredAbsolutePaths.add(absPath);
      } else {
        this._ignoredAbsolutePaths.delete(absPath);
      }
      this.emit('configChanged', this._config);
      if (this._context) this._context.workspaceState.update('quickops.config.cache', this._config);
    } catch (e: any) {
      vscode.window.showErrorMessage(`更新配置文件失败: ${e.message}`);
    }
  }

  public async updateContextKey() {
    const uri = this.workspaceConfigUri;
    let exists = false;
    try {
      exists = !!uri && (await this.pathExists(uri));
    } catch (e) {}
    vscode.commands.executeCommand('setContext', 'quickOps.context.configState', exists ? 'exists' : 'missing');
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

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) return;

    const pattern = new vscode.RelativePattern(workspaceFolder, this._configFileName);
    this._watcher = vscode.workspace.createFileSystemWatcher(pattern);

    const syncUIContextInstant = () => {
      this.updateContextKey();
    };

    let debounceTimer: NodeJS.Timeout;
    const reloadDataDebounced = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        this.loadConfig();
      }, 300);
    };

    this._watcher.onDidChange(() => {
      syncUIContextInstant();
      reloadDataDebounced();
    });
    this._watcher.onDidCreate(() => {
      syncUIContextInstant();
      reloadDataDebounced();
    });
    this._watcher.onDidDelete(() => {
      syncUIContextInstant();
      reloadDataDebounced();
    });

    if (this._context) {
      this._context.subscriptions.push(this._watcher);

      this._context.subscriptions.push(
        vscode.workspace.onDidDeleteFiles((e) => {
          if (e.files.some((f) => path.basename(f.fsPath) === this._configFileName)) {
            syncUIContextInstant();
            reloadDataDebounced();
          }
        }),
        vscode.workspace.onDidCreateFiles((e) => {
          if (e.files.some((f) => path.basename(f.fsPath) === this._configFileName)) {
            syncUIContextInstant();
            reloadDataDebounced();
          }
        }),
      );
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
      vscode.window.showInformationMessage(`✨ 已创建 ${this._configFileName}`);

      await this.updateContextKey();
      await this.loadConfig();

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

  private async handleGitConfiguration() {
    try {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
      if (!workspaceRoot) return;

      const currentFilesToIgnore = new Set<string>();

      this._alwaysIgnoreFiles.forEach((f) => currentFilesToIgnore.add(f));

      if (this._config.general?.excludeConfigFiles) currentFilesToIgnore.add(this._configFile);

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
        if (this._lastConfig.git?.ignoreList) this._lastConfig.git.ignoreList.forEach((f) => lastFilesToIgnore.add(f));
      }

      const toAdd = [...currentFilesToIgnore].filter((x) => !lastFilesToIgnore.has(x));
      const toRemove = [...lastFilesToIgnore].filter((x) => !currentFilesToIgnore.has(x));

      if (toAdd.length > 0 || toRemove.length > 0) {
        await this.batchProcessIgnoreFiles(toAdd, toRemove, workspaceRoot);
      }
    } catch (e) {
      console.warn(`[${this.serviceId}] Git config sync failed:`, e);
    }
  }

  private async batchProcessIgnoreFiles(filesToAdd: string[], filesToRemove: string[], cwd: string) {
    try {
      await this.batchUpdateGitInfoExclude(filesToAdd, filesToRemove, cwd);

      if (filesToAdd.length > 0) {
        const trackedToAdd = await this.filterTrackedFiles(filesToAdd, cwd);
        if (trackedToAdd.length > 0) {
          await this.runGitUpdateIndex(trackedToAdd, true, cwd);
        }
      }

      if (filesToRemove.length > 0) {
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
      const excludeUri = vscode.Uri.file(excludePath);

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

      const toRemoveSet = new Set(toRemove.map((p) => p.replace(/\\/g, '/')));

      lines = lines.filter((line) => !toRemoveSet.has(line));

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

  private async filterTrackedFiles(files: string[], cwd: string): Promise<string[]> {
    if (files.length === 0) return [];
    try {
      const fileArgs = files.map((f) => `"${f}"`).join(' ');
      const { stdout } = await execAsync(`git ls-files ${fileArgs}`, { cwd });

      const tracked = new Set(
        stdout
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean),
      );
      return files.filter((f) => {
        const normalized = f.replace(/\\/g, '/');
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
      await execAsync(`git update-index ${flag} ${fileArgs}`, { cwd });
    } catch (e) {
      console.warn('Git update-index failed', e);
    }
  }

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
    return Buffer.from(uint8Array).toString('utf-8');
  }

  private async writeFile(uri: vscode.Uri, content: string): Promise<void> {
    const uint8Array = Buffer.from(content, 'utf-8');
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
        tooltip: '该文件已被 QuickOps Git隔离 功能忽略',
        color: new vscode.ThemeColor('gitDecoration.ignoredResourceForeground'),
        propagate: false,
      };
    }
    return undefined;
  }
}
