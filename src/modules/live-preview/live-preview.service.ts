import * as vscode from 'vscode';
import * as path from 'path';
import { DEFAULT_FAVORITE_FOLDER_ID, DEFAULT_FAVORITE_FOLDERS, ROOT_FAVORITE_FOLDER_ID } from '@modules/live-preview/live-preview.type';
import type { BuiltinBookmark, FavoriteFolder, FavoriteImportResult, FavoriteItem, FavoriteMetaResult, LocalPreviewFileType } from '@modules/live-preview/live-preview.type';

export class LivePreviewService {
  public readonly globalFavoritesKey = 'quickOps.globalFavorites';
  public readonly globalFavoriteFoldersKey = 'quickOps.favoriteFolders';

  private defaultFavoritesCache: FavoriteItem[] | null = null;

  public normalizeFavoriteUrl(url: string): string {
    return String(url || '')
      .trim()
      .replace(/\/+$/, '');
  }

  public async getMergedFavorites(context: vscode.ExtensionContext): Promise<FavoriteItem[]> {
    const defaultFavorites = await this.loadDefaultFavorites(context);
    const userFavorites = this.normalizeUserFavorites(context.globalState.get<FavoriteItem[]>(this.globalFavoritesKey, []));

    return this.mergeFavorites(defaultFavorites, userFavorites);
  }

  public async saveUserFavorites(context: vscode.ExtensionContext, favorites: FavoriteItem[]): Promise<FavoriteItem[]> {
    const userFavorites = this.normalizeUserFavorites(favorites);

    await context.globalState.update(this.globalFavoritesKey, userFavorites);

    return this.getMergedFavorites(context);
  }

  public async getFavoriteFolders(context: vscode.ExtensionContext): Promise<FavoriteFolder[]> {
    const userFolders = this.normalizeFavoriteFolders(context.globalState.get<FavoriteFolder[]>(this.globalFavoriteFoldersKey, []));

    return [...DEFAULT_FAVORITE_FOLDERS, ...userFolders];
  }

  public async saveFavoriteFolders(context: vscode.ExtensionContext, folders: FavoriteFolder[]): Promise<FavoriteFolder[]> {
    const userFolders = this.normalizeFavoriteFolders(folders);

    await context.globalState.update(this.globalFavoriteFoldersKey, userFolders);

    return this.getFavoriteFolders(context);
  }

  public async toggleFavorite(
    context: vscode.ExtensionContext,
    favorite: FavoriteItem,
  ): Promise<{
    changed: boolean;
    favorites: FavoriteItem[];
    folders: FavoriteFolder[];
    message?: string;
  }> {
    const defaultFavorites = await this.loadDefaultFavorites(context);
    const targetUrlKey = this.normalizeFavoriteUrl(favorite.url);

    const isDefaultFavorite = defaultFavorites.some((item) => {
      return this.normalizeFavoriteUrl(item.url) === targetUrlKey;
    });

    if (isDefaultFavorite) {
      return {
        changed: false,
        favorites: await this.getMergedFavorites(context),
        folders: await this.getFavoriteFolders(context),
        message: '该收藏是插件内置默认书签，不能取消收藏。',
      };
    }

    const userFavorites = this.normalizeUserFavorites(context.globalState.get<FavoriteItem[]>(this.globalFavoritesKey, []));

    const index = userFavorites.findIndex((item) => {
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
        folderId: typeof favorite.folderId === 'string' && favorite.folderId.trim() ? favorite.folderId.trim() : ROOT_FAVORITE_FOLDER_ID,
        timestamp: Date.now(),
        isDefault: false,
        source: 'user',
      });
    }

    await context.globalState.update(this.globalFavoritesKey, userFavorites);

