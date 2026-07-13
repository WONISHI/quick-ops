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
  isDefault?: boolean;
  source?: 'builtin' | 'user';
}

export type LocalPreviewFileType = 'md' | 'pdf' | 'excel' | 'html';

export interface PendingLocalFile {
  fsPath: string;
  fileType: LocalPreviewFileType;
}