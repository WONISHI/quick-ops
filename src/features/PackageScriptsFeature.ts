import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { IFeature } from '../core/interfaces/IFeature';

// 定义 JSON 文件的结构接口
interface ShellConfigItem {
  description: string;
  cmd: string;
}

// 扩展 QuickPickItem
interface ScriptItem extends vscode.QuickPickItem {
  commandToExecute: string; // 实际要运行的命令字符串
  cwd: string; // 执行目录
  isNpmScript: boolean; // 标记：true=npm run xxx, false=直接执行
}

export class PackageScriptsFeature implements IFeature {
  public readonly id = 'PackageScriptsFeature';
  private statusBarItem: vscode.StatusBarItem | undefined;
  private extensionPath: string = '';

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

  private async showScripts() {
    const items: (ScriptItem | vscode.QuickPickItem)[] = [];
    const workspaceFolders = vscode.workspace.workspaceFolders;
    const rootPath = workspaceFolders ? workspaceFolders[0].uri.fsPath : '';

    // 1. 读取 package.json
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
              items.push(
                this.createScriptItem(
                  name,
                  scripts[name],
                  name, // npm run 的名字
                  rootPath,
                  true, // isNpmScript
                ),
              );
            });
          }
        } catch (e) {
          console.error('Error parsing package.json', e);
        }
      }
    }

    // 2. 读取 resources/shell 下的 JSON
    const shellResourceDir = path.join(this.extensionPath, 'resources', 'shell');

    if (fs.existsSync(shellResourceDir)) {
      try {
        const files = fs.readdirSync(shellResourceDir).filter((file) => file.endsWith('.json'));
        for (const file of files) {
          const filePath = path.join(shellResourceDir, file);
          try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const jsonItems: ShellConfigItem[] = JSON.parse(content);
            if (Array.isArray(jsonItems) && jsonItems.length > 0) {
              items.push({ label: file, kind: vscode.QuickPickItemKind.Separator });
              jsonItems.forEach((item) => {
                items.push(this.createScriptItem(item.description, item.cmd, item.cmd, rootPath || this.extensionPath, false));
              });
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

    // 3. 显示 QuickPick
    const quickPick = vscode.window.createQuickPick<ScriptItem>();
    quickPick.items = items as ScriptItem[];
    quickPick.placeholder = '选择要执行的指令';
    quickPick.matchOnDescription = true;

    quickPick.onDidTriggerItemButton((e) => {
      const isNewTerminal = e.button.tooltip === '在新终端执行';
      this.runScript(e.item, isNewTerminal);
      quickPick.hide();
    });

    quickPick.onDidAccept(() => {
      const selected = quickPick.selectedItems[0];
      if (selected) {
        this.runScript(selected, false);
        quickPick.hide();
      }
    });

    quickPick.show();
  }

  private createScriptItem(label: string, description: string, commandToExecute: string, cwd: string, isNpmScript: boolean): ScriptItem {
    return {
      label: `$(terminal) ${label}`,
      description: description,
      commandToExecute: commandToExecute,
      cwd: cwd,
      isNpmScript: isNpmScript,
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
   * 核心修改：检测并选择包管理器
   */
  private async selectPackageManager(cwd: string): Promise<string | undefined> {
    // 定义已知管理器及其对应的锁文件
    const managers = [
      { name: 'pnpm', lock: 'pnpm-lock.yaml' },
      { name: 'yarn', lock: 'yarn.lock' },
      { name: 'bun', lock: 'bun.lockb' },
      { name: 'npm', lock: 'package-lock.json' },
    ];

    // 检测存在的锁文件
    const detected = managers.filter((m) => fs.existsSync(path.join(cwd, m.lock)));

    // 构建 QuickPick 选项
    const items: vscode.QuickPickItem[] = [];

    // 1. 添加检测到的推荐项
    if (detected.length > 0) {
      detected.forEach((m) => {
        items.push({
          label: m.name,
          description: `检测到 ${m.lock} (推荐)`,
          detail: '基于锁文件自动匹配',
          picked: true, // 默认选中第一个检测到的
        });
      });
      items.push({ label: '', kind: vscode.QuickPickItemKind.Separator }); // 分隔线
    }

    // 2. 添加所有可用项（防止用户想强制使用其他管理器）
    // 过滤掉已经在推荐列表里的，避免重复，或者简单地列出 npm 作为保底
    const detectedNames = detected.map((d) => d.name);

    // 始终确保 npm 可选 (如果不在推荐列表里)
    if (!detectedNames.includes('npm')) {
      items.push({ label: 'npm', description: '默认工具' });
    }
    // 添加其他常见工具作为备选
    ['pnpm', 'yarn', 'bun'].forEach((name) => {
      if (!detectedNames.includes(name)) {
        items.push({ label: name, description: '强制使用' });
      }
    });

    // 如果没有检测到任何锁文件，直接默认 npm，不弹窗（减少打扰），或者你可以选择弹窗
    // 这里采取：如果只有一个选项且是 npm（未检测到锁），直接返回 'npm'
    if (detected.length === 0) {
      return 'npm';
    }

    // 弹出选择框
    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: '选择要使用的包管理器执行脚本',
      ignoreFocusOut: true,
    });

    return selected ? selected.label : undefined;
  }

  /**
   * 执行逻辑
   */
  private async runScript(item: ScriptItem, newTerminal: boolean) {
    let finalCommand = '';

    if (item.isNpmScript) {
      // 弹出选择或自动判断包管理器
      const packageManager = await this.selectPackageManager(item.cwd);

      // 如果用户取消了选择 (Esc)，则终止执行
      if (!packageManager) {
        return;
      }
      finalCommand = `${packageManager} run ${item.commandToExecute}`;
    } else {
      finalCommand = item.commandToExecute;
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
