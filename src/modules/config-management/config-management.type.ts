import type * as vscode from 'vscode';

export type ConfigManagementCommand =
  | 'quickOps.openSettings'
  | 'quickOps.reloadConfiguration'
  | 'quickOps.resetConfiguration'
  | 'quickOps.exportConfiguration'
  | 'quickOps.importConfiguration';

export type ConfigTarget = 'global' | 'workspace' | 'workspaceFolder';

export interface ConfigManagementCommandItem {
  command: ConfigManagementCommand;
  title: string;
  description?: string;
}

export interface ConfigUpdateOptions<T = unknown> {
  section: string;
  value: T;
  target?: vscode.ConfigurationTarget;
}

export interface ConfigResetOptions {
  section: string;
  target?: vscode.ConfigurationTarget;
}

export interface ConfigExportOptions {
  includeDefaultValue?: boolean;
  includeGlobalValue?: boolean;
  includeWorkspaceValue?: boolean;
  includeWorkspaceFolderValue?: boolean;
}

export interface ConfigImportOptions {
  overwrite?: boolean;
  target?: vscode.ConfigurationTarget;
}

export interface ConfigExportItem<T = unknown> {
  section: string;
  value: T;
  defaultValue?: T;
  globalValue?: T;
  workspaceValue?: T;
  workspaceFolderValue?: T;
}

export interface ConfigExportResult {
  extensionId: string;
  exportedAt: string;
  configs: ConfigExportItem[];
}

export interface ConfigImportResult {
  success: boolean;
  total: number;
  updated: number;
  skipped: number;
  errors: ConfigImportError[];
}

export interface ConfigImportError {
  section: string;
  message: string;
}

export interface ConfigQuickPickItem<T = unknown> extends vscode.QuickPickItem {
  value: T;
}