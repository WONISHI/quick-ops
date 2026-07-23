import type { GitFile } from '@/pages/git-app/src/type';

export interface GraphCommit {
  hash: string;
  parents?: string[];
  author: string;
  email?: string;
  message: string;
  timestamp?: number;
  refs?: string;
  filesChanged?: number;
  insertions?: number;
  deletions?: number;
  type?: 'commit' | 'uncommitted' | 'stash';
}

export interface GitGraphProps {
  graphCommits: GraphCommit[];
  displayCount: number;
  setDisplayCount: React.Dispatch<React.SetStateAction<number>>;
  expandedCommitHashes: string[];
  commitFilesLoadingMap: Record<string, boolean>;
  commitFilesMap: Record<string, GitFile[]>;
  activeCommitHash: string | null;
  branch: string;
  remoteUrl?: string;
  isSearchOpen: boolean;
  setIsSearchOpen: (open: boolean) => void;
  onCommitClick: (hash: string) => void;
  renderCommitFiles: (hash: string, files: GitFile[]) => React.ReactNode;
  onCommitContextMenu: (e: React.MouseEvent, commit: GraphCommit) => void;
  onOpenCommitMultiDiff: (hash: string) => void;
}
