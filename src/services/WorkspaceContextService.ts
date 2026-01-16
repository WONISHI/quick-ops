// src/services/WorkspaceContextService.ts
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { exec } from 'child_process';

// 定义上下文接口，方便类型提示
export interface IWorkspaceContext {
  // === 文件相关 ===
  fileName: string; // full filename: "MyComponent.vue"
  fileNameBase: string; // no extension: "MyComponent"
  fileExt: string; // ".vue"
  dirName: string; // parent dir: "components"
  filePath: string; // absolute path
  relativePath: string; // relative to workspace root

  // === 命名变体 (假设 fileNameBase = "my-component") ===
  moduleName: string; // 原样 "my-component"
  ModuleName: string; // PascalCase "MyComponent"
  moduleNameCamel: string; // camelCase "myComponent"
  moduleNameKebab: string; // kebab-case "my-component"
  moduleNameSnake: string; // snake_case "my_component"
  moduleNameUpper: string; // CONSTANT_CASE "MY_COMPONENT"

  // === 项目相关 (package.json) ===
  projectName: string; // package.json -> name
  projectVersion: string; // package.json -> version
  dependencies: Record<string, string>; // 合并 dep & devDep
  hasDependency: (dep: string) => boolean; // 辅助函数

  // === 智能推断 ===
  cssLang: 'css' | 'less' | 'scss';
  isVue3: boolean;
  isReact: boolean;
  isTypeScript: boolean;

  // === Git 相关 (异步更新，可能为空) ===
  gitBranch: string;
  gitRemote: string;

  // === 系统/用户 ===
  userName: string; // 系统用户名
  dateYear: string; // "2024"
  dateDate: string; // "2024-05-20"
  dateTime: string; // "2024-05-20 12:00:00"
}

export class WorkspaceContextService {
  private static instance: WorkspaceContextService;
  private _context: Partial<IWorkspaceContext> = {};
  private _dependencies: Record<string, string> = {};

  private constructor() {
    this.init();
    // 监听文件切换，实时更新文件上下文
    vscode.window.onDidChangeActiveTextEditor(() => this.updateFileContext());
    // 监听 package.json 变化
    this.watchPackageJson();
    // 定时刷新 Git 信息 (避免太频繁)
    setInterval(() => this.updateGitContext(), 30000);
  }

  public static getInstance(): WorkspaceContextService {
    if (!WorkspaceContextService.instance) {
      WorkspaceContextService.instance = new WorkspaceContextService();
    }
    return WorkspaceContextService.instance;
  }

  /**
   * 获取当前完整的上下文快照
   */
  public get context(): IWorkspaceContext {
    // 确保每次获取时时间是最新的
    this.updateTimeContext();
    // 确保文件上下文是最新的 (防止切换过快没触发事件)
    if (!this._context.fileName) {
      this.updateFileContext();
    }

    // 返回代理对象或深拷贝，这里为了性能直接合并
    // 增加一个辅助函数 hasDependency 方便在模板里调用
    return {
      ...this._context,
      dependencies: this._dependencies,
      hasDependency: (dep: string) => !!this._dependencies[dep],
    } as IWorkspaceContext;
  }

  private init() {
    this.updateProjectContext();
    this.updateGitContext();
    this.updateFileContext();
    this.updateTimeContext();
  }

  // === 1. 文件上下文更新 ===
  private updateFileContext() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const uri = editor.document.uri;
    const filePath = uri.fsPath;
    const parsedPath = path.parse(filePath);

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
    const relativePath = workspaceFolder ? path.relative(workspaceFolder.uri.fsPath, filePath) : filePath;

    // 基础名处理
    const baseName = parsedPath.name; // 去除后缀

    this._context.fileName = parsedPath.base;
    this._context.fileNameBase = baseName;
    this._context.fileExt = parsedPath.ext;
    this._context.dirName = path.basename(parsedPath.dir);
    this._context.filePath = filePath;
    this._context.relativePath = relativePath;

    // 命名变体生成 (使用 change-case 库，或者自己写简单的正则替换)
    this._context.moduleName = baseName;
    this._context.ModuleName = pascalCase(baseName);
    this._context.moduleNameCamel = camelCase(baseName);
    this._context.moduleNameKebab = kebabCase(baseName);
    this._context.moduleNameSnake = snakeCase(baseName);
    this._context.moduleNameUpper = snakeCase(baseName).toUpperCase();
  }

  // === 2. 项目上下文 (package.json) ===
  private updateProjectContext() {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) return;

    const pkgPath = path.join(workspaceRoot, 'package.json');
    if (!fs.existsSync(pkgPath)) return;

    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      this._context.projectName = pkg.name || 'unknown-project';
      this._context.projectVersion = pkg.version || '0.0.0';

      this._dependencies = { ...pkg.dependencies, ...pkg.devDependencies };

      // 智能推断
      this._context.isVue3 = !!(this._dependencies['vue'] && this._dependencies['vue'].match(/(^|[^0-9])3\./));
      this._context.isReact = !!this._dependencies['react'];
      this._context.isTypeScript = !!this._dependencies['typescript'];

      if (this._dependencies['less']) this._context.cssLang = 'less';
      else if (this._dependencies['sass'] || this._dependencies['scss']) this._context.cssLang = 'scss';
      else this._context.cssLang = 'css';
    } catch (e) {
      console.warn('Failed to parse package.json');
    }
  }

  // === 3. Git 上下文 ===
  private updateGitContext() {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) return;

    // 获取当前分支
    exec('git rev-parse --abbrev-ref HEAD', { cwd: workspaceRoot }, (err, stdout) => {
      if (!err && stdout) this._context.gitBranch = stdout.trim();
    });

    // 获取 User Name (用于 Author)
    if (!this._context.userName) {
      // 优先 git config, 降级用 os info
      exec('git config user.name', { cwd: workspaceRoot }, (err, stdout) => {
        if (!err && stdout) {
          this._context.userName = stdout.trim();
        } else {
          this._context.userName = os.userInfo().username;
        }
      });
    }
  }

  // === 4. 时间上下文 ===
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
    });
  }
}

// 简单的 polyfill 如果你不想引入 change-case 库
function pascalCase(str: string) {
  return str.replace(/(^|[-_])(\w)/g, (_, __, c) => c.toUpperCase());
}
function camelCase(str: string) {
  return str.replace(/[-_](\w)/g, (_, c) => c.toUpperCase());
}
function kebabCase(str: string) {
  return str
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase();
}
function snakeCase(str: string) {
  return str
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase();
}
