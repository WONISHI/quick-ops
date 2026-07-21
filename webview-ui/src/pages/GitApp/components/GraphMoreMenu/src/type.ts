export interface GraphMoreMenuProps {
  isSearchOpen: boolean;
  onToggleSearch: () => void;
  onCollapseCommitFiles: () => void;
  triggerClassName?: string;
  activeTriggerClassName?: string;
}