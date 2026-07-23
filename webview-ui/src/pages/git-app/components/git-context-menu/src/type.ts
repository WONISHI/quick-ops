export interface ContextMenuProps {
  visible: boolean;
  x: number;
  y: number;
  onClose: () => void;
  children: React.ReactNode;
}

export interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  type: 'file' | 'commit';
  file?: {
    file: string;
    status: string;
  };
  listType?: 'staged' | 'unstaged' | 'history' | 'compare' | 'stash-file';
  historyHash?: string;
  commit?: {
    hash: string;
    message: string;
  };
}

export interface GitContextMenuProps {
  contextMenu: ContextMenuState | null;
  onClose: () => void;
}
