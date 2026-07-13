import * as vscode from 'vscode';
import * as path from 'path';

import WebviewWorkflow from '@/workflow/webview';
import ReactWebviewHtmlWorkflow from '@/workflow/react-webview-html';
import { ExtensionContextProvider } from '@common/providers/extension-context.provider';
import { LivePreviewService } from '@modules/live-preview/live-preview.service';
import { EmbeddedBrowserService } from '@modules/live-preview/services/embedded-browser.service';
import type { PendingLocalFile } from '@modules/live-preview/live-preview.type';
import type { WebviewEnhancerOptions } from '@plugins/webview-enhancer/type';

/**
 * @description Live Preview Webview Provider
 *
 * 负责：
 * 1. 打开 / 关闭网页预览 Webview
 * 2. 通过 WebviewWorkflow 统一创建 WebviewPanel
 * 3. 同步收藏数据到 Webview
 * 4. 处理 Webview 发回来的消息
 * 5. 支持本地 markdown / pdf / excel / html 文件预览
 */
export class LivePreviewProvider {
  public static inject = [ExtensionContextProvider, LivePreviewService, EmbeddedBrowserService];

  /**
   * @description 主预览面板
   */
  private panel?: vscode.WebviewPanel;

  /**
   * @description 待加载的本地文件
   *
   * Webview 未 ready 前，先缓存本地文件信息。
   * Webview ready 后再真正读取并发送文件内容。
   */
  private pendingLocalFile: PendingLocalFile | null = null;

  /**
   * @description Webview 工作流
   *
   * 统一负责：
   * - 创建 WebviewPanel
   * - 复用相同 key 的 Webview
   * - 派发 webview:created / webview:disposed 等事件
   * - 配合 WebviewAppearancePlugin 处理 icon / fullscreen
   */
  private readonly webviewWorkflow = new WebviewWorkflow();
  private readonly reactWebviewHtmlWorkflow = new ReactWebviewHtmlWorkflow();

  /**
   * @description 创建 LivePreviewProvider
   *
   * @param extensionContextProvider VSCode ExtensionContext 提供器
   * @param livePreviewService Live Preview 业务服务
   * @param embeddedBrowserService 内嵌浏览器代理服务
   */
  constructor(
    private readonly extensionContextProvider: ExtensionContextProvider,
    private readonly livePreviewService: LivePreviewService,
    private readonly embeddedBrowserService: EmbeddedBrowserService,
  ) {}

  /**
   * @description 切换预览面板
   *
   * 如果当前面板可见，则关闭；
   * 否则打开或激活预览面板。
   */
  public async togglePreviewPanel(): Promise<void> {
    if (this.panel?.visible) {
      this.panel.dispose();
      return;
    }

    await this.openPreviewPanel();
  }

  /**
   * @description 打开主预览面板
   *
   * - 如果面板已存在，则 reveal 并同步收藏
   * - 如果传入 initialUrl，则通知 Webview 跳转
   * - 如果面板不存在，则通过 WebviewWorkflow 创建
   *
   * @param initialUrl 初始预览地址
   */
  public async openPreviewPanel(initialUrl = ''): Promise<void> {
    const context = this.extensionContextProvider.getContext();

    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);

      await this.syncFavoritesToPanel();

      if (initialUrl) {
        this.panel.webview.postMessage({
          type: 'navigate',
          url: initialUrl,
        });
      }

