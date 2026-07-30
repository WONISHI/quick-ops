import * as vscode from 'vscode';

export type WebviewRequestId = string | number;

export type RecentProjectPlatform = 'local' | 'github' | 'gitlab' | 'gitee' | 'remote' | string;

export type GitFileStatus = 'M' | 'U' | 'A' | 'D' | 'R' | 'C';

export interface DiagnosticSummary {
  errors: number;
  warnings: number;
}

export interface RecentProjectItem {
  id: string;
  name: string;
  customName?: string;
  fsPath: string;
  platform?: RecentProjectPlatform;
  customDomain?: string;
  branch?: string;
  status?: GitFileStatus | string;
  diagnostics?: DiagnosticSummary;
  /** 兼容 master 历史数据。 */
  timestamp?: number;
  createdAt: number;
  updatedAt?: number;
  lastOpenedAt: number;
}

export interface RecentProjectFileItem {
  path: string;
  name: string;
  isFolder: boolean;
  relativePath?: string;
  status?: GitFileStatus | string;
  diagnostics?: DiagnosticSummary;
}

export interface RemoteProjectParseResult {
  repoFullName: string;
  targetUriStr: string;
  platform: RecentProjectPlatform;
  customDomain?: string;
}

export interface CompareSelection {
  uri: string;
  displayName?: string;
  selectedAt: number;
}

export interface PendingOpenFile {
  path: string;
  line: number;
  char: number;
  targetWorkspace?: string;
}

export interface FocusLockState {
  enabled: boolean;
  fsPath?: string;
  name?: string;
}

export interface MetadataPatchItem {
  path: string;
  status?: GitFileStatus | string;
  diagnostics: DiagnosticSummary;
}

export interface RecentProjectsWebviewMessage {
  type: string;
  requestId?: WebviewRequestId;

  fsPath?: string;
  path?: string;
  uri?: string;
  targetPath?: string;
  filePath?: string;

  oldPath?: string;
  newPath?: string;
  newName?: string;

  sourceFsPath?: string;
  sourcePath?: string;
  targetFolderFsPath?: string;
  targetFolderPath?: string;

  name?: string;
  text?: string;
  query?: string;
  projectName?: string;

  platform?: RecentProjectPlatform;
  customDomain?: string;
  status?: string;
  branch?: string;

  refreshExpandedTree?: boolean;
  forceRefresh?: boolean;
  focusOnly?: boolean;
  isFolder?: boolean;
  isRemote?: boolean;
  isActiveProject?: boolean;
  visible?: boolean;
  line?: number;

  visibleProjectPaths?: string[];

  [key: string]: any;
}

export interface RemoteProjectInfo {
  platform: RecentProjectPlatform;
  domain: string;
  repoFullName: string;
}

export type GitMetadataContext = {
  gitRoot: string;
  statusMap: Map<string, GitFileStatus>;
};

export type RecentProjectQuickPickItem = vscode.QuickPickItem & {
  project: RecentProjectItem;
};
