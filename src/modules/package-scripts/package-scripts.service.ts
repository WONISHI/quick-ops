import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { TextDecoder } from 'util';
import { spawn, ChildProcessWithoutNullStreams, execFile } from 'child_process';
import { promisify } from 'util';
import { camelCase, kebabCase, snakeCase, upperFirst } from 'lodash-es';

import { TemplateEngine } from '../../utils/TemplateEngine';
import { ExtensionContextProvider } from '../../common/providers/extension-context.provider';
import { ConfigurationService } from '../../common/services/configuration.service';

import type { IWorkspaceContext } from '../../core/types/work-space';
import type {
  PackageJsonInfo,
  PackageManager,
  PackageScriptsStatus,
  RunningCommandInfo,
  ScriptItem,
  ShellConfigItem,
} from './package-scripts.type';

const execFileAsync = promisify(execFile);

export class PackageScriptsService {
  public static inject = [ExtensionContextProvider, ConfigurationService];

  private readonly decoder = new TextDecoder('utf-8');

  private statusBarItem?: vscode.StatusBarItem;
  private statusHideTimer?: NodeJS.Timeout;
  private statusTickTimer?: NodeJS.Timeout;

  private commandSeq = 0;
  private runningProcess?: ChildProcessWithoutNullStreams;
  private runningCommand?: RunningCommandInfo;

  private packageJsonCache = new Map<string, PackageJsonInfo | undefined>();

  private lastStatus: PackageScriptsStatus = {
    type: 'idle',
  };

  constructor(
    private readonly extensionContextProvider: ExtensionContextProvider,
    private readonly configurationService: ConfigurationService,
  ) {}

  public init(): void {
    this.initStatusBar();
    this.updateScriptStatusBar();
  }

  public async showScripts(): Promise<void> {
    const items: Array<ScriptItem | vscode.QuickPickItem> = [];

    let startUri = this.getStartUri();
    let packageJsonInfo: PackageJsonInfo | undefined;
    let projectRoot = '';

    if (startUri) {
      packageJsonInfo = await this.findPackageJson(startUri);
    }

    const activeContext = await this.getTemplateContext(packageJsonInfo);

    if (packageJsonInfo) {
      projectRoot = packageJsonInfo.dirPath;

      const scriptNames = Object.keys(packageJsonInfo.scripts);

      if (scriptNames.length > 0) {
        items.push({
          label: `NPM Scripts (${packageJsonInfo.name || 'Project'})`,
          description: vscode.workspace.asRelativePath(packageJsonInfo.dirUri),
          kind: vscode.QuickPickItemKind.Separator,
        });

        for (const scriptName of scriptNames) {
          items.push(
            this.createScriptItem({
              label: scriptName,
              description: packageJsonInfo.scripts[scriptName],
              commandToExecute: scriptName,
              cwd: projectRoot,
              isNpmScript: true,
              source: 'package-json',
              keepOpen: false,
            }),
          );
        }
      }

      const workspaceScripts = this.loadWorkspaceScripts(projectRoot, activeContext);

      if (workspaceScripts.length > 0) {
        items.push({
          label: 'Workspace Custom Scripts',
          kind: vscode.QuickPickItemKind.Separator,
        });

        items.push(...workspaceScripts);
      }
    }

    const extensionScripts = await this.loadExtensionShellScripts(
      activeContext,
      projectRoot || this.extensionContextProvider.extensionPath,
    );

    if (extensionScripts.length > 0) {
      items.push(...extensionScripts);
    }

    if (items.length === 0) {
      vscode.window.showInformationMessage('No executable scripts found.');
      return;
    }

    const quickPick = vscode.window.createQuickPick<ScriptItem>();

    quickPick.items = items as ScriptItem[];
    quickPick.placeholder = 'Select a script to execute';
    quickPick.matchOnDescription = true;
    quickPick.ignoreFocusOut = true;

    quickPick.onDidTriggerItemButton(async event => {
      if (!this.isScriptItem(event.item)) return;

      if (!event.item.keepOpen) {
        quickPick.hide();
      }

      await this.runScript(event.item, 'background');

      if (event.item.keepOpen) {
        quickPick.selectedItems = [];
        quickPick.show();
      }
    });

    quickPick.onDidAccept(async () => {
      const selected = quickPick.selectedItems[0];

      if (!this.isScriptItem(selected)) return;

      if (!selected.keepOpen) {
        quickPick.hide();
      }

      await this.runScript(selected, 'terminal');

      if (selected.keepOpen) {
        quickPick.selectedItems = [];
        quickPick.show();
      }
    });

    quickPick.show();
  }

