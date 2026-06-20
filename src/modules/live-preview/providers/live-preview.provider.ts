import * as vscode from 'vscode';
import * as path from 'path';

import { getReactWebviewHtml } from '../../../utils/WebviewHelper';
import { ExtensionContextProvider } from '../../../common/providers/extension-context.provider';
import { LivePreviewService, PendingLocalFile } from '../live-preview.service';
import { EmbeddedBrowserService } from '../services/embedded-browser.service';

export class LivePreviewProvider {
  public static inject = [ExtensionContextProvider, LivePreviewService, EmbeddedBrowserService];

  private panel?: vscode.WebviewPanel;
  private pendingLocalFile: PendingLocalFile | null = null;

  constructor(
    private readonly extensionContextProvider: ExtensionContextProvider,
    private readonly livePreviewService: LivePreviewService,
    private readonly embeddedBrowserService: EmbeddedBrowserService,
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

    this.panel = vscode.window.createWebviewPanel('quickOpsLivePreview', '网页预览 (Preview)', vscode.ViewColumn.Beside, {
      enableScripts: true,
      retainContextWhenHidden: true,
      enableFindWidget: true,
      localResourceRoots: this.livePreviewService.getLocalResourceRoots(context),
    });

    this.panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'resources', 'icons', 'livepreview.svg');

    this.panel.webview.html = getReactWebviewHtml(context.extensionUri, this.panel.webview, '/live-preview');

    this.panel.onDidDispose(() => {
      this.panel = undefined;
      this.pendingLocalFile = null;
    });

    this.panel.onDidChangeViewState((event) => {
      if (event.webviewPanel.visible) {
        void this.syncFavoritesToPanel();
      }
    });

    this.panel.webview.onDidReceiveMessage(async (message) => {
      await this.handleMessage(message);
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

    const context = this.extensionContextProvider.getContext();
    const favorites = await this.livePreviewService.getMergedFavorites(context);

    this.panel.webview.postMessage({
      type: 'syncFavorites',
      favorites,
    });
  }

  public dispose(): void {
    this.panel?.dispose();
    this.panel = undefined;
    this.pendingLocalFile = null;
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

  private async handleWebviewReady(): Promise<void> {
    await this.loadPendingLocalFile();
    await this.syncFavoritesToPanel();
  }

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

  private async createNewPreviewTab(initialUrl = '', initialDevice = ''): Promise<void> {
    const context = this.extensionContextProvider.getContext();

    const panel = vscode.window.createWebviewPanel('quickOpsLivePreview', '网页预览 (Preview)', this.panel?.viewColumn || vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      enableFindWidget: true,
      localResourceRoots: this.livePreviewService.getLocalResourceRoots(context),
    });

    panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'resources', 'icons', 'livepreview.svg');

    panel.webview.html = getReactWebviewHtml(context.extensionUri, panel.webview, '/live-preview');

    panel.webview.onDidReceiveMessage(async (message) => {
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
    });
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

  private updateWebviewLocalRoots(fileUri?: vscode.Uri): void {
    if (!this.panel) return;

    const context = this.extensionContextProvider.getContext();

    this.panel.webview.options = {
      ...this.panel.webview.options,
      localResourceRoots: this.livePreviewService.getLocalResourceRoots(context, fileUri),
    };
  }

  private isSkipRewriteUrl(rawUrl: string): boolean {
    const url = rawUrl.trim();

    if (!url) return true;

    return url.startsWith('#') || url.startsWith('//') || /^(https?:|data:|blob:|mailto:|tel:|javascript:|vscode-webview-resource:|vscode-resource:|vscode-webview:)/i.test(url);
  }

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
}
