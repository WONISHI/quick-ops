export type WebviewRequestId = string | number;

export type RecentProjectPlatform =
  | 'local'
  | 'github'
  | 'gitlab'
  | 'gitee'
  | 'remote'
  | string;

export type GitFileStatus = 'M' | 'U' | 'A' | 'D' | 'R' | 'C';

export interface RecentProjectItem {
  id: string;
  name: string;
  customName?: string;
  fsPath: string;
  platform?: RecentProjectPlatform;
  customDomain?: string;
  branch?: string;
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
  diagnostics?: {
    errors: number;
    warnings: number;
  };
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

export interface PendingOpenFile {
  path: string;
  line: number;
  char: number;
  targetWorkspace?: string;
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
  focusOnly?: boolean;
  isFolder?: boolean;

  visibleProjectPaths?: string[];

  [key: string]: any;
}