  public async runScript(
    item: ScriptItem,
    mode: 'terminal' | 'background' = 'terminal',
  ): Promise<void> {
    if (mode === 'background') {
      await this.runScriptInBackground(item);
      return;
    }

    await this.runScriptInTerminal(item);
  }

  public async stopRunningCommand(): Promise<void> {
    if (!this.runningProcess || !this.runningCommand) {
      vscode.window.showInformationMessage('当前没有正在后台执行的脚本');
      return;
    }

    const displayName = this.runningCommand.displayName;

    this.runningProcess.kill();
    this.runningProcess = undefined;

    this.runningCommand.state = 'cancelled';

    this.lastStatus = {
      type: 'cancelled',
      displayName,
      message: '脚本已取消',
    };

    this.updateScriptStatusBar();
    this.scheduleHideStatus();

    vscode.window.showInformationMessage(`已停止脚本：${displayName}`);
  }

  public clearPackageJsonCache(): void {
    this.packageJsonCache.clear();
  }

  public dispose(): void {
    if (this.statusHideTimer) {
      clearTimeout(this.statusHideTimer);
      this.statusHideTimer = undefined;
    }

    if (this.statusTickTimer) {
      clearInterval(this.statusTickTimer);
      this.statusTickTimer = undefined;
    }

    if (this.runningProcess) {
      this.runningProcess.kill();
      this.runningProcess = undefined;
    }

    this.statusBarItem?.dispose();
    this.statusBarItem = undefined;

    this.packageJsonCache.clear();
  }

  private async runScriptInTerminal(item: ScriptItem): Promise<void> {
    const command = await this.resolveCommand(item);

    if (!command) return;

    const displayName = this.getScriptDisplayName(item);
    const terminal = vscode.window.createTerminal({
      name: `QuickOps: ${displayName}`,
      cwd: item.cwd,
    });

    terminal.show();
    terminal.sendText(command);

    this.lastStatus = {
      type: 'running',
      displayName,
      message: command,
    };

    this.updateScriptStatusBar();
  }

