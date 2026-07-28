import type { GraphCommit } from '@/pages/git-detail-app/src/type';

export interface CommitContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  commit: GraphCommit;
}

export interface GitDetailContextMenuProps {
  contextMenu: CommitContextMenuState | null;
  remoteUrl: string;
  onClose: () => void;
}
