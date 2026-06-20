import * as vscode from 'vscode';
import * as path from 'path';
import { EventEmitter } from 'events';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { QuickOpsConfig, QuickOpsShellConfig, ConfigurationChangeListener } from '../types/common.type';

const execFileAsync = promisify(execFile);

export class ConfigurationService extends EventEmitter {
  public readonly serviceId = 'ConfigurationService';

  private static instance: ConfigurationService | undefined;

  private context?: vscode.ExtensionContext;
  private readonly ignoredAbsolutePaths = new Set<string>();
  private lastIgnoreList: string[] = [];
  private decorationProviderDisposable?: vscode.Disposable;
  private configurationChangeDisposable?: vscode.Disposable;

  private constructor() {
    super();
  }

  public static getInstance(): ConfigurationService {
    if (!ConfigurationService.instance) {
      ConfigurationService.instance = new ConfigurationService();
    }

    return ConfigurationService.instance;
  }

  /**
   * 兼容旧代码：
   * 其他模块依然可以通过 this.configurationService.config 读取配置。
   */
  public get config(): Readonly<QuickOpsConfig> {
    const config = vscode.workspace.getConfiguration('quick-ops');

    return {
      general: {
        debug: config.get<boolean>('general.debug', false),
        excludeConfigFiles: config.get<boolean>('general.excludeConfigFiles', true),
        anchorViewMode: config.get<string>('general.anchorViewMode', 'tree'),
        mindMapPosition: config.get<string>('general.mindMapPosition', 'right'),
      },

      logger: {
        template: config.get<string>('logger.template', ''),
        dateFormat: config.get<string>('logger.dateFormat', 'YYYY-MM-DD HH:mm:ss'),
      },

      utils: {
        uuidLength: config.get<number>('utils.uuidLength', 8),
      },

      git: {
        ignoreList: config.get<string[]>('git.ignoreList', []),
      },

      shells: config.get<QuickOpsShellConfig[]>('shells', []),

      project: {
        marks: config.get<Record<string, unknown>>('project.marks', {}),
        alias: config.get<Record<string, string>>('project.alias', {}),
      },

      /**
       * snippets 现在建议放到 WorkspaceStateService 或独立 Snippet 模块中维护。
       * 这里保留空数组，避免旧代码读取时报错。
       */
      snippets: [],
    };
  }

  /**
   * ModuleRunner 会自动调用 init(context)。
   */
  public async init(context?: vscode.ExtensionContext): Promise<void> {
    this.context = context;

    await this.handleGitConfiguration();

    if (context) {
      this.configurationChangeDisposable = vscode.workspace.onDidChangeConfiguration((event) => {
        if (!event.affectsConfiguration('quick-ops')) return;

        this.emit('configChanged', this.config);

        if (event.affectsConfiguration('quick-ops.git.ignoreList') || event.affectsConfiguration('quick-ops.general.excludeConfigFiles')) {
          void this.handleGitConfiguration();
        }
      });

      this.decorationProviderDisposable = vscode.window.registerFileDecorationProvider(new GitIgnoreDecorationProvider(this));

      context.subscriptions.push(this.configurationChangeDisposable, this.decorationProviderDisposable);
    }

    await vscode.commands.executeCommand('setContext', 'quickOps.context.configMissing', false);
    await vscode.commands.executeCommand('setContext', 'quickOps.context.configState', 'exists');

    console.log(`[${this.serviceId}] Native Settings Initialized.`);
  }

  public get<T = unknown>(section: string, defaultValue?: T): T {
    return vscode.workspace.getConfiguration('quick-ops').get<T>(section, defaultValue as T);
  }

  public async update<T = unknown>(section: string, value: T, target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Workspace): Promise<void> {
    try {
      await vscode.workspace.getConfiguration('quick-ops').update(section, value, target);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      vscode.window.showErrorMessage(`更新配置失败: ${message}`);
      console.error(`[${this.serviceId}] update error:`, error);
    }
  }