      return;
    }

    this.panel = await this.webviewWorkflow.createWebview<any, WebviewEnhancerOptions>({
      key: 'quickOpsLivePreview',
      viewType: 'quickOpsLivePreview',
      title: '网页预览 (Preview)',
      column: vscode.ViewColumn.Beside,

      /**
       * @description 给 WebviewAppearancePlugin 使用
       */
      extensionUri: context.extensionUri,
      icon: 'resources/icons/livepreview.svg',
      fullscreen: true,

      options: {
        enableScripts: true,
        retainContextWhenHidden: true,
        enableFindWidget: true,
        localResourceRoots: this.livePreviewService.getLocalResourceRoots(context),
      },

      htmlFactory: async (webview) => {
        return this.reactWebviewHtmlWorkflow.createReactWebviewHtml({
          extensionUri: context!.extensionUri,
          webview,
          routeName: '/preview',
        });
      },

      onDidReceiveMessage: async (message) => {
        await this.handleMessage(message);
      },

      onDidDispose: () => {
        this.panel = undefined;
        this.pendingLocalFile = null;
      },
    });

    this.panel.onDidChangeViewState((event) => {
      if (event.webviewPanel.visible) {
        void this.syncFavoritesToPanel();
      }
    });

    const lastUrl = initialUrl || String(context.workspaceState.get('quickOps.lastPreviewUrl') || '');
    const lastDevice = String(context.workspaceState.get('quickOps.lastPreviewDevice') || 'device-responsive');

    setTimeout(() => {
      this.panel?.webview.postMessage({
        type: 'init',
        url: lastUrl,
        device: lastDevice,
      });

      void this.syncFavoritesToPanel();
    }, 100);
  }

  /**
   * @description 预览本地文件
   *
   * 支持类型由 LivePreviewService.getLocalFileType 控制。
   *
   * @param uri 待预览的文件 Uri，不传时使用当前激活编辑器文档
   */
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

  /**
   * @description 同步收藏列表到主预览面板
   */
  public async syncFavoritesToPanel(): Promise<void> {
    if (!this.panel) return;

    const context = this.extensionContextProvider.getContext();
    const favorites = await this.livePreviewService.getMergedFavorites(context);

    this.panel.webview.postMessage({
      type: 'syncFavorites',
      favorites,
    });
  }

  /**
   * @description 释放资源
   */
  public dispose(): void {
    this.panel?.dispose();
    this.panel = undefined;
    this.pendingLocalFile = null;
  }

  /**
   * @description 处理 Webview 发来的消息
   *
   * @param message Webview 消息体
   */
  private async handleMessage(message: any): Promise<void> {
    const context = this.extensionContextProvider.getContext();

    switch (message.type || message.command) {
      case 'ready':
      case 'webviewLoaded':
        await this.handleWebviewReady();
        break;

      case 'saveUrl':
        await context.workspaceState.update('quickOps.lastPreviewUrl', message.url || '');
        break;

      case 'saveDevice':
        await context.workspaceState.update('quickOps.lastPreviewDevice', message.device || 'device-responsive');
        break;

      case 'reqSyncFavorites':
        await this.syncFavoritesToPanel();
        break;

      case 'saveAllFavorites':
        await this.livePreviewService.saveUserFavorites(context, message.favorites || []);
        await this.syncFavoritesToPanel();
        break;

      case 'toggleFavorite':
        await this.toggleFavorite(message);
        break;

      case 'openExternalBrowser':
        if (message.url) {
          await vscode.env.openExternal(this.livePreviewService.parseExternalUri(message.url));
        }
        break;

      case 'openNewPreviewTab':
        await this.createNewPreviewTab(message.url || '', message.device || '');
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

  /**
   * @description Webview ready 后的初始化处理
   */
  private async handleWebviewReady(): Promise<void> {
    await this.loadPendingLocalFile();
    await this.syncFavoritesToPanel();
  }

  /**
   * @description 收藏 / 取消收藏当前地址
   *
   * @param message Webview 消息体
   */
  private async toggleFavorite(message: any): Promise<void> {
    const context = this.extensionContextProvider.getContext();

    const result = await this.livePreviewService.toggleFavorite(context, {
      url: message.url,
      title: message.title || message.url,
      logo: typeof message.logo === 'string' ? message.logo : '',
      description: typeof message.description === 'string' ? message.description : '',
      timestamp: Date.now(),
      isDefault: false,
      source: 'user',
    });

    if (result.message) {
      vscode.window.showInformationMessage(result.message);
    }

    this.panel?.webview.postMessage({
      type: 'syncFavorites',
      favorites: result.favorites,
    });
  }

  /**
   * @description 创建新的预览标签页
   *
   * 新标签页不复用主预览面板，因此使用唯一 key 并设置 revealIfExists: false。
   *
   * @param initialUrl 初始地址
   * @param initialDevice 初始设备类型
   */
  private async createNewPreviewTab(initialUrl = '', initialDevice = ''): Promise<void> {
    const context = this.extensionContextProvider.getContext();

    let panel: vscode.WebviewPanel | undefined;

    panel = await this.webviewWorkflow.createWebview<any, WebviewEnhancerOptions>({
      key: `quickOpsLivePreview:${Date.now()}:${Math.random().toString(36).slice(2)}`,
      viewType: 'quickOpsLivePreview',
      title: '网页预览 (Preview)',
      column: this.panel?.viewColumn || vscode.ViewColumn.Active,

      /**
       * @description 给 WebviewAppearancePlugin 使用
       */
      extensionUri: context.extensionUri,
      icon: 'resources/icons/livepreview.svg',
      fullscreen: true,

      /**
       * @description 新预览页不复用已有 Webview
       */
      revealIfExists: false,

      options: {
        enableScripts: true,
        retainContextWhenHidden: true,
        enableFindWidget: true,
        localResourceRoots: this.livePreviewService.getLocalResourceRoots(context),
      },

      htmlFactory: async (webview) => {
        return this.reactWebviewHtmlWorkflow.createReactWebviewHtml({
          extensionUri: context!.extensionUri,
          webview,
          routeName: '/preview',
        });
      },

      onDidReceiveMessage: async (message) => {
        if (!panel) return;

        if (message.type === 'ready') {
          panel.webview.postMessage({
            type: 'init',
            url: initialUrl,
            device: initialDevice || 'device-responsive',
          });

          const favorites = await this.livePreviewService.getMergedFavorites(context);

          panel.webview.postMessage({
            type: 'syncFavorites',
            favorites,
          });
        }

        if (message.type === 'saveUrl') {
          await context.workspaceState.update('quickOps.lastPreviewUrl', message.url || '');
        }

        if (message.type === 'saveDevice') {
          await context.workspaceState.update('quickOps.lastPreviewDevice', message.device || 'device-responsive');
        }

        if (message.type === 'openExternalBrowser' && message.url) {
          await vscode.env.openExternal(this.livePreviewService.parseExternalUri(message.url));
        }
      },
    });
  }

  /**
   * @description 加载等待中的本地文件
   */
  private async loadPendingLocalFile(): Promise<void> {
    if (!this.panel || !this.pendingLocalFile) return;

    const { fsPath, fileType } = this.pendingLocalFile;

    try {
      const fileUri = this.livePreviewService.parseLocalFileUri(fsPath);
      const contentBytes = await vscode.workspace.fs.readFile(fileUri);

      this.updateWebviewLocalRoots(fileUri);

      if (fileType === 'md') {
        const content = Buffer.from(contentBytes).toString('utf8');

        this.panel.webview.postMessage({
          type: 'initMarkdownData',
          content,
          fsPath,
          fileName: path.basename(fileUri.fsPath || fsPath),
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
