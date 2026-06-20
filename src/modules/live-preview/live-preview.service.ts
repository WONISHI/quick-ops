import * as vscode from 'vscode';
import * as path from 'path';

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

export class LivePreviewService {
  public readonly globalFavoritesKey = 'quickOps.globalFavorites';

  private defaultFavoritesCache: FavoriteItem[] | null = null;

  public normalizeFavoriteUrl(url: string): string {
    return String(url || '')
      .trim()
      .replace(/\/+$/, '');
  }

  public async getMergedFavorites(
    context: vscode.ExtensionContext,
  ): Promise<FavoriteItem[]> {
    const defaultFavorites = await this.loadDefaultFavorites(context);

    const userFavorites = this.normalizeUserFavorites(
      context.globalState.get<FavoriteItem[]>(this.globalFavoritesKey, []),
    );

    return this.mergeFavorites(defaultFavorites, userFavorites);
  }

  public async saveUserFavorites(
    context: vscode.ExtensionContext,
    favorites: FavoriteItem[],
  ): Promise<FavoriteItem[]> {
    const userFavorites = this.normalizeUserFavorites(favorites);

    await context.globalState.update(this.globalFavoritesKey, userFavorites);

    return this.getMergedFavorites(context);
  }

  public async toggleFavorite(
    context: vscode.ExtensionContext,
    favorite: FavoriteItem,
  ): Promise<{
    changed: boolean;
    favorites: FavoriteItem[];
    message?: string;
  }> {
    const defaultFavorites = await this.loadDefaultFavorites(context);
    const targetUrlKey = this.normalizeFavoriteUrl(favorite.url);

    const isDefaultFavorite = defaultFavorites.some(item => {
      return this.normalizeFavoriteUrl(item.url) === targetUrlKey;
    });

    if (isDefaultFavorite) {
      return {
        changed: false,
        favorites: await this.getMergedFavorites(context),
        message: '该收藏是插件内置默认书签，不能取消收藏。',
      };
    }

    const userFavorites = this.normalizeUserFavorites(
      context.globalState.get<FavoriteItem[]>(this.globalFavoritesKey, []),
    );

    const index = userFavorites.findIndex(item => {
      return this.normalizeFavoriteUrl(item.url) === targetUrlKey;
    });

    if (index > -1) {
      userFavorites.splice(index, 1);
    } else {
      userFavorites.push({
        url: favorite.url,
        title: favorite.title || favorite.url,
        logo: favorite.logo || '',
        description: favorite.description || '',
        timestamp: Date.now(),
        isDefault: false,
        source: 'user',
      });
    }

    await context.globalState.update(this.globalFavoritesKey, userFavorites);

    return {
      changed: true,
      favorites: await this.getMergedFavorites(context),
    };
  }

  public getLocalFileType(uri: vscode.Uri): LocalPreviewFileType | null {
    const lowerPath = uri.fsPath.toLowerCase();

    if (lowerPath.endsWith('.md') || lowerPath.endsWith('.markdown')) {
      return 'md';
    }

    if (lowerPath.endsWith('.pdf')) {
      return 'pdf';
    }

    if (
      lowerPath.endsWith('.xlsx') ||
      lowerPath.endsWith('.xls') ||
      lowerPath.endsWith('.csv')
    ) {
      return 'excel';
    }

    if (lowerPath.endsWith('.html') || lowerPath.endsWith('.htm')) {
      return 'html';
    }

    return null;
  }

  public parseExternalUri(rawUrl: string): vscode.Uri {
    const value = String(rawUrl || '').trim();

    if (/^file:\/\//i.test(value)) {
      return vscode.Uri.parse(value);
    }

    if (/^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('/')) {
      return vscode.Uri.file(value);
    }

    return vscode.Uri.parse(value);
  }

  public parseLocalFileUri(fsPath: string): vscode.Uri {
    const value = String(fsPath || '').trim();

    if (/^file:\/\//i.test(value)) {
      return vscode.Uri.parse(value);
    }

    if (/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(value)) {
      return vscode.Uri.parse(value);
    }

    return vscode.Uri.file(value);
  }

