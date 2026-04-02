import * as vscode from 'vscode';
import { IFeature } from '../core/interfaces/IFeature';
import ColorLog from '../utils/ColorLog';

export class TerminalFeature implements IFeature {
  public readonly id = 'TerminalFeature';

  // 内部维护面板状态
  private isVisible = false;

  public activate(context: vscode.ExtensionContext): void {
    this.isVisible = vscode.window.activeTerminal !== undefined;

    const toggleCmd = vscode.commands.registerCommand('quickOps.toggleTerminal', () => {
      let terminal = vscode.window.activeTerminal;

      if (!terminal) {
        terminal = vscode.window.createTerminal();
        terminal.show(true);
        this.isVisible = true;
        return;
      }

      if (this.isVisible) {
        terminal.hide();
        this.isVisible = false;
      } else {
        terminal.show(true);
        this.isVisible = true;
      }
    });

    const onDidOpen = vscode.window.onDidOpenTerminal(() => {
      this.isVisible = true;
    });
    const onDidClose = vscode.window.onDidCloseTerminal(() => {
      if (vscode.window.terminals.length === 0) this.isVisible = false;
    });
    const onDidChange = vscode.window.onDidChangeActiveTerminal((t) => {
      if (t) this.isVisible = true;
    });

    context.subscriptions.push(toggleCmd, onDidOpen, onDidClose, onDidChange);

    ColorLog.black(`[${this.id}]`, 'Activated.');
  }
}
