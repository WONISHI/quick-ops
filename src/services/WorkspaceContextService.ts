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

  // 缓存当前生效的 package.json 路径，用于 Git 命令的 cwd
  private _currentProjectRoot: string = '';

  private constructor() {
    this.init();

    // 监听文件切换：不仅更新文件名，还要尝试更新项目上下文(应对Monorepo切换包的情况)
    vscode.window.onDidChangeActiveTextEditor(() => {
      this.updateFileContext();
      // 切换文件后，重新查找最近的 package.json 并更新上下文
      this.updateProjectContext();
      // 更新 Git 上下文 (因为可能切换到了不同的子模块)
      this.updateGitContext();
    });

    // 监听 package.json 变化 (**/package.json 会监听所有子目录)
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
    this.updateFileContext();
    // 初始化时也尝试查找项目信息
    this.updateProjectContext();
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
      // 从当前编辑的文件所在目录开始查
      startUri = vscode.Uri.joinPath(vscode.window.activeTextEditor.document.uri, '..');
    } else if (vscode.workspace.workspaceFolders?.[0]) {
      // 如果没打开文件，从工作区根目录开始查
      startUri = vscode.workspace.workspaceFolders[0].uri;
    }

    if (!startUri) return;

    // 2. 查找 package.json
    const pkgUri = await this.findNearestPackageJson(startUri);

    if (!pkgUri) {
      // 如果实在找不到，可能不是 Node 项目，保持默认或清空
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

      this._dependencies = { ...pkg.dependencies, ...pkg.devDependencies };

      // 重新判断技术栈
      this._context.isVue3 = !!(this._dependencies['vue'] && this._dependencies['vue'].match(/(^|[^0-9])3\./));
      this._context.isReact = !!this._dependencies['react'];
      this._context.isTypeScript = !!this._dependencies['typescript'];

      if (this._dependencies['less']) this._context.cssLang = 'less';
      else if (this._dependencies['sass'] || this._dependencies['scss']) this._context.cssLang = 'scss';
      else this._context.cssLang = 'css';
    } catch (e) {
      // 解析失败
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
  }

  private updateGitContext() {
    // 优先使用当前识别到的项目根目录，如果没找到 package.json，则回退到工作区根目录
    const cwd = this._currentProjectRoot || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    if (!cwd) return;

    // 1. 获取当前分支
    exec('git branch --show-current', { cwd }, (err, stdout) => {
      if (!err && stdout) {
        this._context.gitBranch = stdout.trim();
      }
    });

    // 2. 获取远程上游分支
    exec('git rev-parse --abbrev-ref @{u}', { cwd }, (err, stdout) => {
      if (!err && stdout) {
        this._context.gitRemote = stdout.trim();
      } else {
        this._context.gitRemote = '';
      }
    });

    // 3. 获取本地分支列表
    exec('git branch --format="%(refname:short)"', { cwd }, (err, stdout) => {
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
    exec('git branch -r --format="%(refname:short)"', { cwd }, (err, stdout) => {
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
      exec('git config user.name', { cwd }, (err, stdout) => {
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
    // **/package.json 会监听工作区内所有的 package.json 变动
    const watcher = vscode.workspace.createFileSystemWatcher('**/package.json');
    const update = () => this.updateProjectContext();
    watcher.onDidChange(update);
    watcher.onDidCreate(update);
    watcher.onDidDelete(() => {
      // 只有当删除的是当前生效的 package.json 时才清空，这里简化处理
      this._dependencies = {};
      this._context.cssLang = 'css';
      this.updateProjectContext(); // 尝试重新查找上层
    });
  }
}
