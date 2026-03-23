import * as vscode from 'vscode';
import * as path from 'path';
import { EventEmitter } from 'events';
import { exec } from 'child_process';
import { promisify } from 'util';
import { IService } from '../core/interfaces/IService';
import type { ILogrcConfig } from '../core/types/config';
import ColorLog from '../utils/ColorLog';

const execAsync = promisify(exec);

export class ConfigurationService extends EventEmitter implements IService {
  public readonly serviceId = 'ConfigurationService';
  private static _instance: ConfigurationService;

  private _context?: vscode.ExtensionContext;
  private _ignoredAbsolutePaths: Set<string> = new Set();

  // 记录上一次的 ignoreList 以便在配置变化时做 diff 增量处理
  private _lastIgnoreList: string[] = [];

  private constructor() {
    super();
  }

  public static getInstance(): ConfigurationService {
    if (!this._instance) this._instance = new ConfigurationService();
    return this._instance;
  }

  /**
   * 🌟 核心魔法：实时读取 VS Code 原生设置，并映射为你原有的 ILogrcConfig 接口
   * 这样其他所有的 Feature 都不需要修改任何代码，依然可以通过 this.configService.config 访问！
   */
  public get config(): Readonly<ILogrcConfig> {
    const vscodeConfig = vscode.workspace.getConfiguration('quick-ops');
    return {
      general: {
        debug: vscodeConfig.get<boolean>('general.debug'),
        excludeConfigFiles: vscodeConfig.get<boolean>('general.excludeConfigFiles'),
        anchorViewMode: vscodeConfig.get<string>('general.anchorViewMode'),
        mindMapPosition: vscodeConfig.get<string>('general.mindMapPosition'),
      },
      logger: {
        template: vscodeConfig.get<string>('logger.template'),
        dateFormat: vscodeConfig.get<string>('logger.dateFormat'),
      },
      utils: {
        uuidLength: vscodeConfig.get<number>('utils.uuidLength'),
      },
      git: {
        ignoreList: vscodeConfig.get<string[]>('git.ignoreList') || [],
      },
      shells: vscodeConfig.get<string[]>('shells') || [],
      project: {
        marks: vscodeConfig.get<any>('project.marks') || {},
        alias: vscodeConfig.get<any>('project.alias') || {},
      },
      snippets: [], // snippets 已经移交工作区内存管理，不再从这里读取
    } as ILogrcConfig;
  }

  public isIgnoredByExtension(filePath: string): boolean {
    const normalized = filePath.replace(/\\/g, '/');
    return this._ignoredAbsolutePaths.has(normalized);
  }

  public async init(context?: vscode.ExtensionContext): Promise<void> {
    this._context = context;

    // 1. 初始化时同步一次 Git 忽略列表
    this.handleGitConfiguration().catch((err) => console.error(`[${this.serviceId}] Init load failed:`, err));

    // 2. 🌟 注册原生配置变更监听器
    if (context) {
      context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((e) => {
          if (e.affectsConfiguration('quick-ops')) {
            // 触发配置改变事件，通知其他 Feature 刷新
            this.emit('configChanged', this.config);

            // 如果修改了 ignoreList 或 excludeConfigFiles，重新同步 Git
            if (e.affectsConfiguration('quick-ops.git.ignoreList') || e.affectsConfiguration('quick-ops.general.excludeConfigFiles')) {
              this.handleGitConfiguration();
            }
          }
        }),
      );

      // 注册 Git 隔离文件的高亮装饰器
      context.subscriptions.push(vscode.window.registerFileDecorationProvider(new GitIgnoreDecorationProvider(this)));
    }

    // 为了兼容旧版右键菜单 (让 toggleIgnore 菜单始终显示)
    vscode.commands.executeCommand('setContext', 'quickOps.context.configMissing', false);
    vscode.commands.executeCommand('setContext', 'quickOps.context.configState', 'exists');

