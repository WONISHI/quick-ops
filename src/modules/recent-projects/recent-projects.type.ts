import type * as vscode from 'vscode';

export type RecentProjectPlatform =
  | 'local'
  | 'github'
  | 'gitlab'
  | 'gitee'
  | 'remote';

export interface RecentProjectItem {
  id: string;
  name: string;
  fsPath: string;
  platform?: RecentProjectPlatform;
  customDomain?: string;
  branch?: string;
  lastOpenedAt: number;
  createdAt: number;
}

export interface RecentProjectFileItem {
  path: string;
  name: string;
  relativePath?: string;
  isFolder: boolean;
  status?: string;
  diagnostics?: {
    errors: number;
    warnings: number;
  };
  children?: RecentProjectFileItem[];
}

export interface RemoteProjectParseResult {
  repoFullName: string;
  targetUriStr: string;
  platform: RecentProjectPlatform;
  customDomain?: string;
}

export interface CompareSelection {
  uri: string;
  selectedAt: number;
}

export interface RecentProjectsWebviewMessage {
  type: string;
  fsPath?: string;
  uri?: string;
  path?: string;
  name?: string;
  targetPath?: string;
  oldPath?: string;
  newPath?: string;
  query?: string;
  isRemote?: boolean;
  focusOnly?: boolean;
  requestId?: number;
  refreshExpandedTree?: boolean;
  project?: RecentProjectItem;
}