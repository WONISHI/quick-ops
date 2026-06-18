import * as vscode from 'vscode';
import * as path from 'path';
import { IFeature } from '../core/interfaces/feature.interface';
import ColorLog from '../utils/ColorLog';
import { getReactWebviewHtml } from '../utils/WebviewHelper';
import { EmbeddedBrowserService } from '../services/EmbeddedBrowserService';
import { DevToolsWebviewProvider } from '../providers/DevToolsWebviewProvider';

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

type LocalPreviewFileType = 'md' | 'pdf' | 'excel' | 'html';

export class LivePreviewFeature implements IFeature {
  public readonly id = 'LivePreviewFeature';

  private readonly GLOBAL_FAVORITES_KEY = 'quickOps.globalFavorites';

  private panel: vscode.WebviewPanel | undefined;

  private pendingLocalFile: { fsPath: string; fileType: LocalPreviewFileType } | null = null;
  private defaultFavoritesCache: FavoriteItem[] | null = null;

  private browserService: EmbeddedBrowserService | null = null;
  private devToolsProvider: DevToolsWebviewProvider | null = null;

  public async activate(context: vscode.ExtensionContext): Promise<void> {
    context.globalState.setKeysForSync([this.GLOBAL_FAVORITES_KEY]);

    this.devToolsProvider = new DevToolsWebviewProvider(context.extensionUri);

    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(
        DevToolsWebviewProvider.viewType,
        this.devToolsProvider,
        {
          webviewOptions: {
            retainContextWhenHidden: true,
          },
        }
      )
    );

    const command = vscode.commands.registerCommand('quick-ops.openLivePreview', () => {
      this.togglePreviewPanel(context);
    });

    const windowFocusWatcher = vscode.window.onDidChangeWindowState((state) => {
      if (state.focused && this.panel) {
        void this.syncFavorites(context);
      }
    });

    context.subscriptions.push(command, windowFocusWatcher);

    context.subscriptions.push({
      dispose: () => {
        void this.browserService?.dispose();
        this.browserService = null;
      },
    });

