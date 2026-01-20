import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import { execSync } from 'child_process'; // 引入 execSync
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
  private _lastConfig: ILogrcConfig | null = null; // 用于对比变化
  private _watcher: fs.FSWatcher | null = null;
  private _context?: vscode.ExtensionContext;
  // 默认需要忽略的文件列表
  private _defaultIgnoreFiles: string[] = ['.logrc', 'anchors.json'];
  // 记录当前被本插件忽略的文件，用于提供 UI 装饰器
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

  // 对外暴露获取忽略状态的方法，供 DecorationProvider 使用
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

    // 注册文件装饰器 (实现截图2的效果)
    if (context) {
      context.subscriptions.push(vscode.window.registerFileDecorationProvider(new LogrcIgnoreDecorationProvider(this)));
    }

    console.log(`[${this.serviceId}] Initialized.`);
  }

  public loadConfig(): void {
    const defaultConfig = this.loadInternalConfig();
    const userConfig = this.loadUserConfig();
    this._config = mergeClone(defaultConfig, userConfig);

    // 🔥 核心：处理 Git 忽略逻辑
    this.handleGitConfiguration();

    // 更新最后一次配置快照
    this._lastConfig = JSON.parse(JSON.stringify(this._config));

    this.emit('configChanged', this._config);
  }

  private updateContextKey() {
    const filePath = this.workspaceConfigPath;
    const isNotFound = !filePath || !fs.existsSync(filePath);
    vscode.commands.executeCommand('setContext', 'quickOps.context.configMissing', isNotFound);
  }

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

  private watchConfigFile() {
    const filePath = this.workspaceConfigPath;
    if (!filePath) return;
    const watchTarget = fs.existsSync(filePath) ? filePath : path.dirname(filePath);

    if (this._watcher) {
      this._watcher.close();
      this._watcher = null;
    }

    try {
      this._watcher = fs.watch(watchTarget, (eventType, filename) => {
        if (filename === this._configFileName || (filename && path.basename(filePath) === filename)) {
          let timer: NodeJS.Timeout = setTimeout(() => {
            if (timer) clearTimeout(timer);
            this.loadConfig();
          }, 100);
          this.updateContextKey();
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
        } else {
          contentToWrite = JSON.stringify(this._config, null, 2);
        }
      }
      fs.writeFileSync(targetPath, contentToWrite, 'utf-8');
      vscode.window.showInformationMessage(`已创建 ${this._configFileName}`);

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

  // =====================================================================================
  // 🔥 Git Ignore Logic Start
  // =====================================================================================

  /**
   * 处理 Git 忽略配置的主逻辑
   */
  private handleGitConfiguration() {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
    if (!workspaceRoot) return;

    // 1. 计算当前应该忽略的所有文件列表
    const currentFilesToIgnore = new Set<string>();

    // 1.1 如果 general.excludeConfigFiles 为 true，添加默认文件
    if (this._config.general?.excludeConfigFiles) {
      this._defaultIgnoreFiles.forEach((f) => currentFilesToIgnore.add(f));
    }

    // 1.2 添加 git.ignoreList 中的自定义文件
    if (this._config.git?.ignoreList && Array.isArray(this._config.git.ignoreList)) {
      this._config.git.ignoreList.forEach((f) => currentFilesToIgnore.add(f));
    }

    // 2. 计算上一次的文件列表（用于检测移除的文件）
    const lastFilesToIgnore = new Set<string>();
    if (this._lastConfig) {
      if (this._lastConfig.general?.excludeConfigFiles) {
        this._defaultIgnoreFiles.forEach((f) => lastFilesToIgnore.add(f));
      }
      if (this._lastConfig.git?.ignoreList) {
        this._lastConfig.git.ignoreList.forEach((f) => lastFilesToIgnore.add(f));
      }
    }

    // 3. 计算差异
    // 需要新增忽略的
    const toAdd = [...currentFilesToIgnore].filter((x) => !lastFilesToIgnore.has(x));
    // 需要取消忽略的（恢复跟踪）
    const toRemove = [...lastFilesToIgnore].filter((x) => !currentFilesToIgnore.has(x));

    // 更新内部状态用于装饰器
    this._ignoredByExtension = currentFilesToIgnore;
    // 触发装饰器更新事件
    if (toAdd.length > 0 || toRemove.length > 0) {
      // 稍微hack一下，触发所有装饰器更新
      // 实际开发中应该 fire 特定的 uri，这里简化处理
    }

    // 4. 执行操作
    if (toAdd.length > 0) {
      this.processIgnoreFiles(toAdd, true, workspaceRoot);
    }

    if (toRemove.length > 0) {
      this.processIgnoreFiles(toRemove, false, workspaceRoot);
    }
  }

  /**
   * 执行忽略或取消忽略的核心流程
   * @param files 文件列表
   * @param isIgnoring true=忽略, false=取消忽略
   */
  private processIgnoreFiles(files: string[], isIgnoring: boolean, cwd: string) {
    const filesProcessed: string[] = [];

    files.forEach((file) => {
      // 如果文件不存在，跳过
      if (!fs.existsSync(path.join(cwd, file))) return;

      if (isIgnoring) {
        // === 忽略流程 ===

        // 1. 检查是否已被 .gitignore 包含
        if (this.isGitIgnored(file, cwd)) {
          // 已被 .gitignore 处理，无需操作
          return;
        }

        // 2. 添加到 .git/info/exclude
        this.updateGitInfoExclude(file, true, cwd);

        // 3. 检查是否被跟踪
        if (this.isGitTracked(file, cwd)) {
          // 4. 如果被跟踪，执行 skip-worktree
          this.toggleSkipWorktree(file, true, cwd);
        }

        filesProcessed.push(file);
      } else {
        // === 取消忽略流程 ===

        // 1. 从 .git/info/exclude 移除 (不处理 .gitignore)
        const removed = this.updateGitInfoExclude(file, false, cwd);

        // 2. 如果是从 exclude 移除的，或者文件存在
        // 执行 no-skip-worktree (即使之前没 skip，执行这个也没副作用，除了报错)
        // 只有当文件之前被我们处理过才尝试恢复
        this.toggleSkipWorktree(file, false, cwd);

        if (removed) {
          filesProcessed.push(file);
        }
      }
    });

    // 截图1的效果：显示提示信息
    if (filesProcessed.length > 0) {
      const msg = isIgnoring ? `Quick Ops: 已忽略文件 ${filesProcessed.join(', ')} (Git)` : `Quick Ops: 已恢复文件跟踪 ${filesProcessed.join(', ')} (Git)`;
      vscode.window.showInformationMessage(msg);
    }
  }

  /**
   * 检查文件是否被 .gitignore 规则覆盖
   */
  private isGitIgnored(filePath: string, cwd: string): boolean {
    try {
      // git check-ignore 返回 0 表示被忽略，返回 1 表示未被忽略
      execSync(`git check-ignore "${filePath}"`, { stdio: 'ignore', cwd });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 检查文件是否被 Git 跟踪
   */
  private isGitTracked(filePath: string, cwd: string): boolean {
    try {
      execSync(`git ls-files --error-unmatch "${filePath}"`, {
        stdio: 'ignore',
        cwd,
      });
      return true; // 被跟踪
    } catch (err) {
      return false; // 没被跟踪
    }
  }

  /**
   * 管理 .git/info/exclude 内容
   * @returns true if file was actually added/removed
   */
  private updateGitInfoExclude(filePath: string, add: boolean, cwd: string): boolean {
    const gitDir = path.join(cwd, '.git');
    const excludePath = path.join(gitDir, 'info', 'exclude');

    if (!fs.existsSync(gitDir)) return false; // 不是 git 仓库

    // 确保 info 目录存在
    const infoDir = path.dirname(excludePath);
    if (!fs.existsSync(infoDir)) {
      fs.mkdirSync(infoDir, { recursive: true });
    }

    let content = '';
    if (fs.existsSync(excludePath)) {
      content = fs.readFileSync(excludePath, 'utf-8');
    }

    // 统一换行符处理
    let lines = content.split(/\r?\n/).filter((line) => line.trim() !== '');
    const normalizedPath = filePath.replace(/\\/g, '/'); // git 使用 /

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
    return false;
  }

  /**
   * 执行 skip-worktree / no-skip-worktree
   */
  private toggleSkipWorktree(filePath: string, skip: boolean, cwd: string) {
    try {
      const flag = skip ? '--skip-worktree' : '--no-skip-worktree';
      execSync(`git update-index ${flag} "${filePath}"`, { stdio: 'ignore', cwd });
    } catch (e) {
      // 可能会失败（例如文件未被跟踪），忽略错误
    }
  }
}

// =====================================================================================
// 🔥 File Decoration Provider (实现截图2：文件右侧提示)
// =====================================================================================
class LogrcIgnoreDecorationProvider implements vscode.FileDecorationProvider {
  private _onDidChangeFileDecorations = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
  public readonly onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;

  constructor(private configService: ConfigurationService) {
    // 监听配置变化，刷新装饰器
    this.configService.on('configChanged', () => {
      this._onDidChangeFileDecorations.fire(undefined); // 刷新所有
    });
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    // 检查文件是否被我们的配置忽略
    if (this.configService.isIgnoredByExtension(uri.fsPath)) {
      return {
        badge: 'IG', // 简短的 Badge
        tooltip: '该文件已被 .logrc 配置忽略',
        color: new vscode.ThemeColor('gitDecoration.ignoredResourceForeground'),
        propagate: false,
      };
    }
    return undefined;
  }
}
