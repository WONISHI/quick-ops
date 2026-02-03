import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { IFeature } from '../core/interfaces/IFeature';
import { WorkspaceContextService } from '../services/WorkspaceContextService';
import { TemplateEngine } from '../utils/TemplateEngine';
import { ConfigurationService } from '../services/ConfigurationService';

export interface ShellConfigItem {
  description: string;
  cmd: string;
  keepOpen?: boolean;
}

// 扩展 QuickPickItem
interface ScriptItem extends vscode.QuickPickItem {
  commandToExecute: string;
  cwd: string;
  isNpmScript: boolean;
  payload?: Record<string, any>;
  keepOpen?: boolean;
}

export class PackageScriptsFeature implements IFeature {
  public readonly id = 'PackageScriptsFeature';
  private statusBarItem: vscode.StatusBarItem | undefined;
  private extensionPath: string = '';

  // 2. 注入配置服务
  private configService: ConfigurationService = ConfigurationService.getInstance();

  constructor(private contextService: WorkspaceContextService = WorkspaceContextService.getInstance()) {}

  public activate(context: vscode.ExtensionContext): void {
    this.extensionPath = context.extensionPath;

    const commandId = 'quick-ops.showPackageScripts';
    context.subscriptions.push(vscode.commands.registerCommand(commandId, this.showScripts.bind(this)));

    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.statusBarItem.command = commandId;
    this.statusBarItem.text = '$(play) Scripts';
    this.statusBarItem.tooltip = '查看并执行常用脚本';
    this.statusBarItem.show();
    context.subscriptions.push(this.statusBarItem);

    console.log(`[${this.id}] Activated.`);
  }

  /**
   * 显示脚本列表的主逻辑
   */
  private async showScripts() {
    const items: (ScriptItem | vscode.QuickPickItem)[] = [];
    const workspaceFolders = vscode.workspace.workspaceFolders;
    const rootPath = workspaceFolders ? workspaceFolders[0].uri.fsPath : '';

    // 获取上下文用于模板解析
    const ctx = this.contextService.context;

    // 1. 读取 package.json 中的 npm scripts
    // (npm scripts 还是需要读取 package.json，因为这通常不属于插件的 config)
    if (rootPath) {
      const packageJsonPath = path.join(rootPath, 'package.json');
      if (fs.existsSync(packageJsonPath)) {
        try {
          const content = await fs.promises.readFile(packageJsonPath, 'utf-8');
          const packageJson = JSON.parse(content);
          const scripts = packageJson.scripts || {};
          const scriptNames = Object.keys(scripts);

          if (scriptNames.length > 0) {
            items.push({
              label: 'NPM Scripts (package.json)',
              kind: vscode.QuickPickItemKind.Separator,
            });

            scriptNames.forEach((name) => {
              items.push(this.createScriptItem(name, scripts[name], name, rootPath, true, undefined, false));
            });
          }
        } catch (e) {
          console.error('Error parsing package.json', e);
        }
      }

      // 2. 读取工作区自定义配置
      // 这里不再手动读文件，而是从 ConfigurationService 获取
      const workspaceScripts = this.loadWorkspaceScripts(rootPath, ctx);

      if (workspaceScripts.length > 0) {
        items.push({
          label: 'Workspace Custom Scripts',
          kind: vscode.QuickPickItemKind.Separator,
        });
        items.push(...workspaceScripts);
      }
    }

    const shellResourceDir = path.join(this.extensionPath, 'resources', 'shell');

    let shellDirExists = false;
    try {
      const stats = await fs.promises.stat(shellResourceDir);
      shellDirExists = stats.isDirectory();
    } catch (e) {
      console.log(e);
    }

    if (shellDirExists) {
      try {
        const files = (await fs.promises.readdir(shellResourceDir)).filter((file) => file.endsWith('.json'));

        // 异步读取每个文件的内容
        for (const file of files) {
          const filePath = path.join(shellResourceDir, file);
          try {
            const content = await fs.promises.readFile(filePath, 'utf-8');
            const jsonItems: ShellConfigItem[] = JSON.parse(content);

            if (Array.isArray(jsonItems) && jsonItems.length > 0) {
              const validShellItems = this.processShellItems(jsonItems, ctx, rootPath || this.extensionPath);

              if (validShellItems.length > 0) {
                items.push({ label: `Extension: ${file}`, kind: vscode.QuickPickItemKind.Separator });
                items.push(...validShellItems);
              }
            }
          } catch (err) {
            console.error(`Error parsing shell file ${file}:`, err);
          }
        }
      } catch (err) {
        console.error('Error reading resources/shell directory:', err);
      }
    }

    if (items.length === 0) {
      vscode.window.showInformationMessage('未找到任何可执行脚本');
      return;
    }

    // 4. 创建 QuickPick
    const quickPick = vscode.window.createQuickPick<ScriptItem>();
    quickPick.items = items as ScriptItem[];
    quickPick.placeholder = '选择要执行的指令';
    quickPick.matchOnDescription = true;
    quickPick.ignoreFocusOut = true;

    quickPick.onDidTriggerItemButton(async (e) => {
      const isNewTerminal = e.button.tooltip === '在新终端执行';
      await this.runScript(e.item, isNewTerminal);
      if (!e.item.keepOpen) quickPick.hide();
    });

    quickPick.onDidAccept(async () => {
      const selected = quickPick.selectedItems[0];
      if (selected) {
        await this.runScript(selected, false);
        if (!selected.keepOpen) {
          quickPick.hide();
        } else {
          quickPick.selectedItems = [];
          quickPick.show();
        }
      }
    });

    quickPick.show();
  }