    ColorLog.black(`[${this.id}]`, 'Activated.');
  }

  private togglePreviewPanel(context: vscode.ExtensionContext) {
    if (this.panel?.visible) {
      this.panel.dispose();
      return;
    }

    this.showPreviewPanel(context);
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

      for (const file of jsonFiles) {
        const fileUri = vscode.Uri.joinPath(bookmarksDirUri, file);
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

  private getDefaultLocalResourceRoots(context: vscode.ExtensionContext): vscode.Uri[] {
    const roots: vscode.Uri[] = [context.extensionUri];

    const workspaceFolders = vscode.workspace.workspaceFolders || [];

    for (const folder of workspaceFolders) {
      roots.push(folder.uri);
    }

    return roots;
  }

  private getLocalResourceRoots(context: vscode.ExtensionContext, fileUri?: vscode.Uri): vscode.Uri[] {
    const roots = this.getDefaultLocalResourceRoots(context);

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

  private updateWebviewLocalRoots(context: vscode.ExtensionContext, fileUri?: vscode.Uri): void {
    if (!this.panel) return;

    this.panel.webview.options = {
      ...this.panel.webview.options,
      localResourceRoots: this.getLocalResourceRoots(context, fileUri),
    };
  }

  private parseLocalFileUri(fsPath: string): vscode.Uri {
    const value = String(fsPath || '').trim();

    if (/^file:\/\//i.test(value)) {
      return vscode.Uri.parse(value);
    }

    if (/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(value)) {
      return vscode.Uri.parse(value);
    }

    return vscode.Uri.file(value);
  }

  private parseExternalUri(rawUrl: string): vscode.Uri {
    const value = String(rawUrl || '').trim();

    if (/^file:\/\//i.test(value)) {
      return vscode.Uri.parse(value);
    }

    if (/^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('/')) {
      return vscode.Uri.file(value);
    }

    return vscode.Uri.parse(value);
  }

  private isSkipRewriteUrl(rawUrl: string): boolean {
    const url = rawUrl.trim();

    if (!url) return true;

    return url.startsWith('#') || url.startsWith('//') || /^(https?:|data:|blob:|mailto:|tel:|javascript:|vscode-webview-resource:|vscode-resource:|vscode-webview:)/i.test(url);
  }

  private splitUrlSuffix(rawUrl: string): { pathname: string; suffix: string } {
    const match = rawUrl.match(/^([^?#]*)([?#].*)?$/);

    return {
      pathname: match?.[1] || rawUrl,
      suffix: match?.[2] || '',
    };
  }

  private async uriExists(uri: vscode.Uri): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(uri);
      return true;
    } catch {
      return false;
    }
  }

  private async resolveHtmlAssetUri(rawUrl: string, htmlFileUri: vscode.Uri): Promise<vscode.Uri | null> {
    const { pathname } = this.splitUrlSuffix(rawUrl);

    if (!pathname) return null;

    try {
      if (/^file:\/\//i.test(pathname)) {
        return vscode.Uri.parse(pathname);
      }

      if (/^[a-zA-Z]:[\\/]/.test(pathname)) {
        return vscode.Uri.file(pathname);
      }

      const htmlDir = path.dirname(htmlFileUri.fsPath);

      if (pathname.startsWith('/')) {
        const cleanPath = pathname.replace(/^[/\\]+/, '');

        const htmlDirCandidate = vscode.Uri.file(path.join(htmlDir, cleanPath));

        if (await this.uriExists(htmlDirCandidate)) {
          return htmlDirCandidate;
        }

        const workspaceFolders = vscode.workspace.workspaceFolders || [];

        for (const folder of workspaceFolders) {
          const workspaceCandidate = vscode.Uri.joinPath(folder.uri, cleanPath);

          if (await this.uriExists(workspaceCandidate)) {
            return workspaceCandidate;
          }
        }

        return vscode.Uri.file(pathname);
      }

      if (path.isAbsolute(pathname)) {
        return vscode.Uri.file(pathname);
      }

      const absolutePath = path.resolve(htmlDir, pathname);

      return vscode.Uri.file(absolutePath);
    } catch {
      return null;
    }
  }

  private escapeHtmlAttribute(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  private async toWebviewAssetUrl(rawUrl: string, htmlFileUri: vscode.Uri, webview: vscode.Webview): Promise<string> {
    const trimmed = String(rawUrl || '').trim();

    if (this.isSkipRewriteUrl(trimmed)) {
      return rawUrl;
    }

    const { suffix } = this.splitUrlSuffix(trimmed);
    const assetUri = await this.resolveHtmlAssetUri(trimmed, htmlFileUri);

    if (!assetUri) {
      return rawUrl;
    }

    return `${webview.asWebviewUri(assetUri).toString()}${suffix}`;
  }

  private async rewriteTagAttr(tag: string, htmlFileUri: vscode.Uri, webview: vscode.Webview): Promise<string> {
    const attrReg = /\s(href|src|poster)=("([^"]*)"|'([^']*)'|([^\s>]+))/gi;

    let result = '';
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = attrReg.exec(tag))) {
      const matchIndex = match.index ?? 0;

      result += tag.slice(lastIndex, matchIndex);

      const full = match[0];
      const attrName = match[1];
      const rawValue = match[2];
      const doubleValue = match[3];
      const singleValue = match[4];
      const noQuoteValue = match[5];

      const value = doubleValue ?? singleValue ?? noQuoteValue ?? '';

      if (!value) {
        result += full;
        lastIndex = matchIndex + full.length;
        continue;
      }

      const nextValue = await this.toWebviewAssetUrl(value, htmlFileUri, webview);
      const safeValue = this.escapeHtmlAttribute(nextValue);

      if (rawValue.startsWith("'")) {
        result += ` ${attrName}='${safeValue}'`;
      } else {
        result += ` ${attrName}="${safeValue}"`;
      }

      lastIndex = matchIndex + full.length;
    }

    result += tag.slice(lastIndex);

    return result;
  }

  private async rewriteLocalHtmlAssets(html: string, htmlFileUri: vscode.Uri, webview: vscode.Webview): Promise<string> {
    if (!html) return html;

    const tagReg = /<(link|script|img|source|video|audio|iframe)\b[^>]*>/gi;

    let result = '';
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = tagReg.exec(html))) {
      const matchIndex = match.index ?? 0;
      const tag = match[0];

      result += html.slice(lastIndex, matchIndex);
      result += await this.rewriteTagAttr(tag, htmlFileUri, webview);

      lastIndex = matchIndex + tag.length;
    }

    result += html.slice(lastIndex);

    return result;
  }

  private async readLocalFile(fileUri: vscode.Uri): Promise<Uint8Array> {
    return vscode.workspace.fs.readFile(fileUri);
  }

  private async loadLocalHtmlFile(context: vscode.ExtensionContext, fsPath: string): Promise<void> {
    try {
      const fileUri = this.parseLocalFileUri(fsPath);

      this.updateWebviewLocalRoots(context, fileUri);

      const contentBytes = await vscode.workspace.fs.readFile(fileUri);
      const contentStr = Buffer.from(contentBytes).toString('utf8');
      const rewrittenHtml = await this.rewriteLocalHtmlAssets(contentStr, fileUri, this.panel!.webview);

      this.panel?.webview.postMessage({
        type: 'initHtmlData',
        fsPath,
        fileName: path.basename(fileUri.fsPath || fsPath),
        content: rewrittenHtml,
      });
    } catch (e) {
      vscode.window.showErrorMessage(`HTML 文件读取失败: ${fsPath}`);

      this.panel?.webview.postMessage({
        type: 'initLocalFileError',
        fsPath,
        message: `HTML 文件读取失败: ${fsPath}`,
      });
    }
  }


  private ensureBrowserService(context: vscode.ExtensionContext): EmbeddedBrowserService {
    if (this.browserService) return this.browserService;

    this.browserService = new EmbeddedBrowserService(context);

    this.browserService.on('frame', (frame) => {
      this.panel?.webview.postMessage({
        type: 'browserFrame',
        ...frame,
      });
    });

    this.browserService.on('pageLoaded', (payload) => {
      this.panel?.webview.postMessage({
        type: 'browserPageLoaded',
        ...payload,
      });
    });

    this.browserService.on('urlChanged', (payload) => {
      this.panel?.webview.postMessage({
        type: 'browserUrlChanged',
        ...payload,
      });
    });

    this.browserService.on('titleChanged', (payload) => {
      this.panel?.webview.postMessage({
        type: 'browserTitleChanged',
        ...payload,
      });
    });

    this.browserService.on('pageError', (payload) => {
      this.panel?.webview.postMessage({
        type: 'browserPageError',
        ...payload,
      });
    });

    return this.browserService;
  }

  private async postBrowserSnapshot(): Promise<boolean> {
    if (!this.panel || !this.browserService) return false;

    const snapshot = await this.browserService.getSnapshot();

    if (!snapshot.hasPage && !snapshot.frame) return false;

    if (snapshot.frame) {
      this.panel.webview.postMessage({
        type: 'browserFrame',
        ...snapshot.frame,
      });
    }

    if (snapshot.url) {
      this.panel.webview.postMessage({
        type: 'browserUrlChanged',
        url: snapshot.url,
      });

      this.panel.webview.postMessage({
        type: 'browserPageLoaded',
        url: snapshot.url,
        title: snapshot.title || snapshot.url,
      });
    }

    return true;
  }

  private async postFavoritesToPanel(context: vscode.ExtensionContext, panel: vscode.WebviewPanel): Promise<void> {
    const mergedFavorites = await this.getMergedFavorites(context);

    panel.webview.postMessage({
      type: 'syncFavorites',
      favorites: mergedFavorites,
    });
  }

  private ensureDetachedBrowserService(context: vscode.ExtensionContext, panel: vscode.WebviewPanel): EmbeddedBrowserService {
    const service = new EmbeddedBrowserService(context, `BrowserUserData-${Date.now()}-${Math.random().toString(16).slice(2)}`);

    service.on('frame', (frame) => {
      panel.webview.postMessage({
        type: 'browserFrame',
        ...frame,
      });
    });

    service.on('pageLoaded', (payload) => {
      panel.webview.postMessage({
        type: 'browserPageLoaded',
        ...payload,
      });
    });

    service.on('urlChanged', (payload) => {
      panel.webview.postMessage({
        type: 'browserUrlChanged',
        ...payload,
      });
    });

    service.on('titleChanged', (payload) => {
      panel.webview.postMessage({
        type: 'browserTitleChanged',
        ...payload,
      });
    });

    service.on('pageError', (payload) => {
      panel.webview.postMessage({
        type: 'browserPageError',
        ...payload,
      });
    });

    return service;
  }

  private createNewPreviewTab(context: vscode.ExtensionContext, initialUrl = '', initialDevice = ''): void {
    const targetColumn = this.panel?.viewColumn || vscode.ViewColumn.Active;

    const panel = vscode.window.createWebviewPanel('quickOpsLivePreview', '网页预览 (Preview)', targetColumn, {
      enableScripts: true,
      retainContextWhenHidden: true,
      enableFindWidget: true,
      localResourceRoots: this.getLocalResourceRoots(context),
    });

    panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'resources', 'icons', 'livepreview.svg');

    const browserService = this.ensureDetachedBrowserService(context, panel);
    const lastDevice = initialDevice || context.workspaceState.get<string>('quickOps.lastPreviewDevice') || 'device-responsive';
    const lastUrl = String(initialUrl || context.workspaceState.get<string>('quickOps.lastPreviewUrl') || '').trim();
    let hasSentInit = false;

    panel.title = '网页预览 (Preview)';
    panel.webview.html = getReactWebviewHtml(context.extensionUri, panel.webview, '/preview');
    panel.reveal(targetColumn, false);

    const postInit = async () => {
      if (hasSentInit) return;

      hasSentInit = true;

      panel.webview.postMessage({
        type: 'init',
        device: lastDevice,
        url: lastUrl,
      });

      await this.postFavoritesToPanel(context, panel);
    };

    panel.onDidChangeViewState((event) => {
      if (event.webviewPanel.visible) {
        void this.postFavoritesToPanel(context, panel);
      }
    });

    panel.onDidDispose(() => {
      void browserService.dispose();
    });

    const runDetachedBrowserAction = async (action: () => Promise<void>) => {
      try {
        await action();
      } catch (error: any) {
        panel.webview.postMessage({
          type: 'browserPageError',
          url: lastUrl,
          message: error?.message || String(error),
        });
      }
    };

    panel.webview.onDidReceiveMessage(async (message) => {
      if (message.type === 'ready') {
        await postInit();
      } else if (message.type === 'saveUrl') {
        await context.workspaceState.update('quickOps.lastPreviewUrl', message.url || '');
      } else if (message.type === 'saveDevice') {
        await context.workspaceState.update('quickOps.lastPreviewDevice', message.device);
      } else if (message.type === 'reqSyncFavorites') {
        await this.postFavoritesToPanel(context, panel);
      } else if (message.type === 'saveAllFavorites') {
        await this.saveUserFavorites(context, message.favorites || []);
        await this.postFavoritesToPanel(context, panel);
      } else if (message.type === 'toggleFavorite') {
        const defaultFavorites = await this.loadDefaultFavorites(context);
        const targetUrlKey = this.normalizeFavoriteUrl(message.url);

        const isDefaultFavorite = defaultFavorites.some((item) => {
          return this.normalizeFavoriteUrl(item.url) === targetUrlKey;
        });

        if (isDefaultFavorite) {
          vscode.window.showInformationMessage('该收藏是插件内置默认书签，不能取消收藏。');
          await this.postFavoritesToPanel(context, panel);
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
            logo: typeof message.logo === 'string' ? message.logo : '',
            description: typeof message.description === 'string' ? message.description : '',
            timestamp: Date.now(),
            isDefault: false,
            source: 'user',
          });
        }

        await context.globalState.update(this.GLOBAL_FAVORITES_KEY, favs);
        await this.postFavoritesToPanel(context, panel);
      } else if (message.type === 'openNewPreviewTab') {
        this.createNewPreviewTab(context, message.url || '', message.device || '');
      } else if (message.type === 'browserNavigate') {
        await runDetachedBrowserAction(() => browserService.navigate(message.url || 'about:blank'));
      } else if (message.type === 'browserRefresh') {
        await runDetachedBrowserAction(() => browserService.reload(message.url || undefined));
      } else if (message.type === 'browserStopLoading') {
        await runDetachedBrowserAction(() => browserService.stopLoading());
      } else if (message.type === 'browserCopySelection') {
        await runDetachedBrowserAction(() => browserService.copySelectedText());
      } else if (message.type === 'browserSelectTextRange') {
        await runDetachedBrowserAction(() =>
          browserService.selectTextRange(
            Number(message.startX) || 0,
            Number(message.startY) || 0,
            Number(message.endX) || 0,
            Number(message.endY) || 0
          )
        );
      } else if (message.type === 'browserSearch') {
        await runDetachedBrowserAction(async () => {
          const result = await browserService.searchInPage(message.keyword || '', message.direction === 'previous' ? 'previous' : 'next');

          panel.webview.postMessage({
            type: 'browserSearchResult',
            ...result,
          });
        });
      } else if (message.type === 'browserBack') {
        await runDetachedBrowserAction(() => browserService.goBack());
      } else if (message.type === 'browserForward') {
        await runDetachedBrowserAction(() => browserService.goForward());
      } else if (message.type === 'browserSetViewport') {
        await runDetachedBrowserAction(() =>
          browserService.setViewport({
            width: message.width,
            height: message.height,
            deviceScaleFactor: message.deviceScaleFactor,
          })
        );
      } else if (message.type === 'browserInput') {
        await runDetachedBrowserAction(() => browserService.dispatchInput(message));
      } else if (message.type === 'browserClearCache') {
        await runDetachedBrowserAction(() => browserService.clearCache());
      } else if (message.type === 'openDevTools') {
        await runDetachedBrowserAction(async () => {
          const devToolsUrl = await browserService.getDevToolsUrl();

          if (!devToolsUrl) {
            await browserService.openDevTools();
            return;
          }

          await this.devToolsProvider?.open(devToolsUrl);
        });
      } else if (message.type === 'browserStop') {
        await runDetachedBrowserAction(() => browserService.stop());
      } else if (message.type === 'openExternalBrowser') {
        const rawUrl = message.url || '';
        if (rawUrl) {
          await vscode.env.openExternal(this.parseExternalUri(rawUrl));
        }
      } else if (message.type === 'showInfo') {
        vscode.window.showInformationMessage(message.message || '');
      } else if (message.type === 'showError') {
        vscode.window.showErrorMessage(message.message || '');
      }
    });
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
      localResourceRoots: this.getLocalResourceRoots(context),
    });

    this.panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'resources', 'icons', 'livepreview.svg');

    this.panel.onDidChangeViewState((event) => {
      if (event.webviewPanel.visible) {
        void this.syncFavorites(context);
      }
    });

    this.panel.onDidDispose(() => {
      this.panel = undefined;
      this.pendingLocalFile = null;
      // 不在面板关闭时停止浏览器页面。
      // 这样下次重新打开 Live Preview 时，可以直接恢复上一次的页面截图和 URL，不会重新请求页面。
    });

    const lastUrl = context.workspaceState.get<string>('quickOps.lastPreviewUrl') || '';
    const lastDevice = context.workspaceState.get<string>('quickOps.lastPreviewDevice') || 'device-responsive';

    this.panel.webview.html = getReactWebviewHtml(context.extensionUri, this.panel.webview, '/preview');

    this.panel.webview.onDidReceiveMessage(async (message) => {
      if (message.type === 'ready') {
        const restored = await this.postBrowserSnapshot();

        this.panel?.webview.postMessage({
          type: 'init',
          device: lastDevice,
          url: restored ? '' : lastUrl,
        });

        if (restored) {
          await this.postBrowserSnapshot();
        }

        await this.syncFavorites(context);
      } else if (message.type === 'saveUrl') {
        await context.workspaceState.update('quickOps.lastPreviewUrl', message.url || '');
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
            logo: typeof message.logo === 'string' ? message.logo : '',
            description: typeof message.description === 'string' ? message.description : '',
            timestamp: Date.now(),
            isDefault: false,
            source: 'user',
          });
        }

        await context.globalState.update(this.GLOBAL_FAVORITES_KEY, favs);
        await this.syncFavorites(context);
      } else if (message.type === 'openNewPreviewTab') {
        this.createNewPreviewTab(context, message.url || '', message.device || '');
      } else if (message.type === 'browserNavigate') {
        await this.ensureBrowserService(context).navigate(message.url || 'about:blank');
      } else if (message.type === 'browserRefresh') {
        await this.ensureBrowserService(context).reload(message.url || undefined);
      } else if (message.type === 'browserStopLoading') {
        await this.ensureBrowserService(context).stopLoading();
      } else if (message.type === 'browserCopySelection') {
        await this.ensureBrowserService(context).copySelectedText();
      } else if (message.type === 'browserSelectTextRange') {
        await this.ensureBrowserService(context).selectTextRange(
          Number(message.startX) || 0,
          Number(message.startY) || 0,
          Number(message.endX) || 0,
          Number(message.endY) || 0
        );
      } else if (message.type === 'browserSearch') {
        const result = await this.ensureBrowserService(context).searchInPage(
          message.keyword || '',
          message.direction === 'previous' ? 'previous' : 'next'
        );

        this.panel?.webview.postMessage({
          type: 'browserSearchResult',
          ...result,
        });
      } else if (message.type === 'browserBack') {
        await this.ensureBrowserService(context).goBack();
      } else if (message.type === 'browserForward') {
        await this.ensureBrowserService(context).goForward();
      } else if (message.type === 'browserSetViewport') {
        await this.ensureBrowserService(context).setViewport({
          width: message.width,
          height: message.height,
          deviceScaleFactor: message.deviceScaleFactor,
        });
      } else if (message.type === 'browserInput') {
        await this.ensureBrowserService(context).dispatchInput(message as any);
      } else if (message.type === 'browserClearCache') {
        await this.ensureBrowserService(context).clearCache();
      } else if (message.type === 'browserStop') {
        await this.browserService?.stop();
      } else if (message.type === 'showInfo') {
        vscode.window.showInformationMessage(message.message || '');
      } else if (message.type === 'showWarning') {
        vscode.window.showWarningMessage(message.message || '');
      } else if (message.type === 'showError') {
        vscode.window.showErrorMessage(message.message || '');
      } else if (message.type === 'openDevTools') {
        const service = this.ensureBrowserService(context);
        const devToolsUrl = await service.getDevToolsUrl();

        if (!devToolsUrl) {
          await service.openDevTools();
          return;
        }

        await this.devToolsProvider?.open(devToolsUrl);
      } else if (message.type === 'openExternalBrowser') {
        vscode.env.openExternal(this.parseExternalUri(message.url));
      } else if (message.type === 'loadLocalHtmlFile') {
        await this.loadLocalHtmlFile(context, message.fsPath);
      } else if (message.type === 'setPendingLocalFile') {
        this.pendingLocalFile = {
          fsPath: message.fsPath,
          fileType: message.fileType as LocalPreviewFileType,
        };

        try {
          const fileUri = this.parseLocalFileUri(message.fsPath);
          this.updateWebviewLocalRoots(context, fileUri);
        } catch {
          this.updateWebviewLocalRoots(context);
        }
      } else if (message.command === 'webviewLoaded') {
        if (!this.pendingLocalFile) return;

        const { fsPath, fileType } = this.pendingLocalFile;

        try {
          const fileUri = this.parseLocalFileUri(fsPath);
          const contentBytes = await this.readLocalFile(fileUri);

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
              fileName: path.basename(fileUri.fsPath || fsPath),
              contentBase64: fileBase64,
            });
          }
        } catch (e) {
          vscode.window.showErrorMessage(`文件读取失败: ${fsPath}`);

          this.panel?.webview.postMessage({
            type: 'initLocalFileError',
            fsPath,
            message: `文件读取失败: ${fsPath}`,
          });
        }
      }
    });
  }
}

/**
 * 调整一下favicon-img这个元素用来放置浏览器的图标，点击可以切换其他浏览器，可以切换成百度，bing和夸克，这里用来放置
 */