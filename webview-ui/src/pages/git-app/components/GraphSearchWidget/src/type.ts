export interface GraphSearchWidgetProps {
  isSearchOpen: boolean;
  setIsSearchOpen: (open: boolean) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  currentMatchIndex: number;
  setCurrentMatchIndex: (index: number) => void;
  matchedIndices: number[];
  handlePrevMatch: () => void;
  handleNextMatch: () => void;
  anchorRef: React.RefObject<HTMLDivElement | null>;
}

export interface SearchOffset {
  x: number;
  y: number;
}

export interface DragStart {
  mouseX: number;
  mouseY: number;
  currentX: number;
  currentY: number;
}