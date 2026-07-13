export interface BuiltinBookmark {
  name: string;
  url: string;
  description?: string;
  logo?: string;
}

export interface FavoriteItem {
  url: string;
  title: string;
  timestamp: number;
  description?: string;
  logo?: string;
  folderId?: string;
  isDefault?: boolean;
  source?: 'builtin' | 'user';
}

export interface FavoriteFolder {
  id: string;
  name: string;
  timestamp: number;
  isDefault?: boolean;
  source?: 'builtin' | 'user';
}

export const DEFAULT_FAVORITE_FOLDER_ID = 'default';
export const ROOT_FAVORITE_FOLDER_ID = 'root';

export const DEFAULT_FAVORITE_FOLDERS: FavoriteFolder[] = [
  {
    id: DEFAULT_FAVORITE_FOLDER_ID,
    name: '默认书签',
    timestamp: -2,
    isDefault: true,
    source: 'builtin',
  },
  {
    id: ROOT_FAVORITE_FOLDER_ID,
    name: '未分组',
    timestamp: -1,
    isDefault: true,
    source: 'builtin',
  },
];

export type LocalPreviewFileType = 'md' | 'pdf' | 'excel' | 'html';

export interface PendingLocalFile {
  fsPath: string;
  fileType: LocalPreviewFileType;
}

export interface FavoriteMetaResult {
  url: string;
  title: string;
  description: string;
  logo: string;
}

export interface FavoriteImportResult {
  addedCount: number;
  totalCount: number;
}

export interface BrowserFramePayload {
  data: string;
  width: number;
  height: number;
  format?: 'jpeg' | 'png';
}

export interface BrowserSnapshot {
  url: string;
  title: string;
  frame: BrowserFramePayload | null;
  hasPage: boolean;
}

export interface BrowserSearchResult {
  keyword: string;
  total: number;
  current: number;
}

export type BrowserMouseEventType = 'mouseMoved' | 'mousePressed' | 'mouseReleased' | 'mouseWheel';
export type BrowserKeyboardEventType = 'keyDown' | 'keyUp';

export interface BrowserInputMessage {
  inputType: 'mouse' | 'wheel' | 'keyboard' | 'insertText' | 'composition' | 'commitComposition' | 'cancelComposition';
  eventType?: BrowserMouseEventType | BrowserKeyboardEventType;
  x?: number;
  y?: number;
  button?: 'none' | 'left' | 'middle' | 'right';
  buttons?: number;
  clickCount?: number;
  deltaX?: number;
  deltaY?: number;
  key?: string;
  code?: string;
  text?: string;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
}

export interface BrowserViewportMessage {
  width: number;
  height: number;
  deviceScaleFactor?: number;
}
