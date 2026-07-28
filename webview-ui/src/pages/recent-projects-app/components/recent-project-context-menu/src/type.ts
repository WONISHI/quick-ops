import type { ContextMenuPayload } from '@/pages/recent-projects-app/src/type';

export interface RecentProjectContextMenuProps {
  visible: boolean;
  x: number;
  y: number;
  type: 'top' | 'sub';
  payload: ContextMenuPayload;
  selectedItems?: { path: string; name: string; isFolder: boolean }[];
  onClose: () => void;
  onAction: (action: string, arg?: string) => void;
}