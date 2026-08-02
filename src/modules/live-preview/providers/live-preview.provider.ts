import * as vscode from 'vscode';
import * as path from 'path';

import WebviewWorkflow from '@/workflow/webview';
import ReactWebviewHtmlWorkflow from '@/workflow/react-webview-html';
import { ExtensionContextProvider } from '@common/providers/extension-context.provider';
import { LivePreviewService } from '@modules/live-preview/live-preview.service';
import { EmbeddedBrowserService } from '@modules/live-preview/services/embedded-browser.service';
import { DevToolsWebviewProvider } from '@modules/live-preview/providers/dev-tools-webview.provider';
import type { PendingLocalFile } from '@modules/live-preview/live-preview.type';
import type { WebviewEnhancerOptions } from '@plugins/webview-enhancer/type';

interface PreviewTabRecord {
  id: string;
  panel: vscode.WebviewPanel;
  browserService: EmbeddedBrowserService;
  title: string;
  url: string;
  isMain: boolean;
}

interface PreviewTabInfo {
  id: string;
  title: string;
  url: string;
  active: boolean;
}

/**
 * @description Live Preview Webview Provider
 *
 * 负责：
 * 1. 打开 / 关闭网页预览 Webview
 * 2. 通过 WebviewWorkflow 统一创建 WebviewPanel
 * 3. 同步收藏、收藏夹及导入导出能力
 * 4. 处理 Webview 发回来的消息
 * 5. 支持本地 markdown / pdf / excel / html 文件预览
 * 6. 连接 Puppeteer 内嵌浏览器并转发截图、输入和导航事件
 * 7. 打开 Live Preview DevTools 侧边栏
 */
export class LivePreviewProvider {
  public static inject = [ExtensionContextProvider, LivePreviewService, EmbeddedBrowserService, DevToolsWebviewProvider];

  private panel?: vscode.WebviewPanel;
  private pendingLocalFile: PendingLocalFile | null = null;
  private browserEventsBound = false;
  private pendingInitialUrl = '';
  private pendingInitialDevice = 'device-responsive';

  /**
   * @description 主预览标签页固定标识
   */
  private readonly mainPreviewTabId = 'quickOpsLivePreview:main';

  /**
   * @description 当前所有打开的 Live Preview 编辑器标签页
   */
  private readonly previewTabs = new Map<string, PreviewTabRecord>();

  private readonly webviewWorkflow = new WebviewWorkflow();
  private readonly reactWebviewHtmlWorkflow = new ReactWebviewHtmlWorkflow();

  constructor(
    private readonly extensionContextProvider: ExtensionContextProvider,
    private readonly livePreviewService: LivePreviewService,
    private readonly embeddedBrowserService: EmbeddedBrowserService,
    private readonly devToolsWebviewProvider: DevToolsWebviewProvider,
  ) {}

  public async togglePreviewPanel(): Promise<void> {
    if (this.panel?.visible) {
      this.panel.dispose();
      return;
    }

    await this.openPreviewPanel();
  }

  public async openPreviewPanel(initialUrl = ''): Promise<void> {
    const context = this.extensionContextProvider.getContext();

    this.pendingInitialUrl = String(initialUrl || '').trim() || String(context.workspaceState.get('quickOps.lastPreviewUrl') || '');
    this.pendingInitialDevice = String(context.workspaceState.get('quickOps.lastPreviewDevice') || 'device-responsive');

    this.bindMainBrowserEvents();

    if (this.panel) {
      this.panel.reveal(this.panel.viewColumn || vscode.ViewColumn.Beside);
      await this.syncFavoritesToPanel();
      this.broadcastPreviewTabs();

      if (initialUrl) {
        this.panel.webview.postMessage({
          type: 'init',
          url: initialUrl,
          device: this.pendingInitialDevice,
        });
      }

      return;
    }

    const panel = await this.webviewWorkflow.createWebview<any, WebviewEnhancerOptions>({
      key: 'quickOpsLivePreview',
      viewType: 'quickOpsLivePreview',
      title: '网页预览 (Preview)',
      column: vscode.ViewColumn.Beside,
      extensionUri: context.extensionUri,
      icon: 'resources/icons/livepreview.svg',
      fullscreen: true,
      floating: true,
      options: {
        enableScripts: true,
        retainContextWhenHidden: true,
        enableFindWidget: true,
        localResourceRoots: this.livePreviewService.getLocalResourceRoots(context),
      },
      htmlFactory: async (webview) => {
        return this.reactWebviewHtmlWorkflow.createReactWebviewHtml({
          extensionUri: context.extensionUri,
          webview,
          routeName: '/preview',
        });
      },
      onDidReceiveMessage: async (message) => {
        await this.handleMessage(message);
      },
      onDidDispose: () => {
        if (this.panel === panel) {
          this.panel = undefined;
        }

        this.unregisterPreviewTab(this.mainPreviewTabId, panel);
        this.pendingLocalFile = null;

        /**
         * 不关闭 EmbeddedBrowserService。
         * 再次打开 Live Preview 时恢复上一张截图、URL 和登录态。
         */
      },
    });

    this.panel = panel;

    this.registerPreviewTab({
      id: this.mainPreviewTabId,
      panel,
      browserService: this.embeddedBrowserService,
      title: this.createPreviewTabTitle('', this.pendingInitialUrl),
      url: this.pendingInitialUrl,
      isMain: true,
    });

    panel.onDidChangeViewState((event) => {
      if (event.webviewPanel.visible) {
        void this.syncFavoritesToPanel();
        void this.resumePreviewTab(this.mainPreviewTabId);
      }

      this.broadcastPreviewTabs();
    });
  }