  public getLocalResourceRoots(
    context: vscode.ExtensionContext,
    fileUri?: vscode.Uri,
  ): vscode.Uri[] {
    const roots: vscode.Uri[] = [context.extensionUri];

    const workspaceFolders = vscode.workspace.workspaceFolders || [];

    for (const folder of workspaceFolders) {
      roots.push(folder.uri);
    }

    if (fileUri?.scheme === 'file') {
      const fileDir = path.dirname(fileUri.fsPath);

      roots.push(vscode.Uri.file(fileDir));

      const parentDir = path.dirname(fileDir);

      if (parentDir && parentDir !== fileDir) {
        roots.push(vscode.Uri.file(parentDir));
      }
    }

    const uniqueMap = new Map<string, vscode.Uri>();

    for (const uri of roots) {
      uniqueMap.set(uri.toString(), uri);
    }

    return Array.from(uniqueMap.values());
  }

  public dispose(): void {
    this.defaultFavoritesCache = null;
  }

  private async loadDefaultFavorites(
    context: vscode.ExtensionContext,
  ): Promise<FavoriteItem[]> {
    if (this.defaultFavoritesCache) {
      return this.defaultFavoritesCache;
    }

    const bookmarksDirUri = vscode.Uri.joinPath(
      context.extensionUri,
      'resources',
      'bookmarks',
    );

    const result: FavoriteItem[] = [];
    const usedUrls = new Set<string>();

    try {
      const entries = await vscode.workspace.fs.readDirectory(bookmarksDirUri);

      const jsonFiles = entries
        .filter(([fileName, fileType]) => {
          return (
            fileType === vscode.FileType.File &&
            fileName.toLowerCase().endsWith('.json')
          );
        })
        .map(([fileName]) => fileName);

      for (const fileName of jsonFiles) {
        const fileUri = vscode.Uri.joinPath(bookmarksDirUri, fileName);
        const contentBytes = await vscode.workspace.fs.readFile(fileUri);
        const content = Buffer.from(contentBytes).toString('utf8');
        const jsonData = JSON.parse(content);
        const list = this.extractFavoriteArray(jsonData);

        list.forEach((item, index) => {
          const normalized = this.normalizeDefaultFavorite(
            item,
            result.length + index,
          );

          if (!normalized) return;

          const key = this.normalizeFavoriteUrl(normalized.url);

          if (!key || usedUrls.has(key)) return;

          usedUrls.add(key);
          result.push(normalized);
        });
      }
    } catch (error) {
      console.warn('[LivePreviewService] load default bookmarks failed:', error);
    }

    this.defaultFavoritesCache = result;

    return result;
  }

  private extractFavoriteArray(jsonData: unknown): BuiltinBookmark[] {
    if (!Array.isArray(jsonData)) return [];

    return jsonData as BuiltinBookmark[];
  }

  private normalizeDefaultFavorite(
    raw: BuiltinBookmark,
    index: number,
  ): FavoriteItem | null {
    const title = String(raw.name || '').trim();
    const url = String(raw.url || '').trim();
    const description = String(raw.description || '').trim();
    const logo = String(raw.logo || '').trim();

    if (!title || !url) return null;

    return {
      title,
      url,
      description,
      logo,
      timestamp: 0 - index,
      isDefault: true,
      source: 'builtin',
    };
  }

  private normalizeUserFavorites(favorites: FavoriteItem[]): FavoriteItem[] {
    if (!Array.isArray(favorites)) return [];

    const result: FavoriteItem[] = [];
    const usedUrls = new Set<string>();

    for (const item of favorites) {
      if (item?.isDefault) continue;

      const url = typeof item?.url === 'string' ? item.url.trim() : '';
      const title = typeof item?.title === 'string' ? item.title.trim() : '';

      if (!url || !title) continue;

      const key = this.normalizeFavoriteUrl(url);

      if (usedUrls.has(key)) continue;

      usedUrls.add(key);

      result.push({
        url,
        title,
        description:
          typeof item.description === 'string' ? item.description : '',
        logo: typeof item.logo === 'string' ? item.logo : '',
        timestamp:
          typeof item.timestamp === 'number' ? item.timestamp : Date.now(),
        isDefault: false,
        source: 'user',
      });
    }

    return result;
  }

  private mergeFavorites(
    defaultFavorites: FavoriteItem[],
    userFavorites: FavoriteItem[],
  ): FavoriteItem[] {
    const defaultUrlSet = new Set(
      defaultFavorites.map(item => this.normalizeFavoriteUrl(item.url)),
    );

    const filteredUserFavorites = userFavorites.filter(item => {
      return !defaultUrlSet.has(this.normalizeFavoriteUrl(item.url));
    });

    return [...defaultFavorites, ...filteredUserFavorites];
  }
}