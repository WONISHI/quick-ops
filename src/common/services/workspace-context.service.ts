import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';
import { TextDecoder } from 'util';
import {
  camelCase,
  debounce,
  kebabCase,
  snakeCase,
  upperFirst,
} from 'lodash-es';

import type { IWorkspaceContext } from '@core/types/work-space';

export class WorkspaceContextService {
  public readonly serviceId = 'WorkspaceContextService';

  private static instance: WorkspaceContextService | undefined;

  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly decoder = new TextDecoder('utf-8');

  private contextValue: Partial<IWorkspaceContext> = {};
  private dependencies: Record<string, any> = {};
  private currentProjectRoot = '';
  private initPromise: Promise<void> | undefined;

  public readonly onDidChangeContext = this.changeEmitter.event;

  private constructor() {}

  public static getInstance(): WorkspaceContextService {
    if (!WorkspaceContextService.instance) {
      WorkspaceContextService.instance = new WorkspaceContextService();
    }

    return WorkspaceContextService.instance;
  }

  public async init(): Promise<void> {
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this.doInit();
    return this.initPromise;
  }

  public async waitUntilReady(): Promise<void> {
    await this.init();
  }

  public get context(): IWorkspaceContext {
    this.updateTimeContext();

    if (!this.contextValue.fileName) {
      this.updateFileContext();
    }

    return {
      fileName: this.contextValue.fileName || '',
      fileNameBase: this.contextValue.fileNameBase || '',
      fileExt: this.contextValue.fileExt || '',
      dirName: this.contextValue.dirName || '',
      filePath: this.contextValue.filePath || '',
      relativePath: this.contextValue.relativePath || '',

      moduleName: this.contextValue.moduleName || '',
      baseName: this.contextValue.baseName || '',
      ModuleName: this.contextValue.ModuleName || '',
      moduleNameCamel: this.contextValue.moduleNameCamel || '',
      moduleNameKebab: this.contextValue.moduleNameKebab || '',
      moduleNameSnake: this.contextValue.moduleNameSnake || '',
      moduleNameUpper: this.contextValue.moduleNameUpper || '',

      projectName: this.contextValue.projectName || 'unknown-project',
      projectVersion: this.contextValue.projectVersion || '0.0.0',
      dependencies: this.dependencies,
      hasDependency: (dep: string) => Boolean(this.dependencies[dep]),

      cssLang: this.contextValue.cssLang || 'css',
      isVue3: Boolean(this.contextValue.isVue3),
      isReact: Boolean(this.contextValue.isReact),
      isTypeScript: Boolean(this.contextValue.isTypeScript),

      gitBranch: this.contextValue.gitBranch || '',
      gitRemote: this.contextValue.gitRemote || '',
      gitLocalBranch: this.contextValue.gitLocalBranch || [],
      gitRemoteBranch: this.contextValue.gitRemoteBranch || [],

      shadcnComponents: this.getShadcnComponents(),

      userName: this.contextValue.userName || os.userInfo().username,

      dateYear: this.contextValue.dateYear || '',
      dateDate: this.contextValue.dateDate || '',
      dateTime: this.contextValue.dateTime || '',
    };
  }

  public getCurrentProjectRoot(): string {
    return (
      this.currentProjectRoot ||
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ||
      ''
    );
  }

  public async refresh(): Promise<void> {
    this.updateFileContext();
    await this.updateProjectContext();
    await this.updateGitContext();
    this.updateTimeContext();
    this.changeEmitter.fire();
  }

  public dispose(): void {
    this.changeEmitter.dispose();

    for (const disposable of this.disposables) {
      disposable.dispose();
    }

    this.disposables.length = 0;
    this.contextValue = {};
    this.dependencies = {};
    this.currentProjectRoot = '';
    this.initPromise = undefined;
  }

  private async doInit(): Promise<void> {
    this.updateFileContext();
    await this.updateProjectContext();
    await this.updateGitContext();
    this.updateTimeContext();

    this.watchActiveEditor();
    this.watchPackageJson();
    this.watchGitFiles();
  }

