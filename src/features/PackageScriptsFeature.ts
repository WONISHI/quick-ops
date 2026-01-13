import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { IFeature } from '../core/interfaces/IFeature';

interface ScriptItem extends vscode.QuickPickItem {
  scriptName: string;
  scriptCommand: string;
  packagePath: string;
}

export class PackageScriptsFeature implements IFeature {
  public readonly id = 'PackageScriptsFeature';
  private statusBarItem: vscode.StatusBarItem | undefined;

  public activate(context: vscode.ExtensionContext): void {
    // 1. 注册命令
    const commandId = 'quick-ops.showPackageScripts';
    context.subscriptions.push(vscode.commands.registerCommand(commandId, this.showScripts.bind(this)));

    // 2. 创建底部状态栏按钮
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.statusBarItem.command = commandId;
    this.statusBarItem.text = '$(play) Scripts'; // 使用播放图标
    this.statusBarItem.tooltip = '查看并执行 package.json 脚本';
    this.statusBarItem.show();
    context.subscriptions.push(this.statusBarItem);

    // 3. 监听文件变化（可选：如果 package.json 变了，理论上列表也该更新，这里简化处理，每次点击都重新读）
    console.log(`[${this.id}] Activated.`);
  }

  /**
   * 显示脚本列表弹窗
   */
  private async showScripts() {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      vscode.window.showInformationMessage('当前没有打开的工作区');
      return;
    }

    // 简单起见，这里只读取第一个工作区，如果是多根工作区可以遍历处理
    const rootPath = workspaceFolders[0].uri.fsPath;
    const packageJsonPath = path.join(rootPath, 'package.json');

    if (!fs.existsSync(packageJsonPath)) {
      vscode.window.showWarningMessage('当前工作区根目录下找不到 package.json');
      return;
    }

    try {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      const scripts = packageJson.scripts || {};
      const scriptNames = Object.keys(scripts);

      if (scriptNames.length === 0) {
        vscode.window.showInformationMessage('package.json 中没有定义 scripts');
        return;
      }

      // 构建 QuickPick 选项
      const items: ScriptItem[] = scriptNames.map((name) => ({
        label: `$(terminal) ${name}`,
        description: scripts[name],
        scriptName: name,
        scriptCommand: scripts[name],
        packagePath: rootPath,
        // 添加按钮：一个代表当前终端，一个代表新终端
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
      }));

      // 创建并配置 QuickPick
      const quickPick = vscode.window.createQuickPick<ScriptItem>();
      quickPick.items = items;
      quickPick.placeholder = '选择要执行的脚本 (点击回车在当前终端执行)';
      quickPick.matchOnDescription = true;

      // 处理按钮点击事件 (点击右侧小图标)
      quickPick.onDidTriggerItemButton((e) => {
        const isNewTerminal = e.button.tooltip === '在新终端执行';
        this.runScript(e.item.scriptName, e.item.packagePath, isNewTerminal);
        quickPick.hide();
      });

      // 处理列表项点击事件 (直接回车或鼠标点行)
      quickPick.onDidAccept(() => {
        const selected = quickPick.selectedItems[0];
        if (selected) {
          // 默认行为：在当前终端执行
          this.runScript(selected.scriptName, selected.packagePath, false);
          quickPick.hide();
        }
      });

      quickPick.show();
    } catch (error) {
      vscode.window.showErrorMessage(`解析 package.json 失败: ${error}`);
    }
  }

  /**
   * 执行脚本的核心逻辑
   */
  private runScript(scriptName: string, cwd: string, newTerminal: boolean) {
    // 构造 npm/pnpm/yarn 命令，这里默认用 npm，你可以根据项目自动判断
    // 简单判断：如果有 pnpm-lock.yaml 用 pnpm，有 yarn.lock 用 yarn，否则 npm
    let packageManager = 'npm';
    if (fs.existsSync(path.join(cwd, 'pnpm-lock.yaml'))) {
      packageManager = 'pnpm';
    } else if (fs.existsSync(path.join(cwd, 'yarn.lock'))) {
      packageManager = 'yarn';
    }

    const command = `${packageManager} run ${scriptName}`;

    let terminal: vscode.Terminal;

    if (newTerminal) {
      // 1. 创建新终端
      terminal = vscode.window.createTerminal({
        name: `Script: ${scriptName}`,
        cwd: cwd,
      });
    } else {
      // 2. 使用当前活跃终端，如果没有则创建
      terminal =
        vscode.window.activeTerminal ||
        vscode.window.createTerminal({
          name: 'Terminal',
          cwd: cwd,
        });
    }

    terminal.show();
    terminal.sendText(command);
  }
}
