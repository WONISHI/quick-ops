import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import { execSync } from 'child_process';
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

  private readonly _configFileName = '.logrc';
  private readonly _templateConfigPath = 'resources/template/logrc-template.json';

  // 默认配置为空对象，完全依赖文件加载
  private _config: ILogrcConfig = {} as ILogrcConfig;
  private _lastConfig: ILogrcConfig | null = null;
  private _watcher: fs.FSWatcher | null = null;
  private _context?: vscode.ExtensionContext;

  // 🔥 分离忽略列表：anchors.json 始终忽略，.logrc 由配置控制
  private readonly _alwaysIgnoreFiles: string[] = ['anchors.json'];
  private readonly _configFile: string = '.logrc';

  private _ignoredByExtension: Set<string> = new Set();

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

  public get configDir(): string | null {
    const configPath = this.workspaceConfigPath;
    return configPath ? path.dirname(configPath) : null;
  }

  public isIgnoredByExtension(filePath: string): boolean {
    const root = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
    if (!root) return false;
    const relative = path.relative(root, filePath).replace(/\\/g, '/');
    return this._ignoredByExtension.has(relative);
  }

  public init(context?: vscode.ExtensionContext): void {
    this._context = context;
    this.loadConfig();
    this.watchConfigFile();
    this.updateContextKey();

    if (context) {
      context.subscriptions.push(vscode.window.registerFileDecorationProvider(new LogrcIgnoreDecorationProvider(this)));
    }

    console.log(`[${this.serviceId}] Initialized.`);
  }

  public loadConfig(): void {
    try {
      const defaultConfig = this.loadInternalConfig();
      const userConfig = this.loadUserConfig();

      this._config = mergeClone(defaultConfig, userConfig);

      // 处理 Git 忽略
      this.handleGitConfiguration();

      this._lastConfig = JSON.parse(JSON.stringify(this._config));
      this.emit('configChanged', this._config);
    } catch (error) {
      console.error(`[${this.serviceId}] Error loading config:`, error);
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

  private loadInternalConfig(): ILogrcConfig {
    if (this._context) {
      const templatePath = path.join(this._context.extensionPath, this._templateConfigPath);
      if (fs.existsSync(templatePath)) {
        try {
          return JSON.parse(fs.readFileSync(templatePath, 'utf-8'));
        } catch (e) {
          console.error(`[${this.serviceId}] Failed to load template config:`, e);
        }
      }
    }
    return {} as ILogrcConfig;
  }

  private loadUserConfig(): Partial<ILogrcConfig> {
    const filePath = this.workspaceConfigPath;
    if (!filePath) return {};

    try {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        if (!content.trim()) return {};
        return JSON.parse(content);
      }
    } catch (error) {
      console.log('err', error);
      return {};
    }
    return {};
  }

  private watchConfigFile() {
    const filePath = this.workspaceConfigPath;
    if (!filePath) return;

    const watchDir = path.dirname(filePath);

    if (this._watcher) {
      this._watcher.close();
      this._watcher = null;
    }

    try {
      if (!fs.existsSync(watchDir)) return;

      this._watcher = fs.watch(watchDir, (eventType, filename) => {
        if (filename === this._configFileName) {
          const timer = setTimeout(() => {
            clearTimeout(timer);
            try {
              this.loadConfig();
              this.updateContextKey();
            } catch (e) {
              console.warn(`[${this.serviceId}] Hot reload failed:`, e);
            }
          }, 300);
        }
      });
    } catch (e) {
      console.warn(`[${this.serviceId}] Watch failed:`, e);
    }
  }

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
        }
      }

      fs.writeFileSync(targetPath, contentToWrite, 'utf-8');
      vscode.window.showInformationMessage(`已创建 ${this._configFileName}`);

      this.loadConfig();
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

  // =====================================================================================
  // 🔥 Git Ignore Logic (Logic Refined)
  // =====================================================================================

  private handleGitConfiguration() {
    try {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
      if (!workspaceRoot) return;

      // === 1. 计算【当前】忽略列表 ===
      const currentFilesToIgnore = new Set<string>();

      // [规则 A]: anchors.json 始终忽略 (本地数据，不应该提交)
      this._alwaysIgnoreFiles.forEach((f) => currentFilesToIgnore.add(f));

      // [规则 B]: .logrc 根据配置开关决定 (excludeConfigFiles 只控制它)
      if (this._config.general?.excludeConfigFiles) {
        currentFilesToIgnore.add(this._configFile);
      }

      // [规则 C]: 用户自定义忽略列表
      if (this._config.git?.ignoreList && Array.isArray(this._config.git.ignoreList)) {
        this._config.git.ignoreList.forEach((f) => currentFilesToIgnore.add(f));
      }

      // === 2. 计算【上次】忽略列表 ===
      const lastFilesToIgnore = new Set<string>();

      // 如果没有 lastConfig (比如刚启动/新建)，我们也假设 anchors.json 是应该被忽略的
      // 这样可以确保初次运行时，anchors.json 会被加入忽略
      if (!this._lastConfig) {
        // 什么都不做，让 toAdd 全量生效
      } else {
        // 还原上次的状态
        this._alwaysIgnoreFiles.forEach((f) => lastFilesToIgnore.add(f));

        if (this._lastConfig.general?.excludeConfigFiles) {
          lastFilesToIgnore.add(this._configFile);
        }
        if (this._lastConfig.git?.ignoreList) {
          this._lastConfig.git.ignoreList.forEach((f) => lastFilesToIgnore.add(f));
        }
      }

      // === 3. Diff ===
      const toAdd = [...currentFilesToIgnore].filter((x) => !lastFilesToIgnore.has(x));
      const toRemove = [...lastFilesToIgnore].filter((x) => !currentFilesToIgnore.has(x));

      this._ignoredByExtension = currentFilesToIgnore;

      if (toAdd.length > 0) {
        this.processIgnoreFiles(toAdd, true, workspaceRoot);
      }

      if (toRemove.length > 0) {
        this.processIgnoreFiles(toRemove, false, workspaceRoot);
      }
    } catch (e) {
      console.warn(`[${this.serviceId}] Git config sync failed:`, e);
    }
  }

  private processIgnoreFiles(files: string[], isIgnoring: boolean, cwd: string) {
    const filesProcessed: string[] = [];

    files.forEach((file) => {
      try {
        if (!fs.existsSync(cwd)) return;

        if (isIgnoring) {
          if (this.isGitIgnored(file, cwd)) return;

          const added = this.updateGitInfoExclude(file, true, cwd);

          if (fs.existsSync(path.join(cwd, file)) && this.isGitTracked(file, cwd)) {
            this.toggleSkipWorktree(file, true, cwd);
          }

          if (added) filesProcessed.push(file);
        } else {
          const removed = this.updateGitInfoExclude(file, false, cwd);

          if (this.isGitTracked(file, cwd)) {
            this.toggleSkipWorktree(file, false, cwd);
          }

          if (removed) filesProcessed.push(file);
        }
      } catch (fileErr) {
        // ignore
      }
    });

    if (filesProcessed.length > 0) {
      const msg = isIgnoring ? `Quick Ops: 已忽略文件 ${filesProcessed.join(', ')} (Git)` : `Quick Ops: 已恢复文件跟踪 ${filesProcessed.join(', ')} (Git)`;
      vscode.window.showInformationMessage(msg);
    }
  }

  private isGitIgnored(filePath: string, cwd: string): boolean {
    try {
      execSync(`git check-ignore "${filePath}"`, { stdio: 'ignore', cwd });
      return true;
    } catch {
      return false;
    }
  }

  private isGitTracked(filePath: string, cwd: string): boolean {
    try {
      execSync(`git ls-files --error-unmatch "${filePath}"`, { stdio: 'ignore', cwd });
      return true;
    } catch (err) {
      return false;
    }
  }

  private updateGitInfoExclude(filePath: string, add: boolean, cwd: string): boolean {
    try {
      const gitDir = path.join(cwd, '.git');
      const excludePath = path.join(gitDir, 'info', 'exclude');

      if (!fs.existsSync(gitDir)) return false;

      const infoDir = path.dirname(excludePath);
      if (!fs.existsSync(infoDir)) {
        fs.mkdirSync(infoDir, { recursive: true });
      }

      let content = '';
      if (fs.existsSync(excludePath)) {
        content = fs.readFileSync(excludePath, 'utf-8');
      }

      let lines = content.split(/\r?\n/).filter((line) => line.trim() !== '');
      const normalizedPath = filePath.replace(/\\/g, '/');

      const exists = lines.includes(normalizedPath);

      if (add) {
        if (!exists) {
          lines.push(normalizedPath);
          fs.writeFileSync(excludePath, lines.join('\n') + '\n', 'utf-8');
          return true;
        }
      } else {
        if (exists) {
          lines = lines.filter((l) => l !== normalizedPath);
          fs.writeFileSync(excludePath, lines.join('\n') + '\n', 'utf-8');
          return true;
        }
      }
    } catch (e) {
      console.warn('Failed to update git info/exclude', e);
    }
    return false;
  }

  private toggleSkipWorktree(filePath: string, skip: boolean, cwd: string) {
    try {
      const flag = skip ? '--skip-worktree' : '--no-skip-worktree';
      execSync(`git update-index ${flag} "${filePath}"`, { stdio: 'ignore', cwd });
    } catch (e) {
      // ignore
    }
  }
}

// Decoration Provider
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
        tooltip: '该文件已被 .logrc 配置忽略',
        color: new vscode.ThemeColor('gitDecoration.ignoredResourceForeground'),
        propagate: false,
      };
    }
    return undefined;
  }
}