    return {
      changed: true,
      favorites: await this.getMergedFavorites(context),
      folders: await this.getFavoriteFolders(context),
    };
  }

  public async resolveFavoriteMeta(url: string): Promise<FavoriteMetaResult> {
    const rawUrl = String(url || '').trim();

    if (!rawUrl) {
      throw new Error('链接不能为空。');
    }

    const fetchFn = (globalThis as any).fetch as undefined | ((input: string, init?: any) => Promise<any>);

    if (!fetchFn) {
      throw new Error('当前 VS Code 运行环境不支持 fetch，无法自动解析网页信息。');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetchFn(rawUrl, {
        signal: controller.signal,
        headers: {
          'user-agent': 'Mozilla/5.0 QuickOpsLivePreview/1.0',
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });

      const html = String(await response.text());
      const finalUrl = response.url || rawUrl;
      const title =
        this.getMetaContent(html, ['og:title', 'twitter:title']) || this.normalizeHtmlText((html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/<[^>]*>/g, ''));
      const description = this.getMetaContent(html, ['description', 'og:description', 'twitter:description']);
      const logo = this.getFavoriteIconFromHtml(html, finalUrl);

      return {
        url: finalUrl,
        title,
        description,
        logo,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  public async exportFavoritesToFile(favorites: FavoriteItem[], folders: FavoriteFolder[]): Promise<void> {
    const defaultExportDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
    const fileUri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(path.join(defaultExportDir, `quick-ops-bookmarks-${new Date().toISOString().slice(0, 10)}.html`)),
      filters: {
        'HTML Bookmarks': ['html', 'htm'],
      },
    });

    if (!fileUri) return;

    const html = this.buildBookmarksHtml(favorites, folders);

    await vscode.workspace.fs.writeFile(fileUri, Buffer.from(html, 'utf8'));
    vscode.window.showInformationMessage(`已导出书签：${fileUri.fsPath}`);
  }

  public async importFavoritesFromFile(context: vscode.ExtensionContext): Promise<FavoriteImportResult | null> {
    const fileUris = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters: {
        Bookmarks: ['html', 'htm', 'json'],
      },
    });

    const fileUri = fileUris?.[0];

    if (!fileUri) return null;

    const content = Buffer.from(await vscode.workspace.fs.readFile(fileUri)).toString('utf8');
    let importedFavorites: FavoriteItem[] = [];
    let importedFolders: FavoriteFolder[] = [];

    if (/\.json$/i.test(fileUri.fsPath)) {
      const json = JSON.parse(content);

      importedFavorites = this.normalizeUserFavorites(Array.isArray(json) ? json : json?.favorites || []);
      importedFolders = this.normalizeFavoriteFolders(json?.folders || []);
    } else {
      const parsed = this.parseImportedBookmarksHtml(content);

      importedFavorites = parsed.favorites;
      importedFolders = parsed.folders;
    }

    if (importedFavorites.length === 0) {
      vscode.window.showWarningMessage('没有从文件中解析到可导入的书签。');
      return {
        addedCount: 0,
        totalCount: 0,
      };
    }

    const currentFavorites = this.normalizeUserFavorites(context.globalState.get<FavoriteItem[]>(this.globalFavoritesKey, []));
    const currentFolders = this.normalizeFavoriteFolders(context.globalState.get<FavoriteFolder[]>(this.globalFavoriteFoldersKey, []));
    const folderMap = new Map<string, FavoriteFolder>();

    currentFolders.forEach((folder) => folderMap.set(folder.name, folder));
    importedFolders.forEach((folder) => {
      if (!folderMap.has(folder.name)) {
        folderMap.set(folder.name, folder);
      }
    });

    const mergedFolders = Array.from(folderMap.values());
    const folderNameToId = new Map<string, string>();

    [...DEFAULT_FAVORITE_FOLDERS, ...mergedFolders].forEach((folder) => {
      folderNameToId.set(folder.name, folder.id);
    });

    const importedFolderIdToMergedId = new Map<string, string>();

    importedFolders.forEach((folder) => {
      importedFolderIdToMergedId.set(folder.id, folderNameToId.get(folder.name) || folder.id);
    });

    const favoriteMap = new Map<string, FavoriteItem>();

    currentFavorites.forEach((favorite) => {
      favoriteMap.set(this.normalizeFavoriteUrl(favorite.url), favorite);
    });

    let addedCount = 0;

    importedFavorites.forEach((favorite) => {
      const key = this.normalizeFavoriteUrl(favorite.url);

      if (!key || favoriteMap.has(key)) return;

      addedCount++;
      favoriteMap.set(key, {
        ...favorite,
        folderId: importedFolderIdToMergedId.get(favorite.folderId || '') || favorite.folderId || ROOT_FAVORITE_FOLDER_ID,
        timestamp: favorite.timestamp || Date.now(),
        isDefault: false,
        source: 'user',
      });
    });

    await context.globalState.update(this.globalFavoriteFoldersKey, mergedFolders);
    await context.globalState.update(this.globalFavoritesKey, Array.from(favoriteMap.values()));

    vscode.window.showInformationMessage(`书签导入完成，新增 ${addedCount} 条。`);

    return {
      addedCount,
      totalCount: importedFavorites.length,
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

    if (lowerPath.endsWith('.xlsx') || lowerPath.endsWith('.xls') || lowerPath.endsWith('.csv')) {
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

  public getLocalResourceRoots(context: vscode.ExtensionContext, fileUri?: vscode.Uri): vscode.Uri[] {
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

  private async loadDefaultFavorites(context: vscode.ExtensionContext): Promise<FavoriteItem[]> {
    if (this.defaultFavoritesCache) {
      return this.defaultFavoritesCache;
    }

    const bookmarksDirUri = vscode.Uri.joinPath(context.extensionUri, 'resources', 'bookmarks');
    const result: FavoriteItem[] = [];
    const usedUrls = new Set<string>();

    try {
      const entries = await vscode.workspace.fs.readDirectory(bookmarksDirUri);
      const jsonFiles = entries
        .filter(([fileName, fileType]) => {
          return fileType === vscode.FileType.File && fileName.toLowerCase().endsWith('.json');
        })
        .map(([fileName]) => fileName);

      for (const fileName of jsonFiles) {
        const fileUri = vscode.Uri.joinPath(bookmarksDirUri, fileName);
        const contentBytes = await vscode.workspace.fs.readFile(fileUri);
        const content = Buffer.from(contentBytes).toString('utf8');
        const jsonData = JSON.parse(content);
        const list = this.extractFavoriteArray(jsonData);

        list.forEach((item, index) => {
          const normalized = this.normalizeDefaultFavorite(item, result.length + index);

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

  private normalizeDefaultFavorite(raw: BuiltinBookmark, index: number): FavoriteItem | null {
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
      folderId: DEFAULT_FAVORITE_FOLDER_ID,
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
        description: typeof item.description === 'string' ? item.description : '',
        logo: typeof item.logo === 'string' ? item.logo : '',
        folderId: typeof item.folderId === 'string' && item.folderId.trim() ? item.folderId.trim() : ROOT_FAVORITE_FOLDER_ID,
        timestamp: typeof item.timestamp === 'number' ? item.timestamp : Date.now(),
        isDefault: false,
        source: 'user',
      });
    }

    return result;
  }

  private normalizeFavoriteFolders(folders: FavoriteFolder[]): FavoriteFolder[] {
    if (!Array.isArray(folders)) return [];

    const result: FavoriteFolder[] = [];
    const usedIds = new Set(DEFAULT_FAVORITE_FOLDERS.map((item) => item.id));
    const usedNames = new Set(DEFAULT_FAVORITE_FOLDERS.map((item) => item.name));

    folders.forEach((item) => {
      if (item?.isDefault) return;

      const name = typeof item?.name === 'string' ? item.name.trim() : '';
      const rawId = typeof item?.id === 'string' ? item.id.trim() : '';
      const id = rawId || this.createFavoriteFolderId(name || String(Date.now()));

      if (!id || !name || usedIds.has(id) || usedNames.has(name)) return;

      usedIds.add(id);
      usedNames.add(name);
      result.push({
        id,
        name,
        timestamp: typeof item?.timestamp === 'number' ? item.timestamp : Date.now(),
        isDefault: false,
        source: 'user',
      });
    });

    return result;
  }

  private createFavoriteFolderId(name: string): string {
    const safeName = String(name || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5_-]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);

    return `folder-${safeName || 'custom'}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private mergeFavorites(defaultFavorites: FavoriteItem[], userFavorites: FavoriteItem[]): FavoriteItem[] {
    const defaultUrlSet = new Set(defaultFavorites.map((item) => this.normalizeFavoriteUrl(item.url)));

    const filteredUserFavorites = userFavorites.filter((item) => {
      return !defaultUrlSet.has(this.normalizeFavoriteUrl(item.url));
    });

    return [...defaultFavorites, ...filteredUserFavorites];
  }

  private escapeBookmarkHtml(value: string): string {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  private decodeBookmarkHtml(value: string): string {
    return String(value || '')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
  }

  private normalizeHtmlText(value: string): string {
    return this.decodeBookmarkHtml(
      String(value || '')
        .replace(/\s+/g, ' ')
        .trim(),
    );
  }

  private getHtmlAttribute(tag: string, attrName: string): string {
    const match = String(tag || '').match(new RegExp(`\\s${attrName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));

    return this.normalizeHtmlText(match?.[1] || match?.[2] || match?.[3] || '');
  }

  private getMetaContent(html: string, keys: string[]): string {
    const targetKeys = keys.map((item) => item.toLowerCase());
    const tags = html.match(/<meta\b[^>]*>/gi) || [];

    for (const tag of tags) {
      const name = this.getHtmlAttribute(tag, 'name').toLowerCase();
      const property = this.getHtmlAttribute(tag, 'property').toLowerCase();

      if (targetKeys.includes(name) || targetKeys.includes(property)) {
        return this.getHtmlAttribute(tag, 'content');
      }
    }

    return '';
  }

  private getFavoriteIconFromHtml(html: string, baseUrl: string): string {
    const links = html.match(/<link\b[^>]*>/gi) || [];
    const iconLink = links.find((tag) => {
      const rel = this.getHtmlAttribute(tag, 'rel');
      const type = this.getHtmlAttribute(tag, 'type');

      return /icon/i.test(rel) || /icon/i.test(type);
    });
    const href = iconLink ? this.getHtmlAttribute(iconLink, 'href') : '/favicon.ico';

    try {
      return new URL(href, baseUrl).href;
    } catch {
      return '';
    }
  }

  private buildBookmarksHtml(favorites: FavoriteItem[], folders: FavoriteFolder[]): string {
    const normalizedFolders = [...DEFAULT_FAVORITE_FOLDERS, ...this.normalizeFavoriteFolders(folders)];
    const normalizedFavorites = [...favorites.filter((item) => item?.isDefault), ...this.normalizeUserFavorites(favorites)];
    const nowSeconds = Math.floor(Date.now() / 1000);
    const usedFolderIds = new Set<string>();

    normalizedFavorites.forEach((favorite) => {
      usedFolderIds.add(favorite.folderId || ROOT_FAVORITE_FOLDER_ID);
    });

    const exportFolders = normalizedFolders.filter((folder) => usedFolderIds.has(folder.id));

    if (!exportFolders.some((folder) => folder.id === ROOT_FAVORITE_FOLDER_ID)) {
      const rootFolder = DEFAULT_FAVORITE_FOLDERS.find((folder) => folder.id === ROOT_FAVORITE_FOLDER_ID);

      if (rootFolder) exportFolders.push(rootFolder);
    }

    const lines: string[] = [
      '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
      '<!-- This is an automatically generated file.',
      '     It will be read and overwritten.',
      '     DO NOT EDIT! -->',
      '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
      '<TITLE>Quick Ops Bookmarks</TITLE>',
      '<H1>Quick Ops Bookmarks</H1>',
      '<DL><p>',
    ];

    exportFolders.forEach((folder) => {
      const folderName = folder.name || '未分组';
      const folderFavorites = normalizedFavorites.filter((favorite) => {
        return (favorite.folderId || ROOT_FAVORITE_FOLDER_ID) === folder.id;
      });

      if (folderFavorites.length === 0) return;

      lines.push(`    <DT><H3 ADD_DATE="${nowSeconds}" LAST_MODIFIED="${nowSeconds}">${this.escapeBookmarkHtml(folderName)}</H3>`);
      lines.push('    <DL><p>');

      folderFavorites.forEach((favorite) => {
        const attrs = [`HREF="${this.escapeBookmarkHtml(favorite.url)}"`, `ADD_DATE="${Math.max(0, Math.floor((favorite.timestamp || Date.now()) / 1000))}"`];

        if (favorite.logo) {
          attrs.push(`ICON="${this.escapeBookmarkHtml(favorite.logo)}"`);
        }

        lines.push(`        <DT><A ${attrs.join(' ')}>${this.escapeBookmarkHtml(favorite.title || favorite.url)}</A>`);
      });

      lines.push('    </DL><p>');
    });

    lines.push('</DL><p>');

    return lines.join('\n');
  }

  private parseBookmarkAttributes(attrText: string): Record<string, string> {
    const result: Record<string, string> = {};
    const attrReg = /([a-zA-Z0-9_-]+)=("([^"]*)"|'([^']*)')/g;
    let match: RegExpExecArray | null;

    while ((match = attrReg.exec(attrText))) {
      result[match[1].toUpperCase()] = this.decodeBookmarkHtml(match[3] ?? match[4] ?? '');
    }

    return result;
  }

  private parseImportedBookmarksHtml(content: string): {
    favorites: FavoriteItem[];
    folders: FavoriteFolder[];
  } {
    const folders: FavoriteFolder[] = [];
    const favorites: FavoriteItem[] = [];
    const folderStack: string[] = [];
    const folderIdByName = new Map<string, string>();
    let pendingFolderName = '';

    const ensureFolder = (name: string): string => {
      const folderName = name.trim() || '未分组';

      if (folderName === '默认书签') return DEFAULT_FAVORITE_FOLDER_ID;
      if (folderName === '未分组') return ROOT_FAVORITE_FOLDER_ID;

      const cached = folderIdByName.get(folderName);

      if (cached) return cached;

      const folder: FavoriteFolder = {
        id: this.createFavoriteFolderId(folderName),
        name: folderName,
        timestamp: Date.now(),
        isDefault: false,
        source: 'user',
      };

      folderIdByName.set(folderName, folder.id);
      folders.push(folder);

      return folder.id;
    };

    content.split(/\r?\n/).forEach((line) => {
      const folderMatch = line.match(/<DT>\s*<H3\b[^>]*>([\s\S]*?)<\/H3>/i);

      if (folderMatch) {
        pendingFolderName = this.decodeBookmarkHtml(folderMatch[1].replace(/<[^>]+>/g, '').trim());
        return;
      }

      if (/<DL\b/i.test(line)) {
        if (pendingFolderName) {
          folderStack.push(pendingFolderName);
          pendingFolderName = '';
        } else {
          folderStack.push('');
        }
      }

      const linkMatch = line.match(/<DT>\s*<A\b([^>]*)>([\s\S]*?)<\/A>/i);

      if (linkMatch) {
        const attrs = this.parseBookmarkAttributes(linkMatch[1]);
        const url = (attrs.HREF || '').trim();
        const title = this.decodeBookmarkHtml(linkMatch[2].replace(/<[^>]+>/g, '').trim()) || url;

        if (!url || !title) return;

        const currentFolderName = [...folderStack].reverse().find((item) => item.trim()) || '未分组';
        const timestampSeconds = Number(attrs.ADD_DATE) || 0;

        favorites.push({
          url,
          title,
          logo: attrs.ICON || '',
          description: '',
          folderId: ensureFolder(currentFolderName),
          timestamp: timestampSeconds > 0 ? timestampSeconds * 1000 : Date.now(),
          isDefault: false,
          source: 'user',
        });
      }

      if (/<\/DL>/i.test(line)) {
        folderStack.pop();
      }
    });

    return {
      favorites: this.normalizeUserFavorites(favorites),
      folders: this.normalizeFavoriteFolders(folders),
    };
  }
}
