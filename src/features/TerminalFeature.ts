import * as vscode from 'vscode';
import { IFeature } from '../core/interfaces/IFeature';
import ColorLog from '../utils/ColorLog';

export class TerminalFeature implements IFeature {
  public readonly id = 'TerminalFeature';

  public activate(context: vscode.ExtensionContext): void {
    // 1. 初始化时，尝试获取当前是否有活动的终端，来决定初始状态
    const initialVisible = vscode.window.activeTerminal !== undefined;
    vscode.commands.executeCommand('setContext', 'quickOps.terminalVisible', initialVisible);

    // 2. 显示终端 (点击后变为隐藏图标)
    const showTerminalCmd = vscode.commands.registerCommand('quickOps.showTerminal', () => {
      vscode.commands.executeCommand('workbench.action.terminal.focus');
      vscode.commands.executeCommand('setContext', 'quickOps.terminalVisible', true);
    });

    // 3. 隐藏终端 (点击后变为显示图标)
    const hideTerminalCmd = vscode.commands.registerCommand('quickOps.hideTerminal', () => {
      vscode.commands.executeCommand('workbench.action.closePanel');
      vscode.commands.executeCommand('setContext', 'quickOps.terminalVisible', false);
    });

    // 4. 智能监听：当用户用快捷键或其他方式开启/关闭终端时，同步更新右上角按钮状态
    const onDidChangeTerminal = vscode.window.onDidChangeActiveTerminal((terminal) => {
      if (terminal) {
        vscode.commands.executeCommand('setContext', 'quickOps.terminalVisible', true);
      }
    });

    const onDidCloseTerminal = vscode.window.onDidCloseTerminal(() => {
      if (vscode.window.terminals.length === 0) {
        vscode.commands.executeCommand('setContext', 'quickOps.terminalVisible', false);
      }
    });

    // 将所有命令和监听器推入释放池
    context.subscriptions.push(showTerminalCmd, hideTerminalCmd, onDidChangeTerminal, onDidCloseTerminal);

    ColorLog.black(`[${this.id}]`, 'Activated.');
  }
}