  /**
   * 【修改】从 ConfigurationService 获取配置
   */
  private loadWorkspaceScripts(rootPath: string, ctx: any): ScriptItem[] {
    // 直接读取内存中的配置对象
    // 假设 ConfigurationService 已经负责监听文件变化并更新 config 对象
    const shells = this.configService.config.shells;

    if (Array.isArray(shells) && shells.length > 0) {
      // 复用 processShellItems 将配置对象转换为 QuickPickItem
      return this.processShellItems(shells, ctx, rootPath);
    }

    return [];
  }

  /**
   * 统一处理 ShellConfigItem 数组转 ScriptItem 数组的逻辑
   */
  private processShellItems(jsonItems: ShellConfigItem[], ctx: any, cwd: string): ScriptItem[] {
    const validItems: ScriptItem[] = [];

    jsonItems.forEach((item) => {
      // 模板解析
      const { result, payload, status } = TemplateEngine.render(item.cmd, ctx);

      if (status === 'empty' || status === 'missing') {
        return;
      }

      validItems.push(this.createScriptItem(item.description, result, result, cwd, false, payload, item.keepOpen));
    });

    return validItems;
  }

  private createScriptItem(label: string, description: string, commandToExecute: string, cwd: string, isNpmScript: boolean, payload?: Record<string, any>, keepOpen: boolean = false): ScriptItem {
    return {
      label: `$(terminal) ${label}`,
      description: description,
      commandToExecute: commandToExecute,
      cwd: cwd,
      isNpmScript: isNpmScript,
      payload: payload,
      keepOpen: keepOpen,
      buttons: [
        { iconPath: new vscode.ThemeIcon('debug-start'), tooltip: '在当前终端执行' },
        { iconPath: new vscode.ThemeIcon('add'), tooltip: '在新终端执行' },
      ],
    };
  }

  private async selectPackageManager(cwd: string): Promise<string | undefined> {
    const managers = [
      { name: 'pnpm', lock: 'pnpm-lock.yaml' },
      { name: 'yarn', lock: 'yarn.lock' },
      { name: 'bun', lock: 'bun.lockb' },
      { name: 'npm', lock: 'package-lock.json' },
    ];

    const detected = managers.filter((m) => fs.existsSync(path.join(cwd, m.lock)));
    const items: vscode.QuickPickItem[] = [];

    if (detected.length > 0) {
      detected.forEach((m) => items.push({ label: m.name, description: `检测到 ${m.lock} (推荐)`, picked: true }));
      items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
    }

    const detectedNames = detected.map((d) => d.name);
    if (!detectedNames.includes('npm')) items.push({ label: 'npm', description: '默认工具' });

    ['pnpm', 'yarn', 'bun'].forEach((name) => {
      if (!detectedNames.includes(name)) items.push({ label: name, description: '强制使用' });
    });

    if (detected.length === 0) return 'npm';

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: '选择要使用的包管理器执行脚本',
      ignoreFocusOut: true,
    });

    return selected ? selected.label : undefined;
  }

  private async runScript(item: ScriptItem, newTerminal: boolean) {
    let finalCommand = item.commandToExecute;

    if (item.payload && Object.keys(item.payload).length > 0) {
      for (const [key, value] of Object.entries(item.payload)) {
        if (Array.isArray(value)) {
          const choice = await vscode.window.showQuickPick(value.map(String), {
            placeHolder: `请选择 ${key} 的值`,
            ignoreFocusOut: true,
          });
          if (!choice) return;
          finalCommand = finalCommand.replace(new RegExp(`\\[\\[\\s*${key}\\s*\\]\\]`, 'g'), choice);
        }
      }
    }

    if (item.isNpmScript) {
      const packageManager = await this.selectPackageManager(item.cwd);
      if (!packageManager) return;
      finalCommand = `${packageManager}${packageManager === 'yarn' ? ` ${finalCommand}` : ` run ${finalCommand}`}`;
    }

    let terminal: vscode.Terminal;
    if (newTerminal) {
      terminal = vscode.window.createTerminal({
        name: `Ops: ${item.label.replace('$(terminal) ', '')}`,
        cwd: item.cwd,
      });
    } else {
      terminal =
        vscode.window.activeTerminal ||
        vscode.window.createTerminal({
          name: 'Terminal',
          cwd: item.cwd,
        });
    }

    terminal.show();
    terminal.sendText(finalCommand);
  }
}
