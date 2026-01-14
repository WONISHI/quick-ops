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
  //以此为准，删除了旧的 packagePath 等字段
  commandToExecute: string; // 实际要运行的命令字符串
  cwd: string;              // 执行目录
  isNpmScript: boolean;     // 标记：true=npm run xxx, false=直接执行
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
              kind: vscode.QuickPickItemKind.Separator
            });

            scriptNames.forEach(name => {
              items.push(this.createScriptItem(
                name, 
                scripts[name], 
                name, // npm run 的名字
                rootPath, 
                true  // isNpmScript
              ));
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
        const files = fs.readdirSync(shellResourceDir).filter(file => file.endsWith('.json'));

        for (const file of files) {
          const filePath = path.join(shellResourceDir, file);
          try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const jsonItems: ShellConfigItem[] = JSON.parse(content);

            if (Array.isArray(jsonItems) && jsonItems.length > 0) {
              items.push({
                label: file, 
                kind: vscode.QuickPickItemKind.Separator
              });

              jsonItems.forEach(item => {
                items.push(this.createScriptItem(
                  item.description, 
                  item.cmd,         
                  item.cmd,         // 直接执行的命令
                  rootPath || this.extensionPath, 
                  false             // isNpmScript = false
                ));
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

  /**
   * 辅助方法：构建统一的 ScriptItem
   * 修复点：删除了报错的多余字段赋值
   */
  private createScriptItem(
    label: string, 
    description: string, 
    commandToExecute: string, 
    cwd: string, 
    isNpmScript: boolean
  ): ScriptItem {
    return {
      label: `$(terminal) ${label}`,
      description: description,
      commandToExecute: commandToExecute,
      cwd: cwd,
      isNpmScript: isNpmScript,
      // ❌ 删除了 packagePath, scriptName, scriptCommand
      // 因为它们不在 ScriptItem 接口定义中，且 commandToExecute 已替代了它们的功能
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
   * 执行逻辑
   */
  private runScript(item: ScriptItem, newTerminal: boolean) {
    let finalCommand = '';

    if (item.isNpmScript) {
      let packageManager = 'npm';
      if (fs.existsSync(path.join(item.cwd, 'pnpm-lock.yaml'))) {
        packageManager = 'pnpm';
      } else if (fs.existsSync(path.join(item.cwd, 'yarn.lock'))) {
        packageManager = 'yarn';
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
      terminal = vscode.window.activeTerminal || vscode.window.createTerminal({
        name: 'Terminal',
        cwd: item.cwd,
      });
    }

    terminal.show();
    terminal.sendText(finalCommand);
  }
}