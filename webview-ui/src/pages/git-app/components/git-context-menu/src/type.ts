export interface ContextMenuProps {
  visible: boolean;
  x: number;
  y: number;
  onClose: () => void;
  children: React.ReactNode;
}
