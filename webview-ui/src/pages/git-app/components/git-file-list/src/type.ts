import type { ContextMenuState } from '@/pages/git-app/components/git-context-menu/src/type';
import type { GitFile } from '@/pages/git-app/src/type';

export interface GitFileListProps {
  files: GitFile[];
  listType: 'staged' | 'unstaged' | 'history' | 'compare' | 'stash-file';
  historyHash?: string;
  viewMode: 'list' | 'tree';
  activeFile: string | null;
  setActiveFile: (file: string | null) => void;
  expandedDirs: Record<string, boolean>;
  toggleDir: (path: string, e: React.MouseEvent) => void;
  collapseDirs: (paths: string[], e: React.MouseEvent) => void;
  openHistoryDiff: (item: GitFile, historyHash?: string) => void;
  openCompareDiff: (item: GitFile) => void;
  setContextMenu: (state: ContextMenuState) => void;
}
