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

export interface HistoryItem {
  url: string;
  title: string;
  timestamp: number;
  logo?: string;
}

export interface PreviewErrorState {
  title: string;
  message: string;
  url: string;
}

export interface BrowserFrameState {
  data: string;
  width: number;
  height: number;
  format?: 'jpeg' | 'png';
}

export type BrowserEngineKey = 'baidu' | 'bing' | 'quark';

export interface BrowserEngineOption {
  key: BrowserEngineKey;
  label: string;
  shortName: string;
  homeUrl: string;
  searchUrl: (keyword: string) => string;
}
