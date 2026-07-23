import type { ContextMenuPayload, DirChild, SearchResult } from '@/pages/recent-projects-app/src/type';

export type FolderSearchType = 'content' | 'name';

export type FlatMatchItem = {
  fileIndex: number;
  matchIndex: number;
  lineGlobalIndex: number;
  fullPath: string;
  lineNum: number;
};

export interface SearchViewWrapperProps {
  searchTargetProject: ContextMenuPayload;

  focusMode?: boolean;
  focusLocked?: boolean;
  focusTree?: React.ReactNode;
  onBack?: () => void;
  onLockFocusMode?: () => void;
  onExitLockedFocusMode?: () => void;

  folderSearchQuery: string;
  setFolderSearchQuery: React.Dispatch<React.SetStateAction<string>>;

  folderSearchType: FolderSearchType;
  setFolderSearchType: React.Dispatch<React.SetStateAction<FolderSearchType>>;

  folderSearchResults: SearchResult[];
  setFolderSearchResults: React.Dispatch<React.SetStateAction<SearchResult[]>>;

  fileNameSearchResults: DirChild[];
  setFileNameSearchResults: React.Dispatch<React.SetStateAction<DirChild[]>>;

  folderSearchError: string;
  setFolderSearchError: React.Dispatch<React.SetStateAction<string>>;

  isSearchingFolder: boolean;

  totalMatches: number;
  currentActiveMatch: number;
  setCurrentActiveMatch: React.Dispatch<React.SetStateAction<number>>;

  lineStartIndexMap: Map<string, number>;
  flatMatchesList: FlatMatchItem[];

  expandedPaths: Set<string>;
  selectedPath: string;

  setIsSearchMode: React.Dispatch<React.SetStateAction<boolean>>;

  handlePrevSearchMatch: () => void;
  handleNextSearchMatch: () => void;

  handleToggleExpand: (path: string, projectName: string, isRemote: boolean, e: React.MouseEvent) => void;

  handleOpenFile: (path: string, projectName: string, isActiveProject: boolean, e: React.MouseEvent) => void;

  renderTreeChildren: (parentPath: string, projectName: string, isActiveProject?: boolean, highlightQuery?: string) => React.ReactNode;
}

export interface ExtensionTagOption {
  ext: string;
  count: number;
}
