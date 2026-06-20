import type * as vscode from 'vscode';

export type GitFileStatusType =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'untracked'
  | 'conflicted'
  | 'staged'
  | 'unknown';

export interface GitFileItem {
  path: string;
  file?: string;
  absolutePath: string;
  workingDir: string;
  status: GitFileStatusType;
  indexStatus?: string;
  workingTreeStatus?: string;
  from?: string;
  baseRef?: string;
}

export interface GitStashItem {
  index: number;
  message: string;
}

export interface RemoteSyncState {
  hasRemote: boolean;
  hasUpstream: boolean;
  branch: string;
  upstream: string;
  ahead: number;
  behind: number;
  needsPull: boolean;
  needsPush: boolean;
  checkedAt: number;
  error?: string;
}

export interface GitRepoStatus {
  isRepo: boolean;
  branch: string;
  remoteUrl: string;
  folderName: string;
  stagedFiles: GitFileItem[];
  unstagedFiles: GitFileItem[];
  conflictedFiles: GitFileItem[];
  stashes: GitStashItem[];
  remoteSync: RemoteSyncState;
}

export interface GitGraphCommit {
  hash: string;
  parents: string[];
  author: string;
  email?: string;
  message: string;
  refs?: string;
  timestamp: number;
}

export interface GitGraphResult {
  graphCommits: GitGraphCommit[];
  graphFilter: string;
  totalCommits: number;
}

export interface GitBranchInfo {
  current: string;
  all: string[];
  local: string[];
  remote: string[];
}

export interface GitRemoteInfo {
  name: string;
  refs: {
    fetch?: string;
    push?: string;
  };
}

export interface GitCommitItem {
  hash: string;
  date: string;
  message: string;
  authorName: string;
  authorEmail: string;
  refs?: string;
}

export interface GitStatusSummary {
  isRepo: boolean;
  workingDir: string;
  currentBranch: string;
  tracking?: string;
  ahead: number;
  behind: number;
  files: GitFileItem[];
  staged: GitFileItem[];
  unstaged: GitFileItem[];
  conflicted: GitFileItem[];
  remotes: GitRemoteInfo[];
  hasRemote: boolean;
}

export interface GitDetailSummary {
  status: GitStatusSummary;
  branches: GitBranchInfo;
  logs: GitCommitItem[];
}

export interface GitUserInfo {
  name: string;
  email: string;
}

export interface GitCloneOptions {
  repoUrl: string;
  parentPath: string;
  targetBranch?: string;
  overwrite?: boolean;
}

export interface GitWebviewMessage {
  type: string;
  command?: string;
  workingDir?: string;
  filePath?: string;
  repoUrl?: string;
  branch?: string;
  message?: string;
  commitMessage?: string;
  hash?: string;
  requestId?: number;
  payload?: any;
}

export interface GitPostMessage {
  type: string;
  requestId?: number;
  payload?: any;
  status?: GitStatusSummary;
  detail?: GitDetailSummary;
  error?: string;
}

export interface GitWorkspacePreviewState {
  currentPreviewPath?: string;
  defaultWorkspacePath?: string;
  isPreviewingOther: boolean;
  hasRemote: boolean;
}

export interface GitDiffTarget {
  filePath: string;
  workingDir: string;
  title?: string;
  baseRef?: string;
}

export interface GitOpenFileOptions {
  filePath: string;
  workingDir: string;
  preview?: boolean;
  viewColumn?: vscode.ViewColumn;
}