  private watchActiveEditor(): void {
    const disposable = vscode.window.onDidChangeActiveTextEditor(() => {
      this.updateFileContext();
      void this.updateProjectContext();
      void this.updateGitContext();
    });

    this.disposables.push(disposable);
  }

  private watchPackageJson(): void {
    const watcher = vscode.workspace.createFileSystemWatcher('**/package.json');

    const update = debounce(() => {
      void this.updateProjectContext();
    }, 300);

    watcher.onDidChange(update);
    watcher.onDidCreate(update);
    watcher.onDidDelete(() => {
      this.dependencies = {};
      this.contextValue.cssLang = 'css';
      this.contextValue.isVue3 = false;
      this.contextValue.isReact = false;
      this.contextValue.isTypeScript = false;
      this.changeEmitter.fire();

      void this.updateProjectContext();
    });

    this.disposables.push(watcher);
  }

  private watchGitFiles(): void {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

    if (!workspaceFolder) return;

    const pattern = new vscode.RelativePattern(
      workspaceFolder,
      '.git/{HEAD,config,refs/**}',
    );

    const watcher = vscode.workspace.createFileSystemWatcher(pattern);

    const update = debounce(() => {
      void this.updateGitContext();
    }, 500);

    watcher.onDidChange(update);
    watcher.onDidCreate(update);
    watcher.onDidDelete(update);

    this.disposables.push(watcher);
  }

  private updateFileContext(): void {
    const editor = vscode.window.activeTextEditor;

    if (!editor) return;

    const uri = editor.document.uri;

    if (uri.scheme !== 'file') return;

    const filePath = uri.fsPath;
    const parsedPath = path.parse(filePath);
    const relativePath = vscode.workspace.asRelativePath(uri);
    const dirName = path.basename(parsedPath.dir);

    const rawModuleName =
      parsedPath.name.toLowerCase() === 'index' && dirName
        ? dirName
        : parsedPath.name;

    this.contextValue.fileName = parsedPath.base;
    this.contextValue.fileNameBase = parsedPath.name;
    this.contextValue.fileExt = parsedPath.ext;
    this.contextValue.dirName = dirName;
    this.contextValue.filePath = filePath;
    this.contextValue.relativePath = relativePath;

    this.contextValue.moduleName = rawModuleName;
    this.contextValue.baseName = upperFirst(camelCase(rawModuleName));
    this.contextValue.ModuleName = upperFirst(camelCase(parsedPath.name));
    this.contextValue.moduleNameCamel = camelCase(rawModuleName);
    this.contextValue.moduleNameKebab = kebabCase(rawModuleName);
    this.contextValue.moduleNameSnake = snakeCase(rawModuleName);
    this.contextValue.moduleNameUpper = snakeCase(rawModuleName).toUpperCase();
  }

  private async updateProjectContext(): Promise<void> {
    const startUri = this.getProjectSearchStartUri();

    if (!startUri) return;

    const packageJsonUri = await this.findNearestPackageJson(startUri);

    if (!packageJsonUri) {
      if (Object.keys(this.dependencies).length > 0) {
        this.dependencies = {};
        this.currentProjectRoot = '';
        this.changeEmitter.fire();
      }

      return;
    }

    this.currentProjectRoot = vscode.Uri.joinPath(packageJsonUri, '..').fsPath;

    try {
      const contentBytes = await vscode.workspace.fs.readFile(packageJsonUri);
      const content = this.decoder.decode(contentBytes);
      const packageJson = JSON.parse(content);

      this.contextValue.projectName = packageJson.name || 'unknown-project';
      this.contextValue.projectVersion = packageJson.version || '0.0.0';

      const nextDependencies = {
        ...(packageJson.dependencies || {}),
        ...(packageJson.devDependencies || {}),
      };

      const dependenciesChanged =
        JSON.stringify(this.dependencies) !== JSON.stringify(nextDependencies);

      this.dependencies = nextDependencies;

      this.contextValue.isVue3 = this.isVue3Project(nextDependencies);
      this.contextValue.isReact = Boolean(nextDependencies.react);
      this.contextValue.isTypeScript = Boolean(nextDependencies.typescript);
      this.contextValue.cssLang = this.resolveCssLang(nextDependencies);

      if (dependenciesChanged) {
        this.changeEmitter.fire();
      }
    } catch (error) {
      console.error('[QuickOps] 解析 package.json 失败:', error);
    }
  }

