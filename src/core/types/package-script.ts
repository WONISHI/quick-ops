import * as vscode from 'vscode';

export interface ShellConfigItem {
  description: string;
  cmd: string;
  keepOpen?: boolean;
}

// 扩展 QuickPickItem
export interface ScriptItem extends vscode.QuickPickItem {
  commandToExecute: string;
  cwd: string;
  isNpmScript: boolean;
  payload?: Record<string, any>;
  keepOpen?: boolean;
}

export interface CmdInfo {
  cmdId: string;
  shell: string;
}
