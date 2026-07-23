import { type GraphCommit } from '@/pages/git-app/components/git-graph/src/type';

export interface CommitHoverWidgetProps {
  commit: GraphCommit;
  x: number;
  y: number;
  position: 'top' | 'bottom';
  branch?: string;
  remoteUrl?: string;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}
