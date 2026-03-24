import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';
import { TextDecoder } from 'util';
import { camelCase, kebabCase, snakeCase, upperFirst, debounce } from 'lodash-es';
import type { IWorkspaceContext } from '../core/types/work-space';

export class WorkspaceContextService {
  private static instance: WorkspaceContextService;
  private _context: Partial<IWorkspaceContext> = {};
  private _dependencies: Record<string, string> = {};
  private _initPromise: Promise<void>;

  // 🌟 新增：事件广播器，用于通知外部（如智能提示引擎）“依赖发生变化，请热更新”
  private _onDidChangeContext = new vscode.EventEmitter<void>();
  public readonly onDidChangeContext = this._onDidChangeContext.event;

  // 缓存当前生效的 package.json 路径，用于 Git 命令的 cwd
  private _currentProjectRoot: string = '';
  
  // 🌟 新增：统一管理所有的监听器，防止内存泄漏
  private disposables: vscode.Disposable[] = [];

  private constructor() {
    this._initPromise = this.init();

    // 监听文件切换：不仅更新文件名，还要尝试更新项目上下文(应对Monorepo切换包的情况)
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => {
        this.updateFileContext();
        // 切换文件后，重新查找最近的 package.json 并更新上下文
        this.updateProjectContext();
        // 更新 Git 上下文 (因为可能切换到了不同的子模块)
        this.updateGitContext();
      })
    );

    // 监听 package.json 变化 (**/package.json 会监听所有子目录)
    this.watchPackageJson();
    // 监听 Git 文件变动
    this.watchGitFiles();
  }

  public async waitUntilReady(): Promise<void> {
    return this._initPromise;
  }

  public static getInstance(): WorkspaceContextService {
    if (!WorkspaceContextService.instance) {
      WorkspaceContextService.instance = new WorkspaceContextService();
    }
    return WorkspaceContextService.instance;
  }

  public get context(): IWorkspaceContext {
    this.updateTimeContext();
    if (!this._context.fileName) {
      this.updateFileContext();
    }

    return {
      ...this._context,
      dependencies: this._dependencies,
      hasDependency: (dep: string) => !!this._dependencies[dep],
    } as IWorkspaceContext;
  }

  private async init() {
    this.updateFileContext();
    // 初始化时也尝试查找项目信息
    await this.updateProjectContext();
    this.updateGitContext();
    this.updateTimeContext();
  }

  private updateFileContext() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const uri = editor.document.uri;
    const filePath = uri.fsPath;
    const parsedPath = path.parse(filePath);

    const relativePath = vscode.workspace.asRelativePath(uri);
    const baseName = parsedPath.name;
    const dirName = path.basename(parsedPath.dir);

    this._context.fileName = parsedPath.base;
    this._context.fileNameBase = baseName;
    this._context.fileExt = parsedPath.ext;
    this._context.dirName = dirName;
    this._context.filePath = filePath;
    this._context.relativePath = relativePath;

    this._context.moduleName = baseName;
    this._context.baseName = upperFirst(camelCase(baseName.toLowerCase() === 'index' ? dirName : baseName));
    this._context.ModuleName = upperFirst(camelCase(baseName));
    this._context.moduleNameCamel = camelCase(baseName);
    this._context.moduleNameKebab = kebabCase(baseName);
    this._context.moduleNameSnake = snakeCase(baseName);
    this._context.moduleNameUpper = snakeCase(baseName).toUpperCase();
  }

  /**
   * 核心修复：向上递归查找最近的 package.json
   */
  private async findNearestPackageJson(startUri: vscode.Uri): Promise<vscode.Uri | undefined> {
    let currentUri = startUri;

    // 循环向上查找
    while (true) {
      const pkgUri = vscode.Uri.joinPath(currentUri, 'package.json');
      try {
        // 检查文件是否存在
        await vscode.workspace.fs.stat(pkgUri);
        return pkgUri; // 找到了
      } catch {
        // 当前目录没找到
      }

      const parentUri = vscode.Uri.joinPath(currentUri, '..');
      // 如果父目录和当前目录路径相同，说明到达了根目录，停止查找
      if (parentUri.toString() === currentUri.toString()) {
        return undefined;
      }
      currentUri = parentUri;
    }
  }

  private async updateProjectContext() {
    // 1. 确定查找的起始位置
    let startUri: vscode.Uri | undefined;

    if (vscode.window.activeTextEditor) {
      startUri = vscode.Uri.joinPath(vscode.window.activeTextEditor.document.uri, '..');
    } else if (vscode.workspace.workspaceFolders?.[0]) {
      startUri = vscode.workspace.workspaceFolders[0].uri;
    }

    if (!startUri) return;

    // 2. 查找 package.json
    const pkgUri = await this.findNearestPackageJson(startUri);

    if (!pkgUri) {
      // 🌟 如果没找到 package.json，但旧内存里有依赖，说明可能切出了前端项目范围
      if (Object.keys(this._dependencies).length > 0) {
        this._dependencies = {};
        this._currentProjectRoot = '';
        this._onDidChangeContext.fire(); // 广播：依赖清空了
      }
      return;
    }

    // 更新当前项目根路径缓存 (给 Git 使用)
    this._currentProjectRoot = vscode.Uri.joinPath(pkgUri, '..').fsPath;

    const decoder = new TextDecoder('utf-8');

    try {
      const contentUint8 = await vscode.workspace.fs.readFile(pkgUri);
      const content = decoder.decode(contentUint8);
      const pkg = JSON.parse(content);

      this._context.projectName = pkg.name || 'unknown-project';
      this._context.projectVersion = pkg.version || '0.0.0';

      const newDependencies = { ...pkg.dependencies, ...pkg.devDependencies };

      // 🌟 性能优化：深度对比。只有在新老依赖不一致时，才触发广播重载
      const isDependenciesChanged = JSON.stringify(this._dependencies) !== JSON.stringify(newDependencies);

      this._dependencies = newDependencies;

      // 重新判断技术栈
      this._context.isVue3 = !!(this._dependencies['vue'] && this._dependencies['vue'].match(/(^|[^0-9])3\./));
      this._context.isReact = !!this._dependencies['react'];
      this._context.isTypeScript = !!this._dependencies['typescript'];

      if (this._dependencies['less']) this._context.cssLang = 'less';
      else if (this._dependencies['sass'] || this._dependencies['scss']) this._context.cssLang = 'scss';
      else this._context.cssLang = 'css';

      // 🌟 如果发现依赖确实变化了（比如刚执行完 npm install，或者在 monorepo 切换到了不同的子包）
      if (isDependenciesChanged) {
        this._onDidChangeContext.fire();
      }

    } catch (e) {
      // 解析失败
      console.error('[Quick Ops] 解析 package.json 失败', e);
    }
  }

  private watchGitFiles() {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) return;

    const pattern = new vscode.RelativePattern(workspaceFolder, '.git/{HEAD,config,refs/**}');
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);

    const debouncedUpdate = debounce(() => {
      this.updateGitContext();
    }, 500);

    watcher.onDidChange(debouncedUpdate);
    watcher.onDidCreate(debouncedUpdate);
    watcher.onDidDelete(debouncedUpdate);
    
    this.disposables.push(watcher);
  }

  private updateGitContext() {
    const cwd = this._currentProjectRoot || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!cwd) return;

    exec('git branch --show-current', { cwd }, (err, stdout) => {
      if (!err && stdout) this._context.gitBranch = stdout.trim();
    });

    exec('git rev-parse --abbrev-ref @{u}', { cwd }, (err, stdout) => {
      if (!err && stdout) this._context.gitRemote = stdout.trim();
      else this._context.gitRemote = '';
    });

    exec('git branch --format="%(refname:short)"', { cwd }, (err, stdout) => {
      if (!err && stdout) {
        this._context.gitLocalBranch = stdout.split('\n').map((s) => s.trim()).filter(Boolean);
      } else {
        this._context.gitLocalBranch = [];
      }
    });

    exec('git branch -r --format="%(refname:short)"', { cwd }, (err, stdout) => {
      if (!err && stdout) {
        this._context.gitRemoteBranch = stdout.split('\n').map((s) => s.trim()).filter(Boolean);
      } else {
        this._context.gitRemoteBranch = [];
      }
    });

    if (!this._context.userName) {
      exec('git config user.name', { cwd }, (err, stdout) => {
        if (!err && stdout) this._context.userName = stdout.trim();
        else this._context.userName = os.userInfo().username;
      });
    }
  }

  private updateTimeContext() {
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');

    this._context.dateYear = now.getFullYear().toString();
    this._context.dateDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    this._context.dateTime = `${this._context.dateDate} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  }

  private watchPackageJson() {
    const watcher = vscode.workspace.createFileSystemWatcher('**/package.json');
    const update = () => this.updateProjectContext();
    
    watcher.onDidChange(update);
    watcher.onDidCreate(update);
    watcher.onDidDelete(() => {
      this._dependencies = {};
      this._context.cssLang = 'css';
      this._onDidChangeContext.fire(); // 🌟 被删除时也触发广播
      this.updateProjectContext();
    });
    
    this.disposables.push(watcher);
  }

  // 🌟 新增：插件关闭时释放资源
  public dispose() {
    this._onDidChangeContext.dispose();
    this.disposables.forEach(d => d.dispose());
    this.disposables = [];
  }
}