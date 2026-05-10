import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { IFeature } from '../core/interfaces/IFeature';
import ColorLog from '../utils/ColorLog';
import { getReactWebviewHtml } from '../utils/WebviewHelper';

interface BuiltinBookmark {
  name: string;
  url: string;
  description: string;
  logo: string;
}

interface FavoriteItem {
  url: string;
  title: string;
  timestamp: number;
  description?: string;
  logo?: string;
  isDefault?: boolean;
  source?: 'builtin' | 'user';
}

export class LivePreviewFeature implements IFeature {
  public readonly id = 'LivePreviewFeature';

  private readonly GLOBAL_FAVORITES_KEY = 'quickOps.globalFavorites';

  private panel: vscode.WebviewPanel | undefined;

  private pendingLocalFile: { fsPath: string; fileType: string } | null = null;
  private defaultFavoritesCache: FavoriteItem[] | null = null;

  public activate(context: vscode.ExtensionContext): void {
    context.globalState.setKeysForSync([this.GLOBAL_FAVORITES_KEY]);

    const command = vscode.commands.registerCommand('quick-ops.openLivePreview', () => {
      this.showPreviewPanel(context);
    });

    const windowFocusWatcher = vscode.window.onDidChangeWindowState((state) => {
      if (state.focused && this.panel) {
        void this.syncFavorites(context);
      }
    });

    context.subscriptions.push(command, windowFocusWatcher);

    ColorLog.black(`[${this.id}]`, 'Activated.');
  }

