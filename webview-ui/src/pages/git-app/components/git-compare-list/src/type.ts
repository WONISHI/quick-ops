import type { GitFile } from '@/pages/git-app/src/type';
import { type GraphCommit } from '@/pages/git-app/components/git-graph/src/type';

export interface GitCompareListProps {
  commits: GraphCommit[];
  activeCommitHash: string | null;
  loadedCommitHash: string | null;
  commitFilesLoading: boolean;
  commitFiles: GitFile[];
  remoteUrl?: string;
  onCommitClick: (hash: string) => void;
  renderCommitFiles: (files: GitFile[]) => React.ReactNode;
  onOpenCommitMultiDiff: (hash: string) => void;
}
