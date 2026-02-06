import * as vscode from 'vscode';
import { TextDecoder } from 'util'; // 用于将 Uint8Array 转为 string
import { IFeature } from '../core/interfaces/IFeature';
import { WorkspaceContextService } from '../services/WorkspaceContextService';
import { TemplateEngine } from '../utils/TemplateEngine';
import { ConfigurationService } from '../services/ConfigurationService';
import type { ShellConfigItem, ScriptItem } from '../core/types/package-script';

export class PackageScriptsFeature implements IFeature {
  public readonly id = 'PackageScriptsFeature';
  private statusBarItem: vscode.StatusBarItem | undefined;

  // 1. 改用 Uri 类型存储扩展路径
  private extensionUri!: vscode.Uri;

  private configService: ConfigurationService = ConfigurationService.getInstance();

  constructor(private contextService: WorkspaceContextService = WorkspaceContextService.getInstance()) {}

  public activate(context: vscode.ExtensionContext): void {
    // 2. 获取 extensionUri
    this.extensionUri = context.extensionUri;

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

  private async showScripts() {
    const items: (ScriptItem | vscode.QuickPickItem)[] = [];
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const rootUri = workspaceFolder?.uri;
    const ctx = this.contextService.context;
    const decoder = new TextDecoder('utf-8');

    // 1. 读取 package.json (使用 VS Code FS)
    if (rootUri) {
      const packageJsonUri = vscode.Uri.joinPath(rootUri, 'package.json');
      try {
        const contentUint8 = await vscode.workspace.fs.readFile(packageJsonUri);
        const content = decoder.decode(contentUint8);
        const packageJson = JSON.parse(content);
        const scripts = packageJson.scripts || {};
        const scriptNames = Object.keys(scripts);

        if (scriptNames.length > 0) {
          items.push({
            label: 'NPM Scripts (package.json)',
            kind: vscode.QuickPickItemKind.Separator,
          });

          scriptNames.forEach((name) => {
            // 注意：这里 cwd 依然传 string (fsPath)，因为 ScriptItem 接口和终端创建需要 string
            items.push(this.createScriptItem(name, scripts[name], name, rootUri.fsPath, true, undefined, false));
          });
        }
      } catch (e: any) {
        // 文件不存在 (FileNotFound) 忽略，其他错误打印
        if (e.code !== 'FileNotFound' && e.code !== 'ENOENT') {
          console.error('Error parsing package.json', e);
        }
      }

      // 2. 读取工作区自定义配置
      const workspaceScripts = this.loadWorkspaceScripts(rootUri.fsPath, ctx);
      if (workspaceScripts.length > 0) {
        items.push({
          label: 'Workspace Custom Scripts',
          kind: vscode.QuickPickItemKind.Separator,
        });
        items.push(...workspaceScripts);
      }
    }

    // 3. 读取插件内置资源 (使用 VS Code FS)
    const shellResourceUri = vscode.Uri.joinPath(this.extensionUri, 'resources', 'shell');

    try {
      const entries = await vscode.workspace.fs.readDirectory(shellResourceUri);

      // 优化：并发读取
      const fileReadPromises = entries
        .filter(([name, type]) => type === vscode.FileType.File && name.endsWith('.json'))
        .map(async ([name]) => {
          try {
            const fileUri = vscode.Uri.joinPath(shellResourceUri, name);
            const contentUint8 = await vscode.workspace.fs.readFile(fileUri);
            const content = decoder.decode(contentUint8);

            const jsonItems: ShellConfigItem[] = JSON.parse(content);
            if (Array.isArray(jsonItems) && jsonItems.length > 0) {
              const validShellItems = this.processShellItems(jsonItems, ctx, rootUri ? rootUri.fsPath : this.extensionUri.fsPath);
              if (validShellItems.length > 0) {
                return { file: name, items: validShellItems };
              }
            }
          } catch (err) {
            console.error(`Error parsing shell file ${name}:`, err);
          }
          return null;
        });

      const results = await Promise.all(fileReadPromises);

      results.forEach((res) => {
        if (res) {
          items.push({ label: `Extension: ${res.file}`, kind: vscode.QuickPickItemKind.Separator });
          items.push(...res.items);
        }
      });
    } catch (err) {
      // 目录不存在忽略
    }

    if (items.length === 0) {
      vscode.window.showInformationMessage('未找到任何可执行脚本');
      return;
    }

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

  private loadWorkspaceScripts(rootPath: string, ctx: any): ScriptItem[] {
    const shells = this.configService.config.shells;
    if (Array.isArray(shells) && shells.length > 0) {
      return this.processShellItems(shells, ctx, rootPath);
    }
    return [];
  }

  private processShellItems(jsonItems: ShellConfigItem[], ctx: any, cwd: string): ScriptItem[] {
    const validItems: ScriptItem[] = [];
    jsonItems.forEach((item) => {
      const { result, payload, status } = TemplateEngine.render(item.cmd, ctx);
      if (status === 'empty' || status === 'missing') return;
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

    // 辅助函数：尝试将 cwd 字符串转回 Uri，以支持远程环境检查
    const getCwdUri = (cwdPath: string): vscode.Uri => {
      const ws = vscode.workspace.workspaceFolders?.find((w) => w.uri.fsPath === cwdPath);
      return ws ? ws.uri : vscode.Uri.file(cwdPath);
    };

    const cwdUri = getCwdUri(cwd);

    // 优化：使用 Promise.all 并发检查，替换 fs.existsSync
    const checkPromises = managers.map(async (m) => {
      try {
        const lockUri = vscode.Uri.joinPath(cwdUri, m.lock);
        // 使用 stat 检查文件是否存在
        await vscode.workspace.fs.stat(lockUri);
        return m;
      } catch {
        return null;
      }
    });

    const results = await Promise.all(checkPromises);
    const detected = results.filter((m): m is (typeof managers)[0] => m !== null);

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
      if (vscode.window.activeTerminal) {
        terminal = vscode.window.activeTerminal;
        terminal.sendText('\u0003'); // Ctrl+C
      } else {
        terminal = vscode.window.createTerminal({
          name: 'Terminal',
          cwd: item.cwd,
        });
      }
    }

    terminal.show();
    terminal.sendText(finalCommand);
  }
}