  /**
   * 兼容旧代码命名。
   */
  public async updateConfig(section: string, value: unknown): Promise<void> {
    await this.update(section, value, vscode.ConfigurationTarget.Workspace);
  }

  public inspect<T = unknown>(section: string) {
    return vscode.workspace.getConfiguration('quick-ops').inspect<T>(section);
  }

  public async reload(): Promise<void> {
    await this.handleGitConfiguration();
    this.emit('configChanged', this.config);
  }

  public onConfigChanged(listener: ConfigurationChangeListener): this {
    return this.on('configChanged', listener);
  }

  public isIgnoredByExtension(filePath: string): boolean {
    const normalized = this.normalizePath(filePath);

    if (this.ignoredAbsolutePaths.has(normalized)) {
      return true;
    }

    return [...this.ignoredAbsolutePaths].some((ignoredPath) => {
      if (!ignoredPath.endsWith('/**')) return false;

      const dirPath = ignoredPath.slice(0, -3);
      return normalized === dirPath || normalized.startsWith(`${dirPath}/`);
    });
  }

  public async modifyIgnoreList(fileUri: vscode.Uri, type: 'add' | 'remove'): Promise<void> {
    try {
      const workspaceRoot = this.getWorkspaceRoot();

      if (!workspaceRoot) {
        vscode.window.showWarningMessage('当前没有打开工作区，无法修改 QuickOps 忽略列表。');
        return;
      }

      let relativePath = this.normalizePath(path.relative(workspaceRoot, fileUri.fsPath));

      try {
        const stat = await vscode.workspace.fs.stat(fileUri);

        if (stat.type === vscode.FileType.Directory && !relativePath.endsWith('/**')) {
          relativePath += '/**';
        }
      } catch {
        // 文件可能已经不存在，这里不阻断 remove 操作。
      }

      let ignoreList = this.get<string[]>('git.ignoreList', []);

      if (type === 'add') {
        if (ignoreList.includes(relativePath)) return;

        ignoreList = [...ignoreList, relativePath];
      } else {
        ignoreList = ignoreList.filter((item) => item !== relativePath);
      }

      await this.update('git.ignoreList', ignoreList, vscode.ConfigurationTarget.Workspace);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      vscode.window.showErrorMessage(`更新 Git 忽略列表失败: ${message}`);
      console.error(`[${this.serviceId}] modifyIgnoreList error:`, error);
    }
  }

  public dispose(): void {
    this.configurationChangeDisposable?.dispose();
    this.decorationProviderDisposable?.dispose();

    this.configurationChangeDisposable = undefined;
    this.decorationProviderDisposable = undefined;

    this.ignoredAbsolutePaths.clear();
    this.lastIgnoreList = [];
    this.removeAllListeners();
  }

  private async handleGitConfiguration(): Promise<void> {
    try {
      const workspaceRoot = this.getWorkspaceRoot();

      if (!workspaceRoot) return;

      const currentIgnoreList = this.config.git.ignoreList ?? [];
      const normalizedIgnoreList = currentIgnoreList.map((item) => this.normalizePath(item));

      this.ignoredAbsolutePaths.clear();

      for (const relativePath of normalizedIgnoreList) {
        const absolutePath = this.normalizePath(path.join(workspaceRoot, relativePath));
        this.ignoredAbsolutePaths.add(absolutePath);
      }

      const previousSet = new Set(this.lastIgnoreList);
      const currentSet = new Set(normalizedIgnoreList);

      const toAdd = normalizedIgnoreList.filter((item) => !previousSet.has(item));
      const toRemove = this.lastIgnoreList.filter((item) => !currentSet.has(item));

      if (toAdd.length > 0 || toRemove.length > 0) {
        await this.batchProcessIgnoreFiles(toAdd, toRemove, workspaceRoot);
      }

      this.lastIgnoreList = normalizedIgnoreList;
    } catch (error) {
      console.warn(`[${this.serviceId}] Git config sync failed:`, error);
    }
  }

