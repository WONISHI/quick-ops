export interface GitFileItem {
  status: string;
  file: string;
  baseRef?: string;
}

export interface CommitFilesState {
  parentHash?: string;
  files: GitFileItem[];
}

export interface CommitFileTreeNode {
  name: string;
  fullPath: string;
  isDirectory: boolean;
  children: CommitFileTreeNode[];
  file?: GitFileItem;
}

export interface GraphCommit {
  hash: string;
  parents?: string[];
  author: string;
  email?: string;
  message: string;
  timestamp?: number;
  refs?: string;
  type?: 'commit' | 'uncommitted' | 'stash';
}
