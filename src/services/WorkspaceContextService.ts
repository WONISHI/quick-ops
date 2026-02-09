import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';
import { TextDecoder } from 'util'; // 引入解码工具
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
    // 监听 Git 文件变动
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
    // 这里的异步调用不需要 await，允许后台更新
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
    const parsedPath = path.parse(filePath); // path 模块处理字符串是安全的

    // 使用 VS Code API 获取相对路径，比 path.relative 更准确
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
   * 优化：使用 VS Code FS API 异步读取，移除 fs 模块依赖
   */
  private async updateProjectContext() {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) return;

    const pkgUri = vscode.Uri.joinPath(workspaceFolder.uri, 'package.json');
    const decoder = new TextDecoder('utf-8');

    try {
      // 异步读取文件内容
      const contentUint8 = await vscode.workspace.fs.readFile(pkgUri);
      const content = decoder.decode(contentUint8);
      const pkg = JSON.parse(content);

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
      // 文件不存在或解析失败，忽略
      // console.warn('Failed to parse package.json', e);
    }
  }

  /**
   * 监听 .git 文件夹变动
   */
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
  }

  private updateGitContext() {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) return;

    // child_process.exec 在远程开发环境中会在远程机器执行，所以这里保留 exec 是正确的
    // 只要 workspaceRoot 是正确的 fsPath 即可

    // 1. 获取当前分支
    exec('git branch --show-current', { cwd: workspaceRoot }, (err, stdout) => {
      if (!err && stdout) {
        this._context.gitBranch = stdout.trim();
      }
    });

    // 2. 获取远程上游分支
    exec('git rev-parse --abbrev-ref @{u}', { cwd: workspaceRoot }, (err, stdout) => {
      if (!err && stdout) {
        this._context.gitRemote = stdout.trim();
      } else {
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
      } else {
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
      } else {
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
    // 这里的 watcher 依然有效，因为它是 VS Code API
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