  private async runScriptInBackground(item: ScriptItem): Promise<void> {
    if (this.runningProcess) {
      const action = await vscode.window.showWarningMessage(
        '已有脚本正在后台执行，是否停止后继续？',
        '停止并继续',
        '取消',
      );

      if (action !== '停止并继续') return;

      await this.stopRunningCommand();
    }

    const command = await this.resolveCommand(item);

    if (!command) return;

    const displayName = this.getScriptDisplayName(item);
    const commandId = ++this.commandSeq;

    const shell =
      process.platform === 'win32'
        ? process.env.ComSpec || 'cmd.exe'
        : process.env.SHELL || '/bin/sh';

    const shellArgs =
      process.platform === 'win32'
        ? ['/d', '/s', '/c', command]
        : ['-lc', command];

    const child = spawn(shell, shellArgs, {
      cwd: item.cwd,
      env: process.env,
    });

    this.runningProcess = child;

    this.runningCommand = {
      id: commandId,
      displayName,
      command,
      cwd: item.cwd,
      startedAt: Date.now(),
      output: [],
      state: 'running',
    };

    this.lastStatus = {
      type: 'running',
      displayName,
      message: command,
    };

    this.ensureStatusTicker();
    this.updateScriptStatusBar();

    child.stdout.on('data', chunk => {
      this.appendCommandOutput(chunk);
    });

    child.stderr.on('data', chunk => {
      this.appendCommandOutput(chunk);
    });

    child.on('error', error => {
      if (!this.runningCommand || this.runningCommand.id !== commandId) return;

      this.runningCommand.state = 'failed';
      this.runningCommand.errorMessage = error.message;

      this.lastStatus = {
        type: 'failed',
        displayName,
        message: error.message,
      };

      this.runningProcess = undefined;
      this.stopStatusTicker();
      this.updateScriptStatusBar();

      vscode.window.showErrorMessage(`脚本执行失败：${displayName}\n${error.message}`);
      this.scheduleHideStatus();
    });

    child.on('close', code => {
      if (!this.runningCommand || this.runningCommand.id !== commandId) return;

      this.runningCommand.exitCode = code;

      if (code === 0) {
        this.runningCommand.state = 'success';

        this.lastStatus = {
          type: 'success',
          displayName,
          message: '脚本执行完成',
        };

        vscode.window.showInformationMessage(`脚本执行完成：${displayName}`);
      } else {
        this.runningCommand.state = 'failed';

        const output = this.runningCommand.output.join('').trim();
        const message = this.getCommandErrorMessage(code, output, command);

        this.runningCommand.errorMessage = message;

        this.lastStatus = {
          type: 'failed',
          displayName,
          message,
        };

        vscode.window.showErrorMessage(message);
      }

      this.runningProcess = undefined;
      this.stopStatusTicker();
      this.updateScriptStatusBar();
      this.scheduleHideStatus();
    });
  }

  private async resolveCommand(item: ScriptItem): Promise<string | undefined> {
    if (!item.isNpmScript) {
      return item.commandToExecute;
    }

    const manager = await this.selectPackageManager(item.cwd);

    if (!manager) return undefined;

    if (manager === 'npm') {
      return `npm run ${item.commandToExecute}`;
    }

    if (manager === 'yarn') {
      return `yarn ${item.commandToExecute}`;
    }

    if (manager === 'pnpm') {
      return `pnpm ${item.commandToExecute}`;
    }

    return `bun run ${item.commandToExecute}`;
  }

