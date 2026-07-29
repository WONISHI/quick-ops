
import type {  FavoriteFolder } from '@modules/live-preview/live-preview.type';

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