  public async previewLocalFile(uri?: vscode.Uri): Promise<void> {
    const targetUri = uri || vscode.window.activeTextEditor?.document.uri;

    if (!targetUri) {
      vscode.window.showWarningMessage('请先选择或打开一个可预览文件');
      return;
    }

    const fileType = this.livePreviewService.getLocalFileType(targetUri);

    if (!fileType) {
      vscode.window.showWarningMessage('当前文件类型暂不支持预览');
      return;
    }

    await this.openPreviewPanel();

    this.pendingLocalFile = {
      fsPath: targetUri.fsPath,
      fileType,
    };

    this.updateWebviewLocalRoots(targetUri);

    if (fileType === 'html') {
      await this.loadLocalHtmlFile(targetUri.fsPath);
      return;
    }

    await this.loadPendingLocalFile();
  }

  public async syncFavoritesToPanel(): Promise<void> {
    if (!this.panel) return;

    await this.postFavoritesToPanel(this.panel);
  }

  public dispose(): void {
    const panels = Array.from(this.previewTabs.values()).map((item) => item.panel);

    panels.forEach((panel) => {
      panel.dispose();
    });

    this.panel = undefined;
    this.previewTabs.clear();
    this.pendingLocalFile = null;
    this.devToolsWebviewProvider.clear();
    void this.embeddedBrowserService.dispose();
  }

