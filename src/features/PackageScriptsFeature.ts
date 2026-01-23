import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { IFeature } from '../core/interfaces/IFeature';
import { WorkspaceContextService } from '../services/WorkspaceContextService';
import { TemplateEngine } from '../utils/TemplateEngine';

// 定义 JSON 文件的结构接口
interface ShellConfigItem {
  description: string;
  cmd: string;
  keepOpen?: boolean; // 配置是否保持窗口打开 (例如 git status)
}

// 扩展 QuickPickItem，增加自定义字段
interface ScriptItem extends vscode.QuickPickItem {
  commandToExecute: string; // 实际要运行的命令字符串（包含占位符）
  cwd: string; // 执行目录
  isNpmScript: boolean; // 标记：true=npm run xxx, false=直接执行 shell 指令
  payload?: Record<string, any>; // 存储解析出来的数组参数 (供二次选择)
  keepOpen?: boolean; // 是否在执行后保持 QuickPick 打开
}

export class PackageScriptsFeature implements IFeature {
  public readonly id = 'PackageScriptsFeature';
  private statusBarItem: vscode.StatusBarItem | undefined;
  private extensionPath: string = '';

  constructor(private contextService: WorkspaceContextService = WorkspaceContextService.getInstance()) {}

  public activate(context: vscode.ExtensionContext): void {
    this.extensionPath = context.extensionPath;

    const commandId = 'quick-ops.showPackageScripts';
    context.subscriptions.push(vscode.commands.registerCommand(commandId, this.showScripts.bind(this)));

    // 创建底部状态栏按钮
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

    // 1. 读取 package.json 中的 npm scripts
    if (rootPath) {
      const packageJsonPath = path.join(rootPath, 'package.json');
      if (fs.existsSync(packageJsonPath)) {
        try {
          const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
          const scripts = packageJson.scripts || {};
          const scriptNames = Object.keys(scripts);

          if (scriptNames.length > 0) {
            items.push({
              label: 'Project Scripts (package.json)',
              kind: vscode.QuickPickItemKind.Separator,
            });

            scriptNames.forEach((name) => {
              // npm 脚本默认不保持窗口打开 (keepOpen: false)
              items.push(this.createScriptItem(name, scripts[name], name, rootPath, true, undefined, false));
            });
          }
        } catch (e) {
          console.error('Error parsing package.json', e);
        }
      }
    }

    // 2. 读取 resources/shell 下的 JSON 配置
    const shellResourceDir = path.join(this.extensionPath, 'resources', 'shell');
    const ctx = this.contextService.context;

    if (fs.existsSync(shellResourceDir)) {
      try {
        const files = fs.readdirSync(shellResourceDir).filter((file) => file.endsWith('.json'));

        for (const file of files) {
          const filePath = path.join(shellResourceDir, file);
          try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const jsonItems: ShellConfigItem[] = JSON.parse(content);

            if (Array.isArray(jsonItems) && jsonItems.length > 0) {
              const validShellItems: ScriptItem[] = [];

              jsonItems.forEach((item) => {
                // 调用模板引擎解析指令
                const { result, payload, status } = TemplateEngine.render(item.cmd, ctx);

                // 过滤：如果缺失变量或数据为空，则不显示该指令
                if (status === 'empty' || status === 'missing') {
                  return;
                }

                // 加入列表
                validShellItems.push(
                  this.createScriptItem(
                    item.description,
                    result,
                    result,
                    rootPath || this.extensionPath,
                    false, 
                    payload,
                    item.keepOpen,
                  ),
                );
              });

              if (validShellItems.length > 0) {
                items.push({ label: file, kind: vscode.QuickPickItemKind.Separator });
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

    // 3. 创建 QuickPick
    const quickPick = vscode.window.createQuickPick<ScriptItem>();
    quickPick.items = items as ScriptItem[];
    quickPick.placeholder = '选择要执行的指令';
    quickPick.matchOnDescription = true;

    // 🔥🔥 关键修复 1: 防止 terminal.show() 抢走焦点导致窗口关闭
    // 开启此项后，即使焦点跳到终端，列表框也会保持在顶部，直到用户按 Esc
    quickPick.ignoreFocusOut = true;

    // 事件：点击右侧图标按钮（例如“在新终端执行”）
    quickPick.onDidTriggerItemButton(async (e) => {
      const isNewTerminal = e.button.tooltip === '在新终端执行';
      await this.runScript(e.item, isNewTerminal);

      if (!e.item.keepOpen) {
        quickPick.hide();
      }
    });

    // 事件：选中列表项（回车或点击）
    quickPick.onDidAccept(async () => {
      const selected = quickPick.selectedItems[0];
      if (selected) {
        // 🔥🔥 关键修复 2: 使用 await 等待脚本执行完毕
        // 如果脚本里有二级弹窗（选分支），主列表会被暂时覆盖，await 保证执行完回来再决定显隐
        await this.runScript(selected, false);

        if (!selected.keepOpen) {
          quickPick.hide();
        } else {
          // 🔥🔥 关键修复 3: 重置选中状态并重新显示
          // 如果不重置，列表会一直显示刚才选中的项，体验不好
          quickPick.selectedItems = [];

          // 确保窗口可见（防止被二级弹窗覆盖后没回来）
          quickPick.show();
        }
      }
    });

    quickPick.show();
  }

  /**
   * 辅助方法：创建 ScriptItem 对象
   */
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
        {
          iconPath: new vscode.ThemeIcon('debug-start'),
          tooltip: '在当前终端执行',
        },
        {
          iconPath: new vscode.ThemeIcon('add'),
          tooltip: '在新终端执行',
        },
      ],
    };
  }

  /**
   * 自动检测或让用户选择包管理器
   */
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
      detected.forEach((m) =>
        items.push({
          label: m.name,
          description: `检测到 ${m.lock} (推荐)`,
          picked: true,
        }),
      );
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

  /**
   * 执行脚本的核心逻辑
   */
  private async runScript(item: ScriptItem, newTerminal: boolean) {
    let finalCommand = item.commandToExecute;

    // 1. 处理数组参数 (需要二次选择的情况)
    if (item.payload && Object.keys(item.payload).length > 0) {
      for (const [key, value] of Object.entries(item.payload)) {
        if (Array.isArray(value)) {
          // 弹出选择框
          const choice = await vscode.window.showQuickPick(value.map(String), {
            placeHolder: `请选择 ${key} 的值`,
            ignoreFocusOut: true, // 二级弹窗也防止失焦关闭
          });

          if (!choice) return; // 用户取消

          finalCommand = finalCommand.replace(new RegExp(`\\[\\[\\s*${key}\\s*\\]\\]`, 'g'), choice);
        }
      }
    }

    // 2. 处理 NPM 脚本
    if (item.isNpmScript) {
      const packageManager = await this.selectPackageManager(item.cwd);
      if (!packageManager) return;
      finalCommand = `${packageManager} run ${finalCommand}`;
    }

    // 3. 执行
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

    terminal.show(); // 这一行会抢走焦点，但因为有了 ignoreFocusOut，QuickPick 不会关
    terminal.sendText(finalCommand);
  }
}
