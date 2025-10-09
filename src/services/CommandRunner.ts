import * as vscode from 'vscode';
import { properties } from '../global-object/properties';

export default class CommandRunner {
  private cmds: { cmdId: string; shell: string }[] = [];
  private terminal?: vscode.Terminal;
  private static DEV = properties?.settings?.DEV ?? properties?.pluginConfig?.DEV;

  /**
   * 添加命令到待执行列表
   * @param commands 单个命令或命令数组
   * @param terminalName 终端名称
   */
  append(commands: string | string[], terminalName = 'Custom Terminal') {
    this.terminal = vscode.window.createTerminal(terminalName);
    const newCmds = Array.isArray(commands) ? commands.map((cmd) => ({ cmdId: cmd, shell: cmd })) : [{ cmdId: commands, shell: commands }];
    this.cmds.push(...newCmds);
  }

  /**
   * 执行指定命令
   * @param commands 命令 ID 或数组
   */
  run(commands: string | string[]) {
    if (!this.terminal) {
      vscode.window.showErrorMessage('Terminal is not created. Call append() first.');
      return;
    }
    const targetCmds = this.cmds.filter((c) => (Array.isArray(commands) ? commands.includes(c.cmdId) : c.cmdId === commands));
    if (!targetCmds.length) return;
    targetCmds.forEach((cmd) => this.terminal!.sendText(cmd.shell, true));
    this.terminal.show();
  }
}