  private async handleMessage(message: any): Promise<void> {
    const context = this.extensionContextProvider.getContext();

    switch (message.type || message.command) {
      case 'ready':
      case 'webviewLoaded':
        await this.handleWebviewReady();
        break;

      case 'saveUrl':
        await context.workspaceState.update('quickOps.lastPreviewUrl', message.url || '');
        this.updatePreviewTab(this.mainPreviewTabId, {
          url: String(message.url || ''),
        });
        break;

      case 'reqPreviewTabs':
        if (this.panel) {
          this.postPreviewTabsToPanel(this.panel, this.mainPreviewTabId);
        }
        break;

      case 'switchPreviewTab':
        await this.switchPreviewTab(String(message.tabId || ''));
        break;

      case 'saveDevice':
        await context.workspaceState.update('quickOps.lastPreviewDevice', message.device || 'device-responsive');
        break;

      case 'reqSyncFavorites':
        await this.syncFavoritesToPanel();
        break;

      case 'resolveFavoriteMeta':
        if (this.panel) {
          await this.postFavoriteMetaResolved(this.panel, message);
        }
        break;

      case 'saveAllFavorites':
        if (Array.isArray(message.folders)) {
          await this.livePreviewService.saveFavoriteFolders(context, message.folders);
        }

        await this.livePreviewService.saveUserFavorites(context, message.favorites || []);
        await this.syncFavoritesToPanel();
        break;

      case 'exportFavorites': {
        const folders = message.folders || (await this.livePreviewService.getFavoriteFolders(context));

        await this.livePreviewService.exportFavoritesToFile(message.favorites || [], folders);
        break;
      }

      case 'importFavorites':
        await this.livePreviewService.importFavoritesFromFile(context);
        await this.syncFavoritesToPanel();
        break;

      case 'toggleFavorite':
        await this.toggleFavorite(message, this.panel);
        break;

      case 'openNewPreviewTab':
        await this.createNewPreviewTab(message.device || '');
        break;

      case 'browserNavigate':
        await this.runMainBrowserAction(() => this.embeddedBrowserService.navigate(message.url || 'about:blank'));
        break;

      case 'browserRefresh':
        await this.runMainBrowserAction(() => this.embeddedBrowserService.reload(message.url || undefined));
        break;

      case 'browserStopLoading':
        await this.runMainBrowserAction(() => this.embeddedBrowserService.stopLoading());
        break;

      case 'browserCopySelection':
        await this.runMainBrowserAction(() => this.embeddedBrowserService.copySelectedText());
        break;

      case 'browserSelectTextRange':
        await this.runMainBrowserAction(() =>
          this.embeddedBrowserService.selectTextRange(Number(message.startX) || 0, Number(message.startY) || 0, Number(message.endX) || 0, Number(message.endY) || 0),
        );
        break;

      case 'browserSearch':
        await this.runMainBrowserAction(async () => {
          const result = await this.embeddedBrowserService.searchInPage(message.keyword || '', message.direction === 'previous' ? 'previous' : 'next');

          this.panel?.webview.postMessage({
            type: 'browserSearchResult',
            ...result,
          });
        });
        break;

      case 'browserBack':
        await this.runMainBrowserAction(() => this.embeddedBrowserService.goBack());
        break;

      case 'browserForward':
        await this.runMainBrowserAction(() => this.embeddedBrowserService.goForward());
        break;

      case 'browserSetViewport':
        await this.runMainBrowserAction(() =>
          this.embeddedBrowserService.setViewport({
            width: message.width,
            height: message.height,
            deviceScaleFactor: message.deviceScaleFactor,
          }),
        );
        break;

      case 'browserInput':
        await this.runMainBrowserAction(() => this.embeddedBrowserService.dispatchInput(message));
        break;

      case 'browserClearCache':
        await this.runMainBrowserAction(() => this.embeddedBrowserService.clearCache());
        break;

      case 'openDevTools':
        await this.runMainBrowserAction(async () => {
          const devToolsUrl = await this.embeddedBrowserService.getDevToolsUrl();

          if (!devToolsUrl) {
            await this.embeddedBrowserService.openDevTools();
            return;
          }

          await this.devToolsWebviewProvider.open(devToolsUrl);
        });
        break;

      case 'browserStop':
        await this.runMainBrowserAction(() => this.embeddedBrowserService.stop());
        break;

      case 'openExternalBrowser':
        if (message.url) {
          await vscode.env.openExternal(this.livePreviewService.parseExternalUri(message.url));
        }
        break;

      case 'loadLocalHtmlFile':
        await this.loadLocalHtmlFile(message.fsPath);
        break;

      case 'setPendingLocalFile':
        this.pendingLocalFile = {
          fsPath: message.fsPath,
          fileType: message.fileType,
        };

        try {
          const fileUri = this.livePreviewService.parseLocalFileUri(message.fsPath);
          this.updateWebviewLocalRoots(fileUri);
        } catch {
          this.updateWebviewLocalRoots();
        }
        break;

      case 'showInfo':
        vscode.window.showInformationMessage(message.message || '');
        break;

      case 'showWarning':
        vscode.window.showWarningMessage(message.message || '');
        break;

      case 'showError':
        vscode.window.showErrorMessage(message.message || '');
        break;

      /**
       * 保留 Nest 版已经提供的 HTTP 代理能力。
       */
      case 'navigateWithProxy': {
        const result = await this.embeddedBrowserService.navigate({
          url: message.url,
          useProxy: Boolean(message.useProxy),
        });

        this.panel?.webview.postMessage({
          type: 'proxyNavigateResult',
          ...result,
        });
        break;
      }

      case 'toggleProxy': {
        const result = await this.embeddedBrowserService.toggleProxy();

        if (result) {
          this.panel?.webview.postMessage({
            type: 'proxyNavigateResult',
            ...result,
          });
        }
        break;
      }

      case 'stopProxy':
        this.embeddedBrowserService.stopProxy();
        this.panel?.webview.postMessage({
          type: 'proxyStopped',
        });
        break;
    }
  }

  private async handleWebviewReady(): Promise<void> {
    const restored = await this.postBrowserSnapshot();

    this.panel?.webview.postMessage({
      type: 'init',
      device: this.pendingInitialDevice,
      url: restored ? '' : this.pendingInitialUrl,
    });

    if (restored) {
      await this.postBrowserSnapshot();
    }

    await this.loadPendingLocalFile();
    await this.syncFavoritesToPanel();

    if (this.panel) {
      this.postPreviewTabsToPanel(this.panel, this.mainPreviewTabId);
    }
  }

