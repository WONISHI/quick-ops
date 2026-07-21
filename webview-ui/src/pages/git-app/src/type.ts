import type { CommitType } from '@/pages/git-app/components/commit-type-tag/src/type';
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

export interface CommitDraftSnapshot {
  message: string;
  commitType: CommitType;
  commitTypeEnabled: boolean;
  finalMessage: string;
}

export interface GitFile {
  status: string;
  file: string;
}

export interface TreeNode {
  name: string;
  fullPath: string;
  isDirectory: boolean;
  children: TreeNode[];
  file?: GitFile;
}