  private async updateGitContext(): Promise<void> {
    const cwd =
      this.currentProjectRoot ||
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ||
      '';

    if (!cwd) return;

    const [gitBranch, gitRemote, gitLocalBranch, gitRemoteBranch, userName] =
      await Promise.all([
        this.execGit(['branch', '--show-current'], cwd),
        this.execGit(['rev-parse', '--abbrev-ref', '@{u}'], cwd),
        this.execGit(['branch', '--format=%(refname:short)'], cwd),
        this.execGit(['branch', '-r', '--format=%(refname:short)'], cwd),
        this.execGit(['config', 'user.name'], cwd),
      ]);

    this.contextValue.gitBranch = gitBranch.trim();
    this.contextValue.gitRemote = gitRemote.trim();
    this.contextValue.gitLocalBranch = gitLocalBranch
      .split(/\r?\n/)
      .map(item => item.trim())
      .filter(Boolean);

    this.contextValue.gitRemoteBranch = gitRemoteBranch
      .split(/\r?\n/)
      .map(item => item.trim())
      .filter(Boolean);

    this.contextValue.userName = userName.trim() || os.userInfo().username;
  }

  private updateTimeContext(): void {
    const now = new Date();
    const pad = (num: number) => String(num).padStart(2, '0');

    const dateYear = String(now.getFullYear());
    const dateDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
      now.getDate(),
    )}`;
    const dateTime = `${dateDate} ${pad(now.getHours())}:${pad(
      now.getMinutes(),
    )}:${pad(now.getSeconds())}`;

    this.contextValue.dateYear = dateYear;
    this.contextValue.dateDate = dateDate;
    this.contextValue.dateTime = dateTime;
  }

  private getProjectSearchStartUri(): vscode.Uri | undefined {
    const activeEditor = vscode.window.activeTextEditor;

    if (activeEditor?.document.uri.scheme === 'file') {
      return vscode.Uri.joinPath(activeEditor.document.uri, '..');
    }

    return vscode.workspace.workspaceFolders?.[0]?.uri;
  }

  private async findNearestPackageJson(
    startUri: vscode.Uri,
  ): Promise<vscode.Uri | undefined> {
    let currentUri = startUri;

    while (true) {
      const packageJsonUri = vscode.Uri.joinPath(currentUri, 'package.json');

      try {
        await vscode.workspace.fs.stat(packageJsonUri);
        return packageJsonUri;
      } catch {
        // continue
      }

      const parentUri = vscode.Uri.joinPath(currentUri, '..');

      if (parentUri.toString() === currentUri.toString()) {
        return undefined;
      }

      currentUri = parentUri;
    }
  }

  private execGit(args: string[], cwd: string): Promise<string> {
    return new Promise(resolve => {
      exec(`git ${args.join(' ')}`, { cwd }, (error, stdout) => {
        if (error) {
          resolve('');
          return;
        }

        resolve(stdout || '');
      });
    });
  }

  private resolveCssLang(
    dependencies: Record<string, any>,
  ): 'css' | 'less' | 'scss' {
    if (dependencies.less) return 'less';
    if (dependencies.sass || dependencies.scss) return 'scss';
    return 'css';
  }

  private isVue3Project(dependencies: Record<string, any>): boolean {
    const version = String(dependencies.vue || '');

    return /(^|[^0-9])3\./.test(version);
  }

  private getShadcnComponents(): IWorkspaceContext['shadcnComponents'] {
    return [
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
  }
}