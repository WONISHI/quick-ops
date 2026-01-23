import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { exec } from 'child_process';
import { camelCase, kebabCase, snakeCase, upperFirst } from 'lodash-es';

export interface IWorkspaceContext {
  fileName: string;
  fileNameBase: string;
  fileExt: string;
  dirName: string;
  filePath: string;
  relativePath: string;

  moduleName: string;
  ModuleName: string;
  moduleNameCamel: string;
  moduleNameKebab: string;
  moduleNameSnake: string;
  moduleNameUpper: string;

  projectName: string;
  projectVersion: string;
  dependencies: Record<string, string>;
  hasDependency: (dep: string) => boolean;

  cssLang: 'css' | 'less' | 'scss';
  isVue3: boolean;
  isReact: boolean;
  isTypeScript: boolean;

  gitBranch: string;
  gitRemote: string;
  gitLocalBranch: string[];
  gitRemoteBranch: string[];

  shadcnComponents: [
    'accordion',
    'alert',
    'alert-dialog',
    'aspect-ratio',
    'avatar',
    'badge',
    'breadcrumb',
    'button',
    'button-group',
    'calendar',
    'card',
    'carousel',
    'chart',
    'checkbox',
    'collapsible',
    'combobox',
    'command',
    'context-menu',
    'data-table',
    'date-picker',
    'dialog',
    'drawer',
    'dropdown-menu',
    'empty',
    'field',
    'hover-card',
    'input',
    'input-group',
    'input-otp',
    'item',
    'kbd',
    'label',
    'menubar',
    'native-select',
    'navigation-menu',
    'pagination',
    'popover',
    'progress',
    'radio-group',
    'resizable',
    'scroll-area',
    'select',
    'separator',
    'sheet',
    'sidebar',
    'skeleton',
    'slider',
    'sonner',
    'spinner',
    'switch',
    'table',
    'tabs',
    'textarea',
    'toast',
    'toggle',
    'toggle-group',
    'tooltip',
    'typography',
  ];

  userName: string;
  dateYear: string;
  dateDate: string;
  dateTime: string;
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

    this._context.fileName = parsedPath.base;
    this._context.fileNameBase = baseName;
    this._context.fileExt = parsedPath.ext;
    this._context.dirName = path.basename(parsedPath.dir);
    this._context.filePath = filePath;
    this._context.relativePath = relativePath;

    this._context.moduleName = baseName;
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

  private updateGitContext() {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) return;

    // 1. 获取当前分支 (例如: master)
    exec('git branch --show-current', { cwd: workspaceRoot }, (err, stdout) => {
      if (!err && stdout) {
        this._context.gitBranch = stdout.trim();
      } else {
        console.log('Git branch check failed:', err);
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