  private async batchProcessIgnoreFiles(filesToAdd: string[], filesToRemove: string[], cwd: string): Promise<void> {
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
        console.log(`[${this.serviceId}] Synced ${count} files to Git config.`);
      }
    } catch (error) {
      console.error(`[${this.serviceId}] batchProcessIgnoreFiles failed:`, error);
    }
  }

  private async batchUpdateGitInfoExclude(filesToAdd: string[], filesToRemove: string[], cwd: string): Promise<void> {
    try {
      const gitDir = path.join(cwd, '.git');
      const gitDirUri = vscode.Uri.file(gitDir);

      if (!(await this.pathExists(gitDirUri))) return;

      const excludePath = path.join(gitDir, 'info', 'exclude');
      const excludeUri = vscode.Uri.file(excludePath);
      const infoDirUri = vscode.Uri.file(path.dirname(excludePath));

      if (!(await this.pathExists(infoDirUri))) {
        await vscode.workspace.fs.createDirectory(infoDirUri);
      }

      let content = '';

      if (await this.pathExists(excludeUri)) {
        const fileBuffer = await vscode.workspace.fs.readFile(excludeUri);
        content = Buffer.from(fileBuffer).toString('utf-8');
      }

      const removeSet = new Set(filesToRemove.map((item) => this.normalizePath(item)));

      let lines = content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .filter((line) => !removeSet.has(this.normalizePath(line)));

      for (const file of filesToAdd) {
        const normalized = this.normalizePath(file);

        if (!lines.includes(normalized)) {
          lines.push(normalized);
        }
      }

      const nextContent = lines.length > 0 ? `${lines.join('\n')}\n` : '';
      await vscode.workspace.fs.writeFile(excludeUri, Buffer.from(nextContent, 'utf-8'));
    } catch (error) {
      console.warn(`[${this.serviceId}] batchUpdateGitInfoExclude failed:`, error);
    }
  }

  private async filterTrackedFiles(files: string[], cwd: string): Promise<string[]> {
    if (files.length === 0) return [];

    try {
      const normalizedFiles = files.map((item) => this.normalizePath(item));

      const { stdout } = await execFileAsync('git', ['ls-files', '--', ...normalizedFiles], { cwd });

      const trackedFiles = new Set(
        stdout
          .split(/\r?\n/)
          .map((item) => this.normalizePath(item.trim()))
          .filter(Boolean),
      );

      return normalizedFiles.filter((file) => trackedFiles.has(file));
    } catch {
      return [];
    }
  }

  private async runGitUpdateIndex(files: string[], skip: boolean, cwd: string): Promise<void> {
    if (files.length === 0) return;

    try {
      const flag = skip ? '--skip-worktree' : '--no-skip-worktree';

      await execFileAsync('git', ['update-index', flag, '--', ...files.map((item) => this.normalizePath(item))], { cwd });
    } catch (error) {
      console.warn(`[${this.serviceId}] git update-index failed:`, error);
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

  private getWorkspaceRoot(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  private normalizePath(filePath: string): string {
    return filePath.replace(/\\/g, '/');
  }
}

class GitIgnoreDecorationProvider implements vscode.FileDecorationProvider {
  private readonly changeEmitter = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();

  public readonly onDidChangeFileDecorations = this.changeEmitter.event;

  constructor(private readonly configurationService: ConfigurationService) {
    this.configurationService.on('configChanged', () => {
      this.changeEmitter.fire(undefined);
    });
  }

  public provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (!this.configurationService.isIgnoredByExtension(uri.fsPath)) {
      return undefined;
    }

    return {
      badge: 'IG',
      tooltip: '该文件已被 QuickOps Git 隔离功能忽略',
      color: new vscode.ThemeColor('gitDecoration.ignoredResourceForeground'),
      propagate: false,
    };
  }
}