  private async toggleFavorite(message: any, panel?: vscode.WebviewPanel): Promise<void> {
    const context = this.extensionContextProvider.getContext();
    const result = await this.livePreviewService.toggleFavorite(context, {
      url: message.url,
      title: message.title || message.url,
      logo: typeof message.logo === 'string' ? message.logo : '',
      description: typeof message.description === 'string' ? message.description : '',
      folderId: typeof message.folderId === 'string' ? message.folderId : undefined,
      timestamp: Date.now(),
      isDefault: false,
      source: 'user',
    });

    if (result.message) {
      vscode.window.showInformationMessage(result.message);
    }

    panel?.webview.postMessage({
      type: 'syncFavorites',
      favorites: result.favorites,
      folders: result.folders,
    });
  }

  private async postFavoriteMetaResolved(panel: vscode.WebviewPanel, message: any): Promise<void> {
    try {
      const meta = await this.livePreviewService.resolveFavoriteMeta(message.url || '');

      panel.webview.postMessage({
        type: 'favoriteMetaResolved',
        requestId: message.requestId,
        ok: true,
        ...meta,
      });
    } catch (error) {
      panel.webview.postMessage({
        type: 'favoriteMetaResolved',
        requestId: message.requestId,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async postFavoritesToPanel(panel: vscode.WebviewPanel): Promise<void> {
    const context = this.extensionContextProvider.getContext();
    const favorites = await this.livePreviewService.getMergedFavorites(context);
    const folders = await this.livePreviewService.getFavoriteFolders(context);

    panel.webview.postMessage({
      type: 'syncFavorites',
      favorites,
      folders,
    });
  }

  private bindMainBrowserEvents(): void {
    if (this.browserEventsBound) return;

    this.browserEventsBound = true;
    this.bindBrowserEvents(this.embeddedBrowserService, () => this.panel, this.mainPreviewTabId);
  }

  private bindBrowserEvents(browserService: EmbeddedBrowserService, getPanel: () => vscode.WebviewPanel | undefined, tabId: string): void {
    browserService.on('frame', (frame) => {
      getPanel()?.webview.postMessage({
        type: 'browserFrame',
        ...frame,
      });
    });

    browserService.on('pageLoaded', (payload) => {
      const panel = getPanel();

      this.updatePreviewTab(tabId, {
        title: String(payload?.title || ''),
        url: String(payload?.url || ''),
      });

      this.updatePreviewPanelIcon(panel, payload?.faviconUrl);

      panel?.webview.postMessage({
        type: 'browserPageLoaded',
        ...payload,
      });
    });

    browserService.on('urlChanged', (payload) => {
      this.updatePreviewTab(tabId, {
        url: String(payload?.url || ''),
      });

      getPanel()?.webview.postMessage({
        type: 'browserUrlChanged',
        ...payload,
      });
    });

    browserService.on('titleChanged', (payload) => {
      this.updatePreviewTab(tabId, {
        title: String(payload?.title || ''),
      });

      getPanel()?.webview.postMessage({
        type: 'browserTitleChanged',
        ...payload,
      });
    });

    browserService.on('pageError', (payload) => {
      getPanel()?.webview.postMessage({
        type: 'browserPageError',
        ...payload,
      });
    });
  }

  private async postBrowserSnapshot(): Promise<boolean> {
    if (!this.panel) return false;

    return this.postBrowserSnapshotToPanel(this.panel, this.embeddedBrowserService, this.mainPreviewTabId);
  }

  private async postBrowserSnapshotToPanel(panel: vscode.WebviewPanel, browserService: EmbeddedBrowserService, tabId: string): Promise<boolean> {
    const snapshot = await browserService.getSnapshot();

    if (!snapshot.hasPage && !snapshot.frame) return false;

    if (snapshot.frame) {
      panel.webview.postMessage({
        type: 'browserFrame',
        ...snapshot.frame,
      });
    }

    if (snapshot.url) {
      this.updatePreviewTab(tabId, {
        title: snapshot.title || snapshot.url,
        url: snapshot.url,
      });
      this.updatePreviewPanelIcon(panel, snapshot.faviconUrl);

      panel.webview.postMessage({
        type: 'browserUrlChanged',
        url: snapshot.url,
      });

      panel.webview.postMessage({
        type: 'browserPageLoaded',
        url: snapshot.url,
        title: snapshot.title || snapshot.url,
        faviconUrl: snapshot.faviconUrl,
      });
    }

    return true;
  }

  private async runMainBrowserAction(action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (error) {
      this.panel?.webview.postMessage({
        type: 'browserPageError',
        url: this.pendingInitialUrl,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async createNewPreviewTab(initialDevice = ''): Promise<void> {
    const context = this.extensionContextProvider.getContext();
    const browserService = this.embeddedBrowserService.createDetached('BrowserUserData-Detached');
    const tabId = `quickOpsLivePreview:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const initialUrl = '';

    let panel: vscode.WebviewPanel | undefined;

    panel = await this.webviewWorkflow.createWebview<any, WebviewEnhancerOptions>({
      key: tabId,
      viewType: 'quickOpsLivePreview',
      title: '网页预览 (Preview)',
      column: this.panel?.viewColumn || vscode.ViewColumn.Active,
      extensionUri: context.extensionUri,
      icon: 'resources/icons/livepreview.svg',
      fullscreen: true,
      floating: true,
      revealIfExists: false,
      options: {
        enableScripts: true,
        retainContextWhenHidden: true,
        enableFindWidget: true,
        localResourceRoots: this.livePreviewService.getLocalResourceRoots(context),
      },
      htmlFactory: async (webview) => {
        return this.reactWebviewHtmlWorkflow.createReactWebviewHtml({
          extensionUri: context.extensionUri,
          webview,
          routeName: '/preview',
        });
      },
      onDidReceiveMessage: async (message) => {
        if (!panel) return;

        await this.handleDetachedMessage(tabId, panel, browserService, message, initialUrl, initialDevice);
      },
      onDidDispose: () => {
        this.unregisterPreviewTab(tabId, panel);
        void browserService.dispose();
      },
    });

    this.registerPreviewTab({
      id: tabId,
      panel,
      browserService,
      title: this.createPreviewTabTitle('', initialUrl),
      url: initialUrl,
      isMain: false,
    });

    panel.onDidChangeViewState((event) => {
      if (event.webviewPanel.visible) {
        void this.resumePreviewTab(tabId);
      }

      this.broadcastPreviewTabs();
    });

    this.bindBrowserEvents(browserService, () => panel, tabId);
  }

  private async handleDetachedMessage(
    tabId: string,
    panel: vscode.WebviewPanel,
    browserService: EmbeddedBrowserService,
    message: any,
    initialUrl: string,
    initialDevice: string,
  ): Promise<void> {
    const context = this.extensionContextProvider.getContext();

    const run = async (action: () => Promise<void>) => {
      try {
        await action();
      } catch (error) {
        panel.webview.postMessage({
          type: 'browserPageError',
          url: initialUrl,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    };

    switch (message.type || message.command) {
      case 'ready': {
        const restored = await this.postBrowserSnapshotToPanel(panel, browserService, tabId);

        panel.webview.postMessage({
          type: 'init',
          url: restored ? '' : initialUrl,
          device: initialDevice || String(context.workspaceState.get('quickOps.lastPreviewDevice') || 'device-responsive'),
        });
        await this.postFavoritesToPanel(panel);
        this.postPreviewTabsToPanel(panel, tabId);
        break;
      }

      case 'saveUrl':
        await context.workspaceState.update('quickOps.lastPreviewUrl', message.url || '');
        this.updatePreviewTab(tabId, {
          url: String(message.url || ''),
        });
        break;

      case 'reqPreviewTabs':
        this.postPreviewTabsToPanel(panel, tabId);
        break;

      case 'switchPreviewTab':
        await this.switchPreviewTab(String(message.tabId || ''));
        break;

      case 'saveDevice':
        await context.workspaceState.update('quickOps.lastPreviewDevice', message.device || 'device-responsive');
        break;

      case 'reqSyncFavorites':
        await this.postFavoritesToPanel(panel);
        break;

      case 'resolveFavoriteMeta':
        await this.postFavoriteMetaResolved(panel, message);
        break;

      case 'saveAllFavorites':
        if (Array.isArray(message.folders)) {
          await this.livePreviewService.saveFavoriteFolders(context, message.folders);
        }
        await this.livePreviewService.saveUserFavorites(context, message.favorites || []);
        await this.postFavoritesToPanel(panel);
        break;

      case 'exportFavorites':
        await this.livePreviewService.exportFavoritesToFile(message.favorites || [], message.folders || (await this.livePreviewService.getFavoriteFolders(context)));
        break;

      case 'importFavorites':
        await this.livePreviewService.importFavoritesFromFile(context);
        await this.postFavoritesToPanel(panel);
        break;

      case 'toggleFavorite':
        await this.toggleFavorite(message, panel);
        break;

      case 'openNewPreviewTab':
        await this.createNewPreviewTab(message.device || '');
        break;

      case 'browserNavigate':
        await run(() => browserService.navigate(message.url || 'about:blank'));
        break;

      case 'browserRefresh':
        await run(() => browserService.reload(message.url || undefined));
        break;

      case 'browserStopLoading':
        await run(() => browserService.stopLoading());
        break;

      case 'browserCopySelection':
        await run(() => browserService.copySelectedText());
        break;

      case 'browserSelectTextRange':
        await run(() => browserService.selectTextRange(Number(message.startX) || 0, Number(message.startY) || 0, Number(message.endX) || 0, Number(message.endY) || 0));
        break;

      case 'browserSearch':
        await run(async () => {
          const result = await browserService.searchInPage(message.keyword || '', message.direction === 'previous' ? 'previous' : 'next');
          panel.webview.postMessage({
            type: 'browserSearchResult',
            ...result,
          });
        });
        break;

      case 'browserBack':
        await run(() => browserService.goBack());
        break;

      case 'browserForward':
        await run(() => browserService.goForward());
        break;

      case 'browserSetViewport':
        await run(() =>
          browserService.setViewport({
            width: message.width,
            height: message.height,
            deviceScaleFactor: message.deviceScaleFactor,
          }),
        );
        break;

      case 'browserInput':
        await run(() => browserService.dispatchInput(message));
        break;

      case 'browserClearCache':
        await run(() => browserService.clearCache());
        break;

      case 'openDevTools':
        await run(async () => {
          const devToolsUrl = await browserService.getDevToolsUrl();

          if (!devToolsUrl) {
            await browserService.openDevTools();
            return;
          }

          await this.devToolsWebviewProvider.open(devToolsUrl);
        });
        break;

      case 'browserStop':
        await run(() => browserService.stop());
        break;

      case 'openExternalBrowser':
        if (message.url) {
          await vscode.env.openExternal(this.livePreviewService.parseExternalUri(message.url));
        }
        break;

      case 'showInfo':
        vscode.window.showInformationMessage(message.message || '');
        break;

      case 'showWarning':
        vscode.window.showWarningMessage(message.message || '');
        break;

      case 'showError':
        vscode.window.showErrorMessage(message.message || '');
        break;
    }
  }
  /**
   * @description 注册一个 Live Preview 编辑器标签页
   */
  private registerPreviewTab(record: PreviewTabRecord): void {
    this.previewTabs.set(record.id, record);
    this.broadcastPreviewTabs();
  }

  /**
   * @description 删除已经关闭的标签页
   */
  private unregisterPreviewTab(tabId: string, panel?: vscode.WebviewPanel): void {
    const record = this.previewTabs.get(tabId);

    if (!record) return;
    if (panel && record.panel !== panel) return;

    this.previewTabs.delete(tabId);
    this.broadcastPreviewTabs();
  }

  /**
   * @description 更新标签页标题或 URL
   */
  private updatePreviewTab(
    tabId: string,
    patch: {
      title?: string;
      url?: string;
    },
  ): void {
    const record = this.previewTabs.get(tabId);

    if (!record) return;

    const nextUrl = typeof patch.url === 'string' ? patch.url : record.url;
    const nextTitle = typeof patch.title === 'string' && patch.title.trim() ? patch.title.trim() : record.title;

    record.url = nextUrl;
    record.title = this.createPreviewTabTitle(nextTitle, nextUrl);
    record.panel.title = this.createPreviewPanelTitle(record.title);

    this.broadcastPreviewTabs();
  }

  /**
   * @description 使用网页声明的 favicon 更新 VS Code 编辑器标签图标
   */
  private updatePreviewPanelIcon(panel: vscode.WebviewPanel | undefined, rawFaviconUrl: unknown): void {
    if (!panel) return;

    const faviconUrl = typeof rawFaviconUrl === 'string' ? rawFaviconUrl.trim() : '';

    if (!faviconUrl) return;

    try {
      const iconUri = vscode.Uri.parse(faviconUrl);

      if (!['http', 'https', 'file'].includes(iconUri.scheme.toLowerCase())) {
        return;
      }

      panel.iconPath = iconUri;
    } catch (error) {
      console.warn('[LivePreviewProvider] update preview favicon failed:', error);
    }
  }

  /**
   * @description 生成标签页列表里展示的标题
   */
  private createPreviewTabTitle(title: string, url: string): string {
    const cleanTitle = String(title || '')
      .replace(/\s+/g, ' ')
      .trim();

    if (cleanTitle && cleanTitle !== 'about:blank' && cleanTitle !== '网页预览 (Preview)') {
      return cleanTitle;
    }

    const cleanUrl = String(url || '').trim();

    if (!cleanUrl || cleanUrl === 'about:blank') {
      return '新建预览';
    }

    try {
      const parsed = new URL(cleanUrl);

      return parsed.hostname || parsed.pathname || cleanUrl;
    } catch {
      const normalized = cleanUrl.replace(/\\/g, '/');
      const parts = normalized.split('/').filter(Boolean);

      return parts[parts.length - 1] || cleanUrl;
    }
  }

  /**
   * @description 缩短 VS Code 面板标题，避免网页长标题占满编辑器工具栏
   */
  private createPreviewPanelTitle(title: string): string {
    const maxDisplayWidth = 40;
    const chars = Array.from(String(title || '').trim());
    const getCharDisplayWidth = (char: string): number => (/^[\u0000-\u00ff]$/.test(char) ? 1 : 2);
    const totalDisplayWidth = chars.reduce((width, char) => width + getCharDisplayWidth(char), 0);

    if (totalDisplayWidth <= maxDisplayWidth) {
      return chars.join('');
    }

    const maxContentWidth = maxDisplayWidth - 1;
    let currentDisplayWidth = 0;
    const visibleChars: string[] = [];

    for (const char of chars) {
      const charDisplayWidth = getCharDisplayWidth(char);

      if (currentDisplayWidth + charDisplayWidth > maxContentWidth) {
        break;
      }

      visibleChars.push(char);
      currentDisplayWidth += charDisplayWidth;
    }

    const nextChar = chars[visibleChars.length];

    if (/[a-z\d]/i.test(visibleChars[visibleChars.length - 1] || '') && /[a-z\d]/i.test(nextChar || '')) {
      let wordStartIndex = visibleChars.length;

      while (wordStartIndex > 0 && /[a-z\d]/i.test(visibleChars[wordStartIndex - 1])) {
        wordStartIndex -= 1;
      }

      if (wordStartIndex > 0) {
        visibleChars.splice(wordStartIndex);
      }
    }

    return `${visibleChars.join('').trimEnd()}…`;
  }

  /**
   * @description 将标签页列表发送给指定 Webview
   */
  private postPreviewTabsToPanel(panel: vscode.WebviewPanel, currentTabId: string): void {
    const records = Array.from(this.previewTabs.values());
    const hasActivePanel = records.some((item) => item.panel.active);

    const tabs: PreviewTabInfo[] = records.map((item) => ({
      id: item.id,
      title: item.title,
      url: item.url,
      active: hasActivePanel ? item.panel.active : item.id === currentTabId,
    }));

    void panel.webview.postMessage({
      type: 'previewTabsChanged',
      tabs,
      count: tabs.length,
      currentTabId,
      activeTabId: tabs.find((item) => item.active)?.id || currentTabId,
    });
  }

  /**
   * @description 向所有已打开的 Live Preview 标签同步列表
   */
  private broadcastPreviewTabs(): void {
    this.previewTabs.forEach((record) => {
      this.postPreviewTabsToPanel(record.panel, record.id);
    });
  }

  /**
   * @description 激活指定的 VS Code Live Preview 标签页
   */
  private async switchPreviewTab(tabId: string): Promise<void> {
    const record = this.previewTabs.get(tabId);

    if (!record) return;

    record.panel.reveal(record.panel.viewColumn || vscode.ViewColumn.Active, false);

    await this.resumePreviewTab(tabId);
    this.broadcastPreviewTabs();
  }

  /**
   * @description 切回 Live Preview 标签页时恢复截图流并同步当前快照。
   */
  private async resumePreviewTab(tabId: string): Promise<void> {
    const record = this.previewTabs.get(tabId);

    if (!record) return;

    try {
      await record.browserService.resumeScreencast();
      await this.postBrowserSnapshotToPanel(record.panel, record.browserService, tabId);
    } catch (error) {
      record.panel.webview.postMessage({
        type: 'browserPageError',
        url: record.url,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async loadPendingLocalFile(): Promise<void> {
    if (!this.panel || !this.pendingLocalFile) return;

    const { fsPath, fileType } = this.pendingLocalFile;

    try {
      const fileUri = this.livePreviewService.parseLocalFileUri(fsPath);
      const contentBytes = await vscode.workspace.fs.readFile(fileUri);

      this.updateWebviewLocalRoots(fileUri);

      if (fileType === 'md') {
        const content = Buffer.from(contentBytes).toString('utf8');

        const fileName = path.basename(fileUri.fsPath || fsPath);

        this.panel.webview.postMessage({
          type: 'initMarkdownData',
          content,
          fsPath,
          fileName,
        });

        /**
         * 兼容 master Webview 使用的 Vditor 初始化消息。
         */
        this.panel.webview.postMessage({
          type: 'initVditorData',
          content,
          mode: 'read',
          fsPath,
          fileName,
        });

        return;
      }

      if (fileType === 'pdf') {
        const contentBase64 = Buffer.from(contentBytes).toString('base64');

        this.panel.webview.postMessage({
          type: 'initPdfData',
          contentBase64,
          fileName: path.basename(fileUri.fsPath || fsPath),
          initialScale: 0.8,
        });

        return;
      }

      if (fileType === 'excel') {
        const contentBase64 = Buffer.from(contentBytes).toString('base64');

        this.panel.webview.postMessage({
          type: 'initExcelData',
          fsPath,
          fileName: path.basename(fileUri.fsPath || fsPath),
          contentBase64,
        });

        return;
      }

      if (fileType === 'html') {
        await this.loadLocalHtmlFile(fsPath);
      }
    } catch {
      vscode.window.showErrorMessage(`文件读取失败: ${fsPath}`);

      this.panel.webview.postMessage({
        type: 'initLocalFileError',
        fsPath,
        message: `文件读取失败: ${fsPath}`,
      });
    }
  }

  /**
   * @description 加载本地 HTML 文件
   *
   * 会将 HTML 内的 src / href / poster 等本地资源地址转换成 Webview 可访问地址。
   *
   * @param fsPath HTML 文件路径
   */
  private async loadLocalHtmlFile(fsPath: string): Promise<void> {
    if (!this.panel) return;

    try {
      const fileUri = this.livePreviewService.parseLocalFileUri(fsPath);

      this.updateWebviewLocalRoots(fileUri);

      const contentBytes = await vscode.workspace.fs.readFile(fileUri);
      const content = Buffer.from(contentBytes).toString('utf8');

      const rewrittenHtml = await this.rewriteLocalHtmlAssets(content, fileUri, this.panel.webview);

      this.panel.webview.postMessage({
        type: 'initHtmlData',
        fsPath,
        fileName: path.basename(fileUri.fsPath || fsPath),
        content: rewrittenHtml,
      });
    } catch {
      vscode.window.showErrorMessage(`HTML 文件读取失败: ${fsPath}`);

      this.panel.webview.postMessage({
        type: 'initLocalFileError',
        fsPath,
        message: `HTML 文件读取失败: ${fsPath}`,
      });
    }
  }

  /**
   * @description 更新当前 Webview 可访问的本地资源根路径
   *
   * @param fileUri 当前要预览的本地文件 Uri
   */
  private updateWebviewLocalRoots(fileUri?: vscode.Uri): void {
    if (!this.panel) return;

    const context = this.extensionContextProvider.getContext();

    this.panel.webview.options = {
      ...this.panel.webview.options,
      localResourceRoots: this.livePreviewService.getLocalResourceRoots(context, fileUri),
    };
  }

  /**
   * @description 判断 URL 是否不需要重写
   *
   * @param rawUrl 原始 URL
   */
  private isSkipRewriteUrl(rawUrl: string): boolean {
    const url = rawUrl.trim();

    if (!url) return true;

    return url.startsWith('#') || url.startsWith('//') || /^(https?:|data:|blob:|mailto:|tel:|javascript:|vscode-webview-resource:|vscode-resource:|vscode-webview:)/i.test(url);
  }

  /**
   * @description 拆分 URL 的路径和 query/hash 后缀
   *
   * @param rawUrl 原始 URL
   */
  private splitUrlSuffix(rawUrl: string): {
    pathname: string;
    suffix: string;
  } {
    const match = rawUrl.match(/^([^?#]*)([?#].*)?$/);

    return {
      pathname: match?.[1] || rawUrl,
      suffix: match?.[2] || '',
    };
  }

  /**
   * @description 判断 Uri 是否存在
   *
   * @param uri 待检查 Uri
   */
  private async uriExists(uri: vscode.Uri): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(uri);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * @description 解析 HTML 资源地址对应的本地 Uri
   *
   * @param rawUrl 原始资源地址
   * @param htmlFileUri 当前 HTML 文件 Uri
   */
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

  /**
   * @description 转义 HTML 属性值
   *
   * @param value 属性值
   */
  private escapeHtmlAttribute(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /**
   * @description 将普通本地资源地址转换为 Webview 可访问地址
   *
   * @param rawUrl 原始资源地址
   * @param htmlFileUri 当前 HTML 文件 Uri
   * @param webview 目标 Webview
   */
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

  /**
   * @description 重写指定标签上的 href / src / poster 属性
   *
   * @param tag HTML 标签字符串
   * @param htmlFileUri 当前 HTML 文件 Uri
   * @param webview 目标 Webview
   */
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

  /**
   * @description 重写 HTML 中的本地资源引用
   *
   * 处理范围：
   * - link[href]
   * - script[src]
   * - img[src]
   * - source[src]
   * - video[src/poster]
   * - audio[src]
   * - iframe[src]
   *
   * @param html 原始 HTML
   * @param htmlFileUri 当前 HTML 文件 Uri
   * @param webview 目标 Webview
   */
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
}
