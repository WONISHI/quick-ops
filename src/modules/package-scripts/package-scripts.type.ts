import type * as vscode from 'vscode';

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

export type ScriptRunMode = 'terminal' | 'background';

export type ScriptSource = 'package-json' | 'workspace-config' | 'extension-shell';

export interface ShellConfigItem {
  /**
   * 显示名称
   */
  label?: string;

  /**
   * 原旧配置里常用 description 作为显示名称
   */
  description?: string;

  /**
   * 命令内容，兼容旧配置 cmd
   */
  cmd?: string;

  /**
   * 命令内容，兼容新配置 command
   */
  command?: string;

  /**
   * 执行后是否保持 QuickPick 打开
   */
  keepOpen?: boolean;
}

export interface ScriptItem extends vscode.QuickPickItem {
  commandToExecute: string;
  cwd: string;
  isNpmScript: boolean;
  source: ScriptSource;
  payload?: Record<string, unknown>;
  keepOpen?: boolean;
}

export interface PackageJsonInfo {
  name: string;
  uri: vscode.Uri;
  dirUri: vscode.Uri;
  dirPath: string;
  scripts: Record<string, string>;
}

export interface RunningCommandInfo {
  id: number;
  displayName: string;
  command: string;
  cwd: string;
  startedAt: number;
  output: string[];
  state: 'running' | 'success' | 'failed' | 'cancelled';
  exitCode?: number | null;
  errorMessage?: string;
}

export interface PackageScriptsStatus {
  type: 'idle' | 'running' | 'success' | 'failed' | 'cancelled';
  displayName?: string;
  message?: string;
}

export interface PackageScriptExecuteOptions {
  mode: ScriptRunMode;
  item: ScriptItem;
}