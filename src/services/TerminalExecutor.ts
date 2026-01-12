import * as vscode from 'vscode';
import { IService } from '../core/interfaces/IService';

interface CmdInfo {
  cmdId: string;
  shell: string;
}

export class TerminalExecutor implements IService {
  public readonly serviceId = 'TerminalExecutor';
  private static _instance: TerminalExecutor;
  private terminals: Map<string, vscode.Terminal> = new Map();
  private cmds: CmdInfo[] = [];

  private constructor() {}

  public static getInstance(): TerminalExecutor {
    if (!this._instance) {
      this._instance = new TerminalExecutor();
    }
    return this._instance;
  }

  public init(): void {}

  /**
   * 注册命令到执行器
   */
  public append(commands: string | string[]) {
    const newCmds = Array.isArray(commands) ? commands.map((cmd) => ({ cmdId: cmd, shell: cmd })) : [{ cmdId: commands, shell: commands }];
    this.cmds.push(...newCmds);
  }

  /**
   * 执行命令
   */
  public run(commandIds: string | string[], terminalName = 'Quick Ops Terminal') {
    let terminal = this.terminals.get(terminalName);
    if (!terminal || terminal.exitStatus !== undefined) {
      terminal = vscode.window.createTerminal(terminalName);
      this.terminals.set(terminalName, terminal);
    }

    const targetCmds = this.cmds.filter((c) => (Array.isArray(commandIds) ? commandIds.includes(c.cmdId) : c.cmdId === commandIds));

    if (!targetCmds.length) {
      vscode.window.showWarningMessage(`未找到命令: ${commandIds}`);
      return;
    }

    targetCmds.forEach((cmd) => terminal!.sendText(cmd.shell, true));
    terminal.show();
  }

  public dispose() {
    this.terminals.forEach((t) => t.dispose());
    this.terminals.clear();
  }
}
