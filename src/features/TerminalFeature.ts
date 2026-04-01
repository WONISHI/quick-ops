import * as vscode from 'vscode';
import { IFeature } from '../core/interfaces/IFeature';
import ColorLog from '../utils/ColorLog';

export class TerminalFeature implements IFeature {
  public readonly id = 'TerminalFeature';

  public activate(context: vscode.ExtensionContext): void {
    // 注册单个切换命令，直接调用 VS Code 原生的 Toggle Terminal
    const toggleCmd = vscode.commands.registerCommand('quickOps.toggleTerminal', () => {
      vscode.commands.executeCommand('workbench.action.terminal.toggleTerminal');
    });

    context.subscriptions.push(toggleCmd);

    ColorLog.black(`[${this.id}]`, 'Activated.');
  }
}