  private normalizeFavoriteUrl(url: string): string {
    return (url || '').trim().replace(/\/+$/, '');
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
      timestamp: 0 - index,
      isDefault: true,
      source: 'builtin',
    };
  }

  private extractFavoriteArray(jsonData: unknown): BuiltinBookmark[] {
    if (!Array.isArray(jsonData)) return [];
    return jsonData as BuiltinBookmark[];
  }

  private async loadDefaultFavorites(context: vscode.ExtensionContext): Promise<FavoriteItem[]> {
    if (this.defaultFavoritesCache) return this.defaultFavoritesCache;

    const bookmarksDir = path.join(context.extensionUri.fsPath, 'resources', 'bookmarks');
    const result: FavoriteItem[] = [];
    const usedUrls = new Set<string>();

    try {
      const files = await fs.readdir(bookmarksDir);
      const jsonFiles = files.filter((file) => file.toLowerCase().endsWith('.json'));

      for (const file of jsonFiles) {
        const filePath = path.join(bookmarksDir, file);
        const content = await fs.readFile(filePath, 'utf8');
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
      console.warn(`[${this.id}] load default bookmarks failed:`, error);
    }

    this.defaultFavoritesCache = result;
    return result;
  }

  private normalizeUserFavorites(favorites: any[]): FavoriteItem[] {
    const result: FavoriteItem[] = [];
    const usedUrls = new Set<string>();

    favorites.forEach((item) => {
      if (item?.isDefault) return;

      const url = typeof item?.url === 'string' ? item.url.trim() : '';
      const title = typeof item?.title === 'string' ? item.title.trim() : '';

      if (!url || !title) return;

      const key = this.normalizeFavoriteUrl(url);
      if (usedUrls.has(key)) return;

      usedUrls.add(key);

      result.push({
        url,
        title,
        description: typeof item?.description === 'string' ? item.description : '',
        logo: typeof item?.logo === 'string' ? item.logo : '',
        timestamp: typeof item?.timestamp === 'number' ? item.timestamp : Date.now(),
        isDefault: false,
        source: 'user',
      });
    });

    return result;
  }

  private mergeFavorites(defaultFavorites: FavoriteItem[], userFavorites: FavoriteItem[]): FavoriteItem[] {
    const defaultUrlSet = new Set(defaultFavorites.map((item) => this.normalizeFavoriteUrl(item.url)));

    const filteredUserFavorites = userFavorites.filter((item) => {
      return !defaultUrlSet.has(this.normalizeFavoriteUrl(item.url));
    });

    return [...defaultFavorites, ...filteredUserFavorites];
  }

  private async getMergedFavorites(context: vscode.ExtensionContext): Promise<FavoriteItem[]> {
    const defaultFavorites = await this.loadDefaultFavorites(context);
    const userFavorites = this.normalizeUserFavorites(context.globalState.get<any[]>(this.GLOBAL_FAVORITES_KEY) || []);

    return this.mergeFavorites(defaultFavorites, userFavorites);
  }

  private async syncFavorites(context: vscode.ExtensionContext): Promise<void> {
    const mergedFavorites = await this.getMergedFavorites(context);

    this.panel?.webview.postMessage({
      type: 'syncFavorites',
      favorites: mergedFavorites,
    });
  }

  private async saveUserFavorites(context: vscode.ExtensionContext, favorites: any[]): Promise<void> {
    const userFavorites = this.normalizeUserFavorites(favorites);
    await context.globalState.update(this.GLOBAL_FAVORITES_KEY, userFavorites);
    await this.syncFavorites(context);
  }

  private showPreviewPanel(context: vscode.ExtensionContext) {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
      void this.syncFavorites(context);
      return;
    }

    this.panel = vscode.window.createWebviewPanel('quickOpsLivePreview', '网页预览 (Preview)', vscode.ViewColumn.Beside, {
      enableScripts: true,
      retainContextWhenHidden: true,
      enableFindWidget: true,
      localResourceRoots: [context.extensionUri],
    });

    this.panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'icon.png');

    this.panel.onDidChangeViewState((event) => {
      if (event.webviewPanel.visible) {
        void this.syncFavorites(context);
      }
    });

    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });

    const lastUrl = context.workspaceState.get<string>('quickOps.lastPreviewUrl') || '';
    const lastDevice = context.workspaceState.get<string>('quickOps.lastPreviewDevice') || 'device-responsive';

    this.panel.webview.html = getReactWebviewHtml(context.extensionUri, this.panel.webview, '/preview');

    setTimeout(() => {
      this.panel?.webview.postMessage({ type: 'init', device: lastDevice, url: lastUrl });
    }, 500);

    this.panel.webview.onDidReceiveMessage(async (message) => {
      if (message.type === 'ready') {
        this.panel?.webview.postMessage({ type: 'init', device: lastDevice, url: lastUrl });
        await this.syncFavorites(context);
      } else if (message.type === 'saveUrl') {
        await context.workspaceState.update('quickOps.lastPreviewUrl', message.url);
      } else if (message.type === 'saveDevice') {
        await context.workspaceState.update('quickOps.lastPreviewDevice', message.device);
      } else if (message.type === 'reqSyncFavorites') {
        await this.syncFavorites(context);
      } else if (message.type === 'saveAllFavorites') {
        await this.saveUserFavorites(context, message.favorites || []);
      } else if (message.type === 'toggleFavorite') {
        const defaultFavorites = await this.loadDefaultFavorites(context);
        const targetUrlKey = this.normalizeFavoriteUrl(message.url);

        const isDefaultFavorite = defaultFavorites.some((item) => {
          return this.normalizeFavoriteUrl(item.url) === targetUrlKey;
        });

        if (isDefaultFavorite) {
          vscode.window.showInformationMessage('该收藏是插件内置默认书签，不能取消收藏。');
          await this.syncFavorites(context);
          return;
        }

        const favs = this.normalizeUserFavorites(context.globalState.get<any[]>(this.GLOBAL_FAVORITES_KEY) || []);
        const index = favs.findIndex((f) => this.normalizeFavoriteUrl(f.url) === targetUrlKey);

        if (index > -1) {
          favs.splice(index, 1);
        } else {
          favs.push({
            url: message.url,
            title: message.title || message.url,
            timestamp: Date.now(),
            isDefault: false,
            source: 'user',
          });
        }

        await context.globalState.update(this.GLOBAL_FAVORITES_KEY, favs);
        await this.syncFavorites(context);
      } else if (message.type === 'showInfo') {
        vscode.window.showInformationMessage(message.message || '');
      } else if (message.type === 'showWarning') {
        vscode.window.showWarningMessage(message.message || '');
      } else if (message.type === 'showError') {
        vscode.window.showErrorMessage(message.message || '');
      } else if (message.type === 'openDevTools') {
        vscode.commands.executeCommand('workbench.action.webview.openDeveloperTools');
      } else if (message.type === 'openExternalBrowser') {
        vscode.env.openExternal(vscode.Uri.parse(message.url));
      } else if (message.type === 'setPendingLocalFile') {
        this.pendingLocalFile = { fsPath: message.fsPath, fileType: message.fileType };
      } else if (message.command === 'webviewLoaded') {
        if (this.pendingLocalFile) {
          const { fsPath, fileType } = this.pendingLocalFile;

          try {
            const fileUri = fsPath.includes('://') ? vscode.Uri.parse(fsPath) : vscode.Uri.file(fsPath);
            const contentBytes = await vscode.workspace.fs.readFile(fileUri);

            if (fileType === 'md') {
              const contentStr = Buffer.from(contentBytes).toString('utf8');
              this.panel?.webview.postMessage({
                type: 'initVditorData',
                content: contentStr,
                mode: 'read',
                fsPath,
              });
            } else if (fileType === 'pdf') {
              const fileBase64 = Buffer.from(contentBytes).toString('base64');
              this.panel?.webview.postMessage({
                type: 'initPdfData',
                contentBase64: fileBase64,
                initialScale: 0.8,
              });
            } else if (fileType === 'excel') {
              const fileBase64 = Buffer.from(contentBytes).toString('base64');
              this.panel?.webview.postMessage({
                type: 'initExcelData',
                fsPath,
                fileName: path.basename(fsPath),
                contentBase64: fileBase64,
              });
            }
          } catch (e) {
            vscode.window.showErrorMessage(`文件读取失败: ${fsPath}`);
          }
        }
      }
    });
  }
}