  private async selectPackageManager(cwd: string): Promise<PackageManager | undefined> {
    const managers: Array<{
      name: PackageManager;
      lock: string;
    }> = [
      {
        name: 'pnpm',
        lock: 'pnpm-lock.yaml',
      },
      {
        name: 'yarn',
        lock: 'yarn.lock',
      },
      {
        name: 'bun',
        lock: 'bun.lockb',
      },
      {
        name: 'npm',
        lock: 'package-lock.json',
      },
    ];

    const cwdUri = vscode.Uri.file(cwd);

    const detected = (
      await Promise.all(
        managers.map(async manager => {
          try {
            await vscode.workspace.fs.stat(vscode.Uri.joinPath(cwdUri, manager.lock));
            return manager;
          } catch {
            return undefined;
          }
        }),
      )
    ).filter(Boolean) as Array<{
      name: PackageManager;
      lock: string;
    }>;

    if (detected.length === 0) {
      return 'npm';
    }

    const items: vscode.QuickPickItem[] = [];

    for (const manager of detected) {
      items.push({
        label: manager.name,
        description: `Detected ${manager.lock}`,
        picked: true,
      });
    }

    items.push({
      label: '',
      kind: vscode.QuickPickItemKind.Separator,
    });

    const detectedNames = detected.map(item => item.name);

    for (const name of ['npm', 'pnpm', 'yarn', 'bun'] as PackageManager[]) {
      if (!detectedNames.includes(name)) {
        items.push({
          label: name,
          description: name === 'npm' ? 'Default' : 'Force use',
        });
      }
    }

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select package manager',
      ignoreFocusOut: true,
    });

    return selected?.label as PackageManager | undefined;
  }

  private async findPackageJson(startUri: vscode.Uri): Promise<PackageJsonInfo | undefined> {
    const cacheKey = startUri.toString();

    if (this.packageJsonCache.has(cacheKey)) {
      return this.packageJsonCache.get(cacheKey);
    }

    let currentUri = startUri;

    while (true) {
      const packageJsonUri = vscode.Uri.joinPath(currentUri, 'package.json');

      try {
        await vscode.workspace.fs.stat(packageJsonUri);

        const contentUint8 = await vscode.workspace.fs.readFile(packageJsonUri);
        const content = this.decoder.decode(contentUint8);
        const packageJson = JSON.parse(content);
        const dirUri = vscode.Uri.joinPath(packageJsonUri, '..');

        const info: PackageJsonInfo = {
          name: packageJson.name || 'Project',
          uri: packageJsonUri,
          dirUri,
          dirPath: dirUri.fsPath,
          scripts: packageJson.scripts || {},
        };

        this.packageJsonCache.set(cacheKey, info);
        return info;
      } catch {
        const parentUri = vscode.Uri.joinPath(currentUri, '..');

        if (parentUri.toString() === currentUri.toString()) {
          this.packageJsonCache.set(cacheKey, undefined);
          return undefined;
        }

        currentUri = parentUri;
      }
    }
  }

  private getStartUri(): vscode.Uri | undefined {
    const activeEditor = vscode.window.activeTextEditor;

    if (activeEditor) {
      return vscode.Uri.joinPath(activeEditor.document.uri, '..');
    }

    const firstWorkspace = vscode.workspace.workspaceFolders?.[0];

    return firstWorkspace?.uri;
  }

  private loadWorkspaceScripts(rootPath: string, ctx: IWorkspaceContext): ScriptItem[] {
    const config = this.configurationService.config as any;
    const shells = config.shells || [];

    if (!Array.isArray(shells) || shells.length === 0) {
      return [];
    }

    return this.processShellItems(shells, ctx, rootPath, 'workspace-config');
  }

  private async loadExtensionShellScripts(
    ctx: IWorkspaceContext,
    cwd: string,
  ): Promise<Array<ScriptItem | vscode.QuickPickItem>> {
    const result: Array<ScriptItem | vscode.QuickPickItem> = [];
    const shellResourceUri = vscode.Uri.joinPath(
      this.extensionContextProvider.extensionUri,
      'resources',
      'shell',
    );

    try {
      const entries = await vscode.workspace.fs.readDirectory(shellResourceUri);

      const shellFiles = entries.filter(([name, type]) => {
        return type === vscode.FileType.File && name.endsWith('.json');
      });

      for (const [name] of shellFiles) {
        try {
          const fileUri = vscode.Uri.joinPath(shellResourceUri, name);
          const contentUint8 = await vscode.workspace.fs.readFile(fileUri);
          const content = this.decoder.decode(contentUint8);
          const jsonItems: ShellConfigItem[] = JSON.parse(content);

          if (!Array.isArray(jsonItems) || jsonItems.length === 0) {
            continue;
          }

          const validShellItems = this.processShellItems(
            jsonItems,
            ctx,
            cwd,
            'extension-shell',
          );

          if (validShellItems.length > 0) {
            result.push({
              label: `Extension: ${name}`,
              kind: vscode.QuickPickItemKind.Separator,
            });

            result.push(...validShellItems);
          }
        } catch (error) {
          console.error(`[PackageScripts] Error parsing shell file ${name}:`, error);
        }
      }
    } catch {
      // 没有 resources/shell 目录时忽略
    }

    return result;
  }

  private processShellItems(
    jsonItems: ShellConfigItem[],
    ctx: IWorkspaceContext,
    cwd: string,
    source: ScriptItem['source'],
  ): ScriptItem[] {
    const validItems: ScriptItem[] = [];

    for (const item of jsonItems) {
      const rawCommand = item.cmd || item.command;

      if (!rawCommand) continue;

      const rendered = this.renderTemplate(rawCommand, ctx);

      if (!rendered.result) continue;

      validItems.push(
        this.createScriptItem({
          label: item.label || item.description || rendered.result,
          description: rendered.result,
          commandToExecute: rendered.result,
          cwd,
          isNpmScript: false,
          source,
          payload: rendered.payload,
          keepOpen: item.keepOpen ?? false,
        }),
      );
    }

    return validItems;
  }

  private renderTemplate(
    template: string,
    ctx: IWorkspaceContext,
  ): {
    result: string;
    payload?: Record<string, unknown>;
  } {
    try {
      const rendered = TemplateEngine.render(template, ctx);

      if (rendered.status === 'empty' || rendered.status === 'missing') {
        return {
          result: '',
        };
      }

      return {
        result: rendered.result,
        payload: rendered.payload,
      };
    } catch {
      return {
        result: template,
      };
    }
  }

  private createScriptItem(options: {
    label: string;
    description: string;
    commandToExecute: string;
    cwd: string;
    isNpmScript: boolean;
    source: ScriptItem['source'];
    payload?: Record<string, unknown>;
    keepOpen?: boolean;
  }): ScriptItem {
    return {
      label: `$(terminal) ${options.label}`,
      description: options.description,
      commandToExecute: options.commandToExecute,
      cwd: options.cwd,
      isNpmScript: options.isNpmScript,
      source: options.source,
      payload: options.payload,
      keepOpen: options.keepOpen,
      buttons: [
        {
          iconPath: new vscode.ThemeIcon('debug-start'),
          tooltip: '后台执行',
        },
      ],
    };
  }

  private async getTemplateContext(
    packageJsonInfo?: PackageJsonInfo,
  ): Promise<IWorkspaceContext> {
    const activeEditor = vscode.window.activeTextEditor;
    const workspaceFolder = activeEditor
      ? vscode.workspace.getWorkspaceFolder(activeEditor.document.uri)
      : vscode.workspace.workspaceFolders?.[0];

    const fileUri = activeEditor?.document.uri;
    const filePath = fileUri?.fsPath || '';
    const parsedPath = path.parse(filePath);

    const fileName = parsedPath.base || '';
    const fileNameBase = parsedPath.name || '';
    const fileExt = parsedPath.ext || '';
    const dirName = parsedPath.dir ? path.basename(parsedPath.dir) : '';

    const relativePath = fileUri ? vscode.workspace.asRelativePath(fileUri) : '';

    const rawModuleName =
      fileNameBase.toLowerCase() === 'index' && dirName ? dirName : fileNameBase;

    const moduleName = rawModuleName || '';
    const packageJson = await this.readPackageJson(packageJsonInfo?.uri);

    const dependencies: Record<string, any> = {
      ...(packageJson?.dependencies || {}),
      ...(packageJson?.devDependencies || {}),
    };

    const gitInfo = await this.getGitContext(packageJsonInfo?.dirPath);

    const now = new Date();
    const pad = (num: number) => String(num).padStart(2, '0');

    const dateYear = String(now.getFullYear());
    const dateDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const dateTime = `${dateDate} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(
      now.getSeconds(),
    )}`;

    return {
      fileName,
      fileNameBase,
      fileExt,
      dirName,
      filePath,
      relativePath,

      moduleName,
      baseName: upperFirst(camelCase(moduleName)),
      ModuleName: upperFirst(camelCase(fileNameBase || moduleName)),
      moduleNameCamel: camelCase(moduleName),
      moduleNameKebab: kebabCase(moduleName),
      moduleNameSnake: snakeCase(moduleName),
      moduleNameUpper: snakeCase(moduleName).toUpperCase(),

      projectName: packageJson?.name || workspaceFolder?.name || 'unknown-project',
      projectVersion: packageJson?.version || '0.0.0',
      dependencies,
      hasDependency: (dep: string) => Boolean(dependencies[dep]),

      cssLang: this.resolveCssLang(dependencies),
      isVue3: this.isVue3Project(dependencies),
      isReact: Boolean(dependencies.react),
      isTypeScript: Boolean(dependencies.typescript),

      gitBranch: gitInfo.gitBranch,
      gitRemote: gitInfo.gitRemote,
      gitLocalBranch: gitInfo.gitLocalBranch,
      gitRemoteBranch: gitInfo.gitRemoteBranch,

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
      ],

      userName: gitInfo.userName || os.userInfo().username,

      dateYear,
      dateDate,
      dateTime,
    };
  }

  private async readPackageJson(uri?: vscode.Uri): Promise<any | undefined> {
    if (!uri) return undefined;

    try {
      const contentUint8 = await vscode.workspace.fs.readFile(uri);
      const content = this.decoder.decode(contentUint8);
      return JSON.parse(content);
    } catch {
      return undefined;
    }
  }

  private async getGitContext(cwd?: string): Promise<{
    gitBranch: string;
    gitRemote: string;
    gitLocalBranch: string[];
    gitRemoteBranch: string[];
    userName: string;
  }> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const finalCwd = cwd || workspaceRoot;

    if (!finalCwd) {
      return {
        gitBranch: '',
        gitRemote: '',
        gitLocalBranch: [],
        gitRemoteBranch: [],
        userName: os.userInfo().username,
      };
    }

    const [gitBranch, gitRemote, gitLocalBranch, gitRemoteBranch, userName] =
      await Promise.all([
        this.safeGit(['branch', '--show-current'], finalCwd),
        this.safeGit(['rev-parse', '--abbrev-ref', '@{u}'], finalCwd),
        this.safeGit(['branch', '--format=%(refname:short)'], finalCwd),
        this.safeGit(['branch', '-r', '--format=%(refname:short)'], finalCwd),
        this.safeGit(['config', 'user.name'], finalCwd),
      ]);

    return {
      gitBranch: gitBranch.trim(),
      gitRemote: gitRemote.trim(),
      gitLocalBranch: gitLocalBranch
        .split(/\r?\n/)
        .map(item => item.trim())
        .filter(Boolean),
      gitRemoteBranch: gitRemoteBranch
        .split(/\r?\n/)
        .map(item => item.trim())
        .filter(Boolean),
      userName: userName.trim() || os.userInfo().username,
    };
  }

  private async safeGit(args: string[], cwd: string): Promise<string> {
    try {
      const { stdout } = await execFileAsync('git', args, {
        cwd,
      });

      return stdout;
    } catch {
      return '';
    }
  }

  private resolveCssLang(dependencies: Record<string, any>): 'css' | 'less' | 'scss' {
    if (dependencies.less) return 'less';
    if (dependencies.sass || dependencies.scss) return 'scss';
    return 'css';
  }

  private isVue3Project(dependencies: Record<string, any>): boolean {
    const version = String(dependencies.vue || '');

    return /(^|[^0-9])3\./.test(version);
  }

  private getScriptDisplayName(item: ScriptItem): string {
    return item.label.replace('$(terminal)', '').trim() || item.commandToExecute;
  }

  private initStatusBar(): void {
    if (this.statusBarItem) return;

    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100,
    );

    this.statusBarItem.name = 'Quick Ops Scripts';
    this.statusBarItem.command = 'quickOps.showPackageScripts';

    this.extensionContextProvider.register(this.statusBarItem);
  }

  private updateScriptStatusBar(): void {
    if (!this.statusBarItem) return;

    const status = this.lastStatus;

    if (status.type === 'idle') {
      this.statusBarItem.text = '$(terminal) Q-Ops Scripts';
      this.statusBarItem.tooltip = '打开 Quick Ops 脚本列表';
      this.statusBarItem.show();
      return;
    }

    if (status.type === 'running') {
      const elapsed = this.runningCommand
        ? this.formatElapsed(Date.now() - this.runningCommand.startedAt)
        : '00:00';

      this.statusBarItem.text = `$(sync~spin) ${status.displayName || 'Script'} ${elapsed}`;
      this.statusBarItem.tooltip = this.createRunningTooltip();
      this.statusBarItem.show();
      return;
    }

    if (status.type === 'success') {
      this.statusBarItem.text = `$(check) ${status.displayName || 'Script'}`;
      this.statusBarItem.tooltip = status.message || '脚本执行成功';
      this.statusBarItem.show();
      return;
    }

    if (status.type === 'failed') {
      this.statusBarItem.text = `$(error) ${status.displayName || 'Script'}`;
      this.statusBarItem.tooltip = status.message || '脚本执行失败';
      this.statusBarItem.show();
      return;
    }

    if (status.type === 'cancelled') {
      this.statusBarItem.text = `$(circle-slash) ${status.displayName || 'Script'}`;
      this.statusBarItem.tooltip = status.message || '脚本已取消';
      this.statusBarItem.show();
    }
  }

  private createRunningTooltip(): vscode.MarkdownString {
    const markdown = new vscode.MarkdownString();

    markdown.isTrusted = true;
    markdown.supportThemeIcons = true;

    markdown.appendMarkdown(
      `### $(terminal) ${this.runningCommand?.displayName || 'Script'}\n\n`,
    );

    markdown.appendMarkdown(`命令：\`${this.runningCommand?.command || ''}\`\n\n`);
    markdown.appendMarkdown(`目录：\`${this.runningCommand?.cwd || ''}\`\n\n`);

    markdown.appendMarkdown(
      `[停止脚本](command:quick-ops.packageScripts.stopRunning)\n\n`,
    );

    const output = this.runningCommand?.output.join('').trim();

    if (output) {
      markdown.appendCodeblock(output.slice(-2000), 'bash');
    }

    return markdown;
  }

  private appendCommandOutput(chunk: Buffer | string): void {
    if (!this.runningCommand) return;

    const value = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);

    if (!value) return;

    this.runningCommand.output.push(value);

    const maxLength = 8000;
    let totalLength = this.runningCommand.output.reduce(
      (total, item) => total + item.length,
      0,
    );

    while (totalLength > maxLength && this.runningCommand.output.length > 1) {
      const removed = this.runningCommand.output.shift() || '';
      totalLength -= removed.length;
    }

    this.updateScriptStatusBar();
  }

  private ensureStatusTicker(): void {
    if (this.statusTickTimer) return;

    this.statusTickTimer = setInterval(() => {
      this.updateScriptStatusBar();
    }, 1000);
  }

  private stopStatusTicker(): void {
    if (!this.statusTickTimer) return;

    clearInterval(this.statusTickTimer);
    this.statusTickTimer = undefined;
  }

  private scheduleHideStatus(): void {
    if (this.statusHideTimer) {
      clearTimeout(this.statusHideTimer);
    }

    this.statusHideTimer = setTimeout(() => {
      this.lastStatus = {
        type: 'idle',
      };

      this.updateScriptStatusBar();
    }, 5000);
  }

  private formatElapsed(ms: number): string {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  private getCommandErrorMessage(
    code: number | null,
    output: string,
    command: string,
  ): string {
    const firstLines = output
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .slice(-6)
      .join('\n');

    return `命令执行失败：${command}\n退出码：${code ?? 'unknown'}${
      firstLines ? `\n\n${firstLines}` : ''
    }`;
  }

  private isScriptItem(item: unknown): item is ScriptItem {
    return Boolean(
      item &&
        typeof item === 'object' &&
        'commandToExecute' in item &&
        'cwd' in item,
    );
  }
}