    ColorLog.green(`[${this.serviceId}]`, 'Native Settings Initialized.');
  }

  /**
   * 更新 VS Code 原生设置
   * @param section 例如 'general.debug' 或 'git.ignoreList'
   */
  public async updateConfig(section: string, value: any): Promise<void> {
    try {
      const vscodeConfig = vscode.workspace.getConfiguration('quick-ops');
      // ConfigurationTarget.Workspace 表示优先保存在当前工作区 (.vscode/settings.json)
      await vscodeConfig.update(section, value, vscode.ConfigurationTarget.Workspace);
    } catch (error: any) {
      vscode.window.showErrorMessage(`更新配置失败: ${error.message}`);
      console.error(`[${this.serviceId}] updateConfig error:`, error);
    }
  }

  /**
   * 动态添加或移除 Git 忽略文件
   */
  public async modifyIgnoreList(fileUri: vscode.Uri, type: 'add' | 'remove'): Promise<void> {
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

      const vscodeConfig = vscode.workspace.getConfiguration('quick-ops');
      let currentIgnoreList = vscodeConfig.get<string[]>('git.ignoreList') || [];

      if (type === 'add') {
        if (!currentIgnoreList.includes(relativePath)) {
          currentIgnoreList.push(relativePath);
        } else {
          return; // 已存在，无需修改
        }
      } else {
        currentIgnoreList = currentIgnoreList.filter((p) => p !== relativePath);
      }

      // 将更新后的数组写入 VS Code 设置
      // 这会自动触发 onDidChangeConfiguration，从而去同步底层的 Git info/exclude
      await vscodeConfig.update('git.ignoreList', currentIgnoreList, vscode.ConfigurationTarget.Workspace);
    } catch (e: any) {
      vscode.window.showErrorMessage(`更新 Git 忽略列表失败: ${e.message}`);
    }
  }

  public dispose(): void {
    this.removeAllListeners();
  }

  // ============================================================================
  // 以下是 Git 底层 `info/exclude` 以及 `skip-worktree` 的核心同步逻辑 (保持原有强大能力)
  // ============================================================================

  private async handleGitConfiguration() {
    try {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
      if (!workspaceRoot) return;

      const currentFilesToIgnore = new Set<string>();

      // 现在只需要单纯地读取用户配置的 ignoreList 即可
      const ignoreList = this.config.git?.ignoreList || [];
      ignoreList.forEach((f) => currentFilesToIgnore.add(f));

      this._ignoredAbsolutePaths.clear();
      for (const relativePath of currentFilesToIgnore) {
        const absPath = path.join(workspaceRoot, relativePath).replace(/\\/g, '/');
        this._ignoredAbsolutePaths.add(absPath);
      }

      const lastFilesToIgnore = new Set<string>(this._lastIgnoreList);

      const toAdd = [...currentFilesToIgnore].filter((x) => !lastFilesToIgnore.has(x));
      const toRemove = [...lastFilesToIgnore].filter((x) => !currentFilesToIgnore.has(x));

      if (toAdd.length > 0 || toRemove.length > 0) {
        await this.batchProcessIgnoreFiles(toAdd, toRemove, workspaceRoot);
      }

      this._lastIgnoreList = Array.from(currentFilesToIgnore);
    } catch (e) {
      console.warn(`[${this.serviceId}] Git config sync failed:`, e);
    }
  }

  private async batchProcessIgnoreFiles(filesToAdd: string[], filesToRemove: string[], cwd: string) {
    try {
      // 1. 修改 .git/info/exclude
      await this.batchUpdateGitInfoExclude(filesToAdd, filesToRemove, cwd);

      // 2. 如果文件已经被 Git 追踪过，强制执行 skip-worktree，让修改在工作区隐身
      if (filesToAdd.length > 0) {
        const trackedToAdd = await this.filterTrackedFiles(filesToAdd, cwd);
        if (trackedToAdd.length > 0) {
          await this.runGitUpdateIndex(trackedToAdd, true, cwd);
        }
      }

      // 3. 如果移除了忽略，恢复文件的追踪状态
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
        const uint8Array = await vscode.workspace.fs.readFile(excludeUri);
        content = Buffer.from(uint8Array).toString('utf-8');
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
        const uint8Array = Buffer.from(lines.join('\n') + '\n', 'utf-8');
        await vscode.workspace.fs.writeFile(excludeUri, uint8Array);
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
}

/**
 * 用于将 Git 幽灵隔离的文件在资源管理器中染成灰色并打上 IG 标签
 */
class GitIgnoreDecorationProvider implements vscode.FileDecorationProvider {
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
        tooltip: '该文件已被 QuickOps Git隔离功能 忽略',
        color: new vscode.ThemeColor('gitDecoration.ignoredResourceForeground'),
        propagate: false,
      };
    }
    return undefined;
  }
}
