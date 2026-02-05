import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { exec } from 'child_process';
import { camelCase, kebabCase, snakeCase, upperFirst, debounce } from 'lodash-es';
import type { IWorkspaceContext } from '../core/types/work-space';

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
    // 优化：监听 Git 文件变动，替代原本的 setInterval
    this.watchGitFiles();
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

  private init() {
    this.updateProjectContext();
    this.updateGitContext();
    this.updateFileContext();
    this.updateTimeContext();
  }

  private updateFileContext() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const uri = editor.document.uri;
    const filePath = uri.fsPath;
    const parsedPath = path.parse(filePath);

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
    const relativePath = workspaceFolder ? path.relative(workspaceFolder.uri.fsPath, filePath) : filePath;

    const baseName = parsedPath.name;
    const dirName = path.basename(parsedPath.dir);

    this._context.fileName = parsedPath.base;
    this._context.fileNameBase = baseName;
    this._context.fileExt = parsedPath.ext;
    this._context.dirName = path.basename(parsedPath.dir);
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

  /**
   * 核心优化：监听 .git 文件夹变动
   */
  private watchGitFiles() {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) return;

    // 监听以下文件的变动：
    // HEAD: 切换分支时变动
    // config: 修改 git 配置时变动
    // refs/**: commit、fetch、pull、新建分支时变动
    const pattern = new vscode.RelativePattern(workspaceFolder, '.git/{HEAD,config,refs/**}');
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);

    // 使用 debounce 防止短时间内多次触发 (例如 git pull 可能连续修改多个文件)
    // 500ms 内的多次变动只会触发一次 updateGitContext
    const debouncedUpdate = debounce(() => {
      // console.log('[WorkspaceContext] Git change detected, updating context...');
      this.updateGitContext();
    }, 500);

    // 绑定事件
    watcher.onDidChange(debouncedUpdate);
    watcher.onDidCreate(debouncedUpdate);
    watcher.onDidDelete(debouncedUpdate);

    // 将 watcher 加入 context subscriptions (如果需要销毁机制，可以在这里处理，单例模式下通常不需要)
  }

  private updateGitContext() {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) return;

    // 1. 获取当前分支 (例如: master)
    exec('git branch --show-current', { cwd: workspaceRoot }, (err, stdout) => {
      if (!err && stdout) {
        this._context.gitBranch = stdout.trim();
      } else {
        // console.log('Git branch check failed:', err);
      }
    });

    // 2. 获取远程上游分支 (例如: origin/master)
    exec('git rev-parse --abbrev-ref @{u}', { cwd: workspaceRoot }, (err, stdout) => {
      if (!err && stdout) {
        this._context.gitRemote = stdout.trim();
      } else if (err) {
        this._context.gitRemote = '';
      }
    });

    // 3. 获取当前本地所有分支
    exec('git branch --format="%(refname:short)"', { cwd: workspaceRoot }, (err, stdout) => {
      if (!err && stdout) {
        const list = stdout
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean);
        this._context.gitLocalBranch = list;
      } else if (err) {
        this._context.gitLocalBranch = [];
      }
    });

    // 4. 获取远程分支列表
    exec('git branch -r --format="%(refname:short)"', { cwd: workspaceRoot }, (err, stdout) => {
      if (!err && stdout) {
        const list = stdout
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean);
        this._context.gitRemoteBranch = list;
      } else if (err) {
        this._context.gitRemoteBranch = [];
      }
    });

    // 5. 获取用户名
    if (!this._context.userName) {
      exec('git config user.name', { cwd: workspaceRoot }, (err, stdout) => {
        if (!err && stdout) {
          this._context.userName = stdout.trim();
        } else {
          this._context.userName = os.userInfo().username;
        }
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
    });
  }
}
