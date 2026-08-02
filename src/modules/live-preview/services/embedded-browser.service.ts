import { EventEmitter } from 'events';
import { homedir, platform } from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { ExtensionContextProvider } from '@common/providers/extension-context.provider';
import { LocalProxyServerService } from '@modules/live-preview/services/local-proxy-server.service';
import type { Browser, CDPSession, Page } from 'puppeteer-core';
import puppeteer from 'puppeteer-core';

interface BrowserFramePayload {
  data: string;
  width: number;
  height: number;
  format?: 'jpeg' | 'png';
}

interface BrowserSnapshot {
  url: string;
  title: string;
  faviconUrl: string;
  frame: BrowserFramePayload | null;
  hasPage: boolean;
}

interface BrowserPageMetadata {
  url: string;
  title: string;
  faviconUrl: string;
}

interface BrowserSearchResult {
  keyword: string;
  total: number;
  current: number;
}

type BrowserMouseEventType = 'mouseMoved' | 'mousePressed' | 'mouseReleased' | 'mouseWheel';
type BrowserKeyboardEventType = 'keyDown' | 'keyUp';

interface BrowserInputMessage {
  inputType: 'mouse' | 'wheel' | 'keyboard' | 'insertText' | 'composition' | 'commitComposition' | 'cancelComposition';
  eventType?: BrowserMouseEventType | BrowserKeyboardEventType;
  x?: number;
  y?: number;
  button?: 'none' | 'left' | 'middle' | 'right';
  buttons?: number;
  clickCount?: number;
  deltaX?: number;
  deltaY?: number;
  key?: string;
  code?: string;
  text?: string;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
}

interface BrowserViewportMessage {
  width: number;
  height: number;
  deviceScaleFactor?: number;
}

export interface EmbeddedBrowserNavigateOptions {
  url: string;
  useProxy?: boolean;
}

export interface EmbeddedBrowserNavigateResult {
  url: string;
  proxyUrl?: string;
  finalUrl: string;
  useProxy: boolean;
}

export class EmbeddedBrowserService extends EventEmitter {
  public static inject = [ExtensionContextProvider, LocalProxyServerService];

  private readonly context: vscode.ExtensionContext;
  private readonly userDataDirName: string;
  private readonly sharedBrowserSource?: EmbeddedBrowserService;

  private lastNavigationUrl = '';
  private lastProxyUrl = '';
  private useProxy = false;

  private browser: Browser | null = null;
  private page: Page | null = null;
  private client: CDPSession | null = null;
  private isLaunching = false;
  private isScreencastStarted = false;
  private navigationAbortController: AbortController | null = null;
  private lastFramePayload: BrowserFramePayload | null = null;
  private pendingFramePayload: BrowserFramePayload | null = null;
  private frameFlushTimer: NodeJS.Timeout | null = null;
  private sharedCookiePersistTimer: NodeJS.Timeout | null = null;
  private lastFrameEmitAt = 0;
  private readonly frameEmitInterval = platform() === 'darwin' ? 66 : 50;
  private screencastFrameHandler: ((event: any) => Promise<void>) | null = null;
  private readonly hookedPages = new WeakSet<Page>();
  private readonly compatibilityConfiguredPages = new WeakSet<Page>();
  private debugPort = 9222;
  private activeUserDataDirName = 'BrowserUserData';
  private readonly TEMP_USER_DATA_DIR_PREFIX = 'BrowserUserData-Temp-';
  private readonly tempUserDataDirNames = new Set<string>();
  private imeCompositionText = '';
  private lastViewport = {
    width: 1280,
    height: 720,
    deviceScaleFactor: 1,
  };

  constructor(
    private readonly extensionContextProvider: ExtensionContextProvider,
    private readonly localProxyServerService: LocalProxyServerService,
    userDataDirName = 'BrowserUserData',
    sharedBrowserSource?: EmbeddedBrowserService,
  ) {
    super();

    this.context = this.extensionContextProvider.getContext();
    this.userDataDirName = userDataDirName;
    this.activeUserDataDirName = userDataDirName;
    this.sharedBrowserSource = sharedBrowserSource;

    /**
     * 启动时清理超过 1 天的历史临时 Profile。
     * 当前实例创建的临时 Profile 会在 dispose() 时立即删除。
     */
    if (!this.sharedBrowserSource) {
      void this.cleanupStaleTempUserDataDirs();
    }
  }

  /**
   * @description 创建独立浏览器实例
   *
   * 新预览标签共享主实例的 Chrome 进程和 HTTP 磁盘缓存，但仍创建独立
   * Page。这样既不会互相抢占页面，也省去了每个标签重新启动 Chrome、
   * 初始化 Profile 和建立缓存的成本。
   */
  public createDetached(userDataDirName = 'BrowserUserData-Detached'): EmbeddedBrowserService {
    return new EmbeddedBrowserService(this.extensionContextProvider, this.localProxyServerService, userDataDirName, this.sharedBrowserSource || this);
  }

  /**
   * @description 预热浏览器进程
   *
   * 只启动 Chrome，不创建 Page，也不会向欢迎页推送空白截图。
   */
  public async warmUp(): Promise<void> {
    await this.ensureBrowser();
  }

  /**
   * @description 标准化网页地址
   */
  public normalizeUrl(value: string): string {
    const url = String(value || '').trim();

    if (!url) return '';

    if (/^(https?:|file:|about:|vscode-resource:|vscode-webview-resource:)/i.test(url)) {
      return url;
    }

    if (/^[a-zA-Z]:[\\/]/.test(url) || url.startsWith('/')) {
      return vscode.Uri.file(url).toString();
    }

    return `https://${url}`;
  }

  public async getSnapshot(): Promise<BrowserSnapshot> {
    if (!this.page) {
      return {
        url: '',
        title: '',
        faviconUrl: '',
        frame: this.lastFramePayload,
        hasPage: false,
      };
    }

    const metadata = await this.getPageMetadata(this.page);

    return {
      ...metadata,
      frame: this.lastFramePayload,
      hasPage: true,
    };
  }

  /**
   * @description Webview 标签页重新激活后唤醒页面截图流。
   *
   * 部分页面在 VS Code Webview 隐藏后，CDP screencast 可能不再继续推帧。
   * 这时前端还保留最后一张截图，看起来像“页面变成一张图”。
   * 标签页重新显示时主动 bringToFront 并重启 screencast，可以恢复滚动、
   * 点击、刷新后的实时画面。
   */
  public async resumeScreencast(): Promise<BrowserSnapshot> {
    if (!this.page || this.page.isClosed()) {
      return this.getSnapshot();
    }

    const page = await this.ensurePage();

    await page.bringToFront().catch(() => undefined);
    await this.ensureClient();
    await this.restartScreencast();

    if (this.lastFramePayload) {
      this.emit('frame', this.lastFramePayload);
    }

    return this.getSnapshot();
  }

  public async navigate(url: string): Promise<void>;
  public async navigate(options: EmbeddedBrowserNavigateOptions): Promise<EmbeddedBrowserNavigateResult>;
  public async navigate(input: string | EmbeddedBrowserNavigateOptions): Promise<void | EmbeddedBrowserNavigateResult> {
    if (typeof input !== 'string') {
      const normalizedUrl = this.normalizeUrl(input.url);

      if (!normalizedUrl) {
        return {
          url: '',
          finalUrl: '',
          useProxy: false,
        };
      }

      this.lastNavigationUrl = normalizedUrl;
      this.useProxy = Boolean(input.useProxy);

      if (this.useProxy && /^https?:\/\//i.test(normalizedUrl)) {
        const proxyUrl = await this.localProxyServerService.getProxyUrl(normalizedUrl);

        this.lastProxyUrl = proxyUrl;

        return {
          url: normalizedUrl,
          proxyUrl,
          finalUrl: proxyUrl,
          useProxy: true,
        };
      }

      this.lastProxyUrl = '';

      return {
        url: normalizedUrl,
        finalUrl: normalizedUrl,
        useProxy: false,
      };
    }

    const url = this.normalizeUrl(input);

    if (!url) return;

    this.lastNavigationUrl = url;

    const page = await this.ensurePage();

    await this.restoreSharedCookiesForUrl(url).catch((error) => {
      console.warn('[EmbeddedBrowserService] restore shared cookies failed:', error);
    });

    const signal = this.createNavigationSignal();

    try {
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 0,
        signal,
      });
    } catch (error: any) {
      if (this.isNavigationAbortError(error)) {
        console.warn('[EmbeddedBrowserService] navigation aborted:', url);
        return;
      }

      if (this.isNavigationTimeoutError(error)) {
        console.warn('[EmbeddedBrowserService] navigation timeout ignored:', error);
        return;
      }

      this.emit('pageError', {
        url,
        message: error?.message || String(error),
      });
    } finally {
      this.clearNavigationSignal(signal);
      this.schedulePersistSharedCookies(1200);
    }
  }

  public async toggleProxy(): Promise<EmbeddedBrowserNavigateResult | undefined> {
    const snapshot = await this.getSnapshot();
    const lastUrl = snapshot.url || this.lastNavigationUrl;

    if (!lastUrl) return undefined;

    return this.navigate({
      url: lastUrl,
      useProxy: !this.useProxy,
    });
  }

  public getState(): {
    lastUrl: string;
    lastProxyUrl: string;
    useProxy: boolean;
  } {
    return {
      lastUrl: this.page?.url() || this.lastNavigationUrl,
      lastProxyUrl: this.lastProxyUrl,
      useProxy: this.useProxy,
    };
  }

  public stopProxy(): void {
    this.localProxyServerService.stop();
    this.lastProxyUrl = '';
    this.useProxy = false;
  }

  public async reload(url?: string): Promise<void> {
    const page = await this.ensurePage();

    if (url && page.url() !== url) {
      await this.navigate(url);
      return;
    }

    await this.restoreSharedCookiesForUrl(url || page.url()).catch((error) => {
      console.warn('[EmbeddedBrowserService] restore shared cookies before reload failed:', error);
    });

    const signal = this.createNavigationSignal();

    try {
      await page.reload({
        waitUntil: 'domcontentloaded',
        timeout: 0,
        signal,
      });
    } catch (error: any) {
      if (this.isNavigationAbortError(error)) {
        console.warn('[EmbeddedBrowserService] reload aborted:', page.url());
        return;
      }

      if (this.isNavigationTimeoutError(error)) {
        console.warn('[EmbeddedBrowserService] reload timeout ignored:', error);
        return;
      }

      this.emit('pageError', {
        url: page.url(),
        message: error?.message || String(error),
      });
    } finally {
      this.clearNavigationSignal(signal);
      this.schedulePersistSharedCookies(1200);
    }
  }

  public async goBack(): Promise<void> {
    const page = await this.ensurePage();
    const signal = this.createNavigationSignal();

    try {
      await page.goBack({ waitUntil: 'domcontentloaded', timeout: 0, signal }).catch(() => undefined);
    } finally {
      this.clearNavigationSignal(signal);
    }
  }

  public async goForward(): Promise<void> {
    const page = await this.ensurePage();
    const signal = this.createNavigationSignal();

    try {
      await page.goForward({ waitUntil: 'domcontentloaded', timeout: 0, signal }).catch(() => undefined);
    } finally {
      this.clearNavigationSignal(signal);
    }
  }

  public async stopLoading(): Promise<void> {
    this.abortCurrentNavigation();

    if (!this.client || !this.page || this.page.isClosed()) return;

    await this.client.send('Page.stopLoading').catch((error) => {
      if (!this.isTargetClosedError(error)) {
        console.warn('[EmbeddedBrowserService] stop loading failed:', error);
      }
    });
  }

  public async copySelectedText(): Promise<void> {
    const page = await this.ensurePage();

    const text = await page
      .evaluate(() => {
        const activeElement = document.activeElement as HTMLElement | null;
        const selectionText = window.getSelection()?.toString() || '';

        if (selectionText) {
          return selectionText;
        }

        if (!activeElement) {
          return '';
        }

        const tagName = activeElement.tagName.toLowerCase();
        const isInput = tagName === 'input';
        const isTextarea = tagName === 'textarea';

        if (isInput || isTextarea) {
          const input = activeElement as HTMLInputElement | HTMLTextAreaElement;
          const value = typeof input.value === 'string' ? input.value : '';
          const start = typeof input.selectionStart === 'number' ? input.selectionStart : 0;
          const end = typeof input.selectionEnd === 'number' ? input.selectionEnd : 0;

          if (end > start) {
            return value.slice(start, end);
          }

          return value;
        }

        const editable = activeElement.closest('[contenteditable="true"], [contenteditable="plaintext-only"]') as HTMLElement | null;

        if (editable) {
          return editable.innerText || editable.textContent || '';
        }

        return '';
      })
      .catch(() => '');

    const normalizedText = String(text || '');

    if (!normalizedText) return;

    await vscode.env.clipboard.writeText(normalizedText);
  }

  public async selectTextRange(startX: number, startY: number, endX: number, endY: number): Promise<void> {
    const page = await this.ensurePage();

    await page
      .evaluate(
        (payload) => {
          const getFormControlByPoint = (x: number, y: number): HTMLInputElement | HTMLTextAreaElement | null => {
            const normalizedX = Math.max(0, Math.floor(Number(x) || 0));
            const normalizedY = Math.max(0, Math.floor(Number(y) || 0));
            const element = document.elementFromPoint(normalizedX, normalizedY);
            const control = element?.closest('input, textarea');

            if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) {
              return control;
            }

            return null;
          };

          const startControl = getFormControlByPoint(payload.startX, payload.startY);
          const endControl = getFormControlByPoint(payload.endX, payload.endY);

          /**
           * input / textarea 内部的文本不是普通 DOM 文本节点，不能通过
           * window.getSelection() 与 Range 设置选区。
           *
           * 这里交给已经转发到 Chromium 的原生鼠标按下、移动、松开事件处理，
           * 避免自定义 DOM Range 覆盖输入框自身的 selectionStart / selectionEnd。
           */
          if (startControl || endControl) {
            return;
          }

          const getRangeByPoint = (x: number, y: number): Range | null => {
            const normalizedX = Math.max(0, Math.floor(Number(x) || 0));
            const normalizedY = Math.max(0, Math.floor(Number(y) || 0));
            const doc = document as Document & {
              caretRangeFromPoint?: (x: number, y: number) => Range | null;
              caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
            };

            if (typeof doc.caretRangeFromPoint === 'function') {
              return doc.caretRangeFromPoint(normalizedX, normalizedY);
            }

            if (typeof doc.caretPositionFromPoint === 'function') {
              const position = doc.caretPositionFromPoint(normalizedX, normalizedY);

              if (!position) return null;

              const range = document.createRange();

              range.setStart(position.offsetNode, position.offset);
              range.collapse(true);

              return range;
            }

            return null;
          };

          const createSelectionRange = (startRange: Range, endRange: Range): Range => {
            const range = document.createRange();

            range.setStart(startRange.startContainer, startRange.startOffset);
            range.setEnd(endRange.startContainer, endRange.startOffset);

            if (range.collapsed && (startRange.startContainer !== endRange.startContainer || startRange.startOffset !== endRange.startOffset)) {
              range.setStart(endRange.startContainer, endRange.startOffset);
              range.setEnd(startRange.startContainer, startRange.startOffset);
            }

            return range;
          };

          const startRange = getRangeByPoint(payload.startX, payload.startY);
          const endRange = getRangeByPoint(payload.endX, payload.endY);

          if (!startRange || !endRange) return;

          const selection = window.getSelection();

          if (!selection) return;

          const range = createSelectionRange(startRange, endRange);

          selection.removeAllRanges();

          if (!range.collapsed) {
            selection.addRange(range);
          }
        },
        {
          startX,
          startY,
          endX,
          endY,
        },
      )
      .catch(() => undefined);
  }

  public async searchInPage(keyword: string, direction: 'next' | 'previous' = 'next'): Promise<BrowserSearchResult> {
    const page = await this.ensurePage();
    const normalizedKeyword = String(keyword || '').trim();

    if (!normalizedKeyword) {
      await this.clearSearchHighlights();
      return {
        keyword: '',
        total: 0,
        current: 0,
      };
    }

    return page
      .evaluate(
        (payload) => {
          const highlightAttr = 'data-quick-ops-search-highlight';
          const activeAttr = 'data-quick-ops-search-active';
          const stateKey = '__quickOpsSearchState__';

          type SearchState = {
            keyword: string;
            activeIndex: number;
          };

          const win = window as typeof window & {
            [stateKey]?: SearchState;
          };

          const clearHighlights = () => {
            const highlights = Array.from(document.querySelectorAll(`[${highlightAttr}="true"]`));

            for (const node of highlights) {
              const parent = node.parentNode;

              if (!parent) continue;

              parent.replaceChild(document.createTextNode(node.textContent || ''), node);
              parent.normalize();
            }
          };

          const shouldSkipTextNode = (node: Text) => {
            const parent = node.parentElement;

            if (!parent) return true;

            const tagName = parent.tagName.toLowerCase();

            if (
              tagName === 'script' ||
              tagName === 'style' ||
              tagName === 'noscript' ||
              tagName === 'textarea' ||
              tagName === 'input' ||
              tagName === 'select' ||
              tagName === 'option'
            ) {
              return true;
            }

            if (parent.closest(`[${highlightAttr}="true"]`)) return true;
            if (parent.closest('[contenteditable="true"]')) return true;

            const style = window.getComputedStyle(parent);

            return style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0;
          };

          const previousState = win[stateKey];
          const previousActiveIndex = previousState && previousState.keyword === payload.keyword && Number.isFinite(previousState.activeIndex) ? previousState.activeIndex : -1;

          clearHighlights();

          const keyword = payload.keyword;
          const lowerKeyword = keyword.toLowerCase();
          const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
          const textNodes: Text[] = [];
          let currentNode = walker.nextNode();

          while (currentNode) {
            const textNode = currentNode as Text;

            if (!shouldSkipTextNode(textNode) && textNode.nodeValue?.trim()) {
              textNodes.push(textNode);
            }

            currentNode = walker.nextNode();
          }

          const highlights: HTMLElement[] = [];

          for (const textNode of textNodes) {
            const source = textNode.nodeValue || '';
            const lowerSource = source.toLowerCase();
            let index = 0;
            let matchIndex = lowerSource.indexOf(lowerKeyword, index);

            if (matchIndex === -1) continue;

            const fragment = document.createDocumentFragment();

            while (matchIndex !== -1) {
              if (matchIndex > index) {
                fragment.appendChild(document.createTextNode(source.slice(index, matchIndex)));
              }

              const span = document.createElement('span');

              span.setAttribute(highlightAttr, 'true');
              span.textContent = source.slice(matchIndex, matchIndex + keyword.length);
              span.style.backgroundColor = 'rgba(255, 213, 0, 0.78)';
              span.style.color = 'inherit';
              span.style.borderRadius = '2px';
              span.style.boxShadow = '0 0 0 1px rgba(180, 120, 0, 0.35)';

              fragment.appendChild(span);
              highlights.push(span);

              index = matchIndex + keyword.length;
              matchIndex = lowerSource.indexOf(lowerKeyword, index);
            }

            if (index < source.length) {
              fragment.appendChild(document.createTextNode(source.slice(index)));
            }

            textNode.parentNode?.replaceChild(fragment, textNode);
          }

          const total = highlights.length;

          if (!total) {
            win[stateKey] = {
              keyword,
              activeIndex: -1,
            };

            return {
              keyword,
              total: 0,
              current: 0,
            };
          }

          let activeIndex = 0;

          if (previousActiveIndex > -1) {
            activeIndex = payload.direction === 'previous' ? (previousActiveIndex - 1 + total) % total : (previousActiveIndex + 1) % total;
          }

          const active = highlights[activeIndex];

          active.setAttribute(activeAttr, 'true');
          active.style.backgroundColor = 'rgba(255, 136, 0, 0.95)';
          active.style.outline = '2px solid rgba(255, 98, 0, 0.9)';
          active.style.outlineOffset = '1px';

          active.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
            inline: 'center',
          });

          const selection = window.getSelection();

          if (selection) {
            const range = document.createRange();

            range.selectNodeContents(active);
            selection.removeAllRanges();
            selection.addRange(range);
          }

          win[stateKey] = {
            keyword,
            activeIndex,
          };

          return {
            keyword,
            total,
            current: activeIndex + 1,
          };
        },
        {
          keyword: normalizedKeyword,
          direction,
        },
      )
      .catch((error) => {
        if (this.isTargetClosedError(error)) {
          return {
            keyword: normalizedKeyword,
            total: 0,
            current: 0,
          };
        }

        throw error;
      });
  }

  public async clearSearchHighlights(): Promise<void> {
    if (!this.page || this.page.isClosed()) return;

    await this.page
      .evaluate(() => {
        const highlightAttr = 'data-quick-ops-search-highlight';
        const stateKey = '__quickOpsSearchState__';
        const highlights = Array.from(document.querySelectorAll(`[${highlightAttr}="true"]`));

        for (const node of highlights) {
          const parent = node.parentNode;

          if (!parent) continue;

          parent.replaceChild(document.createTextNode(node.textContent || ''), node);
          parent.normalize();
        }

        delete (window as any)[stateKey];
        window.getSelection()?.removeAllRanges();
      })
      .catch(() => undefined);
  }

  private getSharedCookieDirUri(): vscode.Uri {
    return vscode.Uri.joinPath(this.context.globalStorageUri, 'BrowserSharedState');
  }

  private getSharedCookieFileUri(): vscode.Uri {
    return vscode.Uri.joinPath(this.getSharedCookieDirUri(), 'cookies.json');
  }

  private isHttpLikeUrl(rawUrl: string): boolean {
    return /^https?:\/\//i.test(String(rawUrl || '').trim());
  }

  private async readSharedCookies(): Promise<any[]> {
    try {
      const content = await vscode.workspace.fs.readFile(this.getSharedCookieFileUri());
      const json = JSON.parse(Buffer.from(content).toString('utf8'));

      return Array.isArray(json) ? json : [];
    } catch {
      return [];
    }
  }

  private async writeSharedCookies(cookies: any[]): Promise<void> {
    await Promise.resolve(vscode.workspace.fs.createDirectory(this.getSharedCookieDirUri())).catch(() => undefined);

    const safeCookies = Array.isArray(cookies) ? cookies : [];
    const content = Buffer.from(JSON.stringify(safeCookies, null, 2), 'utf8');

    await vscode.workspace.fs.writeFile(this.getSharedCookieFileUri(), content);
  }

  private getCookieMergeKey(cookie: any): string {
    return [String(cookie?.name || ''), String(cookie?.domain || ''), String(cookie?.path || '/')].join('\n');
  }

  private normalizeCookieForStorage(cookie: any): any | null {
    const name = String(cookie?.name || '').trim();
    const value = typeof cookie?.value === 'string' ? cookie.value : String(cookie?.value ?? '');
    const domain = String(cookie?.domain || '').trim();

    if (!name || !domain) {
      return null;
    }

    const result: any = {
      name,
      value,
      domain,
      path: String(cookie?.path || '/'),
      secure: !!cookie?.secure,
      httpOnly: !!cookie?.httpOnly,
    };

    const expires = Number(cookie?.expires);

    if (Number.isFinite(expires) && expires > 0) {
      result.expires = expires;
    }

    const sameSite = String(cookie?.sameSite || '').trim();

    if (sameSite === 'Strict' || sameSite === 'Lax' || sameSite === 'None') {
      result.sameSite = sameSite;
    }

    return result;
  }

  private isCookieDomainMatchedUrl(cookie: any, rawUrl: string): boolean {
    if (!this.isHttpLikeUrl(rawUrl)) return false;

    try {
      const host = new URL(rawUrl).hostname.toLowerCase();
      const domain = String(cookie?.domain || '')
        .replace(/^\./, '')
        .toLowerCase();

      return !!host && !!domain && (host === domain || host.endsWith(`.${domain}`));
    } catch {
      return false;
    }
  }

  private isCookieMatchedUrl(cookie: any, rawUrl: string): boolean {
    if (!this.isHttpLikeUrl(rawUrl)) return false;

    try {
      const targetUrl = new URL(rawUrl);
      if (!this.isCookieDomainMatchedUrl(cookie, rawUrl)) return false;
      if (cookie?.secure && targetUrl.protocol !== 'https:') return false;

      const cookiePath = String(cookie?.path || '/');
      const pathname = targetUrl.pathname || '/';

      return pathname === cookiePath || pathname.startsWith(cookiePath.endsWith('/') ? cookiePath : `${cookiePath}/`) || cookiePath === '/';
    } catch {
      return false;
    }
  }

  private toNetworkCookieParam(cookie: any): any | null {
    const normalized = this.normalizeCookieForStorage(cookie);

    if (!normalized) return null;

    const result: any = {
      name: normalized.name,
      value: normalized.value,
      domain: normalized.domain,
      path: normalized.path || '/',
      secure: !!normalized.secure,
      httpOnly: !!normalized.httpOnly,
    };

    if (normalized.expires) {
      result.expires = normalized.expires;
    }

    if (normalized.sameSite) {
      result.sameSite = normalized.sameSite;
    }

    return result;
  }

  private async restoreSharedCookiesForUrl(rawUrl: string): Promise<void> {
    if (!this.isHttpLikeUrl(rawUrl)) return;

    const cookies = await this.readSharedCookies();
    const matchedCookies = cookies
      .filter((cookie) => this.isCookieMatchedUrl(cookie, rawUrl))
      .map((cookie) => this.toNetworkCookieParam(cookie))
      .filter(Boolean);

    if (matchedCookies.length === 0) return;

    const client = await this.ensureClient();

    await client
      .send('Network.setCookies', {
        cookies: matchedCookies,
      })
      .catch((error) => {
        console.warn('[EmbeddedBrowserService] set shared cookies failed:', error);
      });
  }

  private schedulePersistSharedCookies(delay: number = 1500): void {
    if (this.sharedCookiePersistTimer) return;

    this.sharedCookiePersistTimer = setTimeout(() => {
      this.sharedCookiePersistTimer = null;
      void this.persistSharedCookies().catch((error) => {
        console.warn('[EmbeddedBrowserService] persist shared cookies failed:', error);
      });
    }, delay);
  }

  private async persistSharedCookies(): Promise<void> {
    if (!this.page || this.page.isClosed()) return;

    const client = this.client || (await this.ensureClient().catch(() => null));

    if (!client) return;

    const response = (await client.send('Network.getAllCookies').catch(() => null)) as any;
    const currentCookies = Array.isArray(response?.cookies) ? response.cookies : [];

    if (currentCookies.length === 0) return;

    const existingCookies = await this.readSharedCookies();
    const cookieMap = new Map<string, any>();
    const nowSeconds = Date.now() / 1000;

    existingCookies.forEach((cookie) => {
      const normalized = this.normalizeCookieForStorage(cookie);

      if (!normalized) return;
      if (normalized.expires && normalized.expires <= nowSeconds) return;

      cookieMap.set(this.getCookieMergeKey(normalized), normalized);
    });

    currentCookies.forEach((cookie: any) => {
      const normalized = this.normalizeCookieForStorage(cookie);

      if (!normalized) return;

      const key = this.getCookieMergeKey(normalized);

      if (normalized.expires && normalized.expires <= nowSeconds) {
        cookieMap.delete(key);
        return;
      }

      cookieMap.set(key, normalized);
    });

    await this.writeSharedCookies(Array.from(cookieMap.values()));
  }

  /**
   * @description 清理当前预览页缓存
   *
   * 只清 HTTP Cache、当前站点 Cache Storage 与 Service Worker，
   * 不清 Cookie、LocalStorage、SessionStorage 和登录态。
   */
  public async clearCache(): Promise<void> {
    const client = await this.ensureClient();
    const currentUrl = this.page?.url() || this.lastNavigationUrl;

    await client.send('Network.clearBrowserCache');

    if (this.isHttpLikeUrl(currentUrl)) {
      await client
        .send('Storage.clearDataForOrigin', {
          origin: new URL(currentUrl).origin,
          storageTypes: 'cache_storage,service_workers',
        })
        .catch((error) => {
          console.warn('[EmbeddedBrowserService] clear origin cache storage failed:', error);
        });
    }
  }

  public async getDevToolsUrl(): Promise<string> {
    await this.ensureClient();

    const port = this.debugPort;
    const pageId = this.getPageId();

    if (!pageId) return '';

    return `http://127.0.0.1:${port}/devtools/inspector.html?ws=127.0.0.1:${port}/devtools/page/${pageId}`;
  }

  public async openDevTools(): Promise<void> {
    const devToolsUrl = await this.getDevToolsUrl();

    if (!devToolsUrl) {
      await vscode.commands.executeCommand('workbench.action.webview.openDeveloperTools');
      return;
    }

    await vscode.env.openExternal(vscode.Uri.parse(devToolsUrl));
  }

  public async setViewport(message: BrowserViewportMessage): Promise<void> {
    const width = Math.max(320, Math.floor(Number(message.width) || 1280));
    const height = Math.max(240, Math.floor(Number(message.height) || 720));
    const rawDeviceScaleFactor = Number(message.deviceScaleFactor) || 1;
    const deviceScaleFactor = Math.min(this.getMaxDeviceScaleFactor(), Math.max(1, rawDeviceScaleFactor));

    if (this.lastViewport.width === width && this.lastViewport.height === height && this.lastViewport.deviceScaleFactor === deviceScaleFactor) {
      return;
    }

    this.lastViewport = {
      width,
      height,
      deviceScaleFactor,
    };

    if (!this.page) return;

    await this.page.setViewport({
      width,
      height,
      deviceScaleFactor,
    });

    if (this.client) {
      await this.client
        .send('Emulation.setDeviceMetricsOverride', {
          width,
          height,
          deviceScaleFactor,
          mobile: false,
        })
        .catch(() => undefined);

      await this.restartScreencast();
    }
  }

  public async dispatchInput(message: BrowserInputMessage): Promise<void> {
    if (!this.page || this.page.isClosed()) return;

    try {
      const client = await this.ensureClient();

      if (!this.page || this.page.isClosed()) return;

      if (message.inputType === 'mouse') {
        const eventType = this.normalizeMouseEventType(message.eventType);

        await client.send('Input.dispatchMouseEvent', {
          type: eventType,
          x: Math.max(0, Number(message.x) || 0),
          y: Math.max(0, Number(message.y) || 0),
          button: message.button || 'none',
          buttons: Math.max(0, Number(message.buttons) || 0),
          clickCount: eventType === 'mouseMoved' ? 0 : Math.max(1, Number(message.clickCount) || 1),
        });
        return;
      }

      if (message.inputType === 'wheel') {
        await client.send('Input.dispatchMouseEvent', {
          type: 'mouseWheel',
          x: Math.max(0, Number(message.x) || 0),
          y: Math.max(0, Number(message.y) || 0),
          deltaX: Number(message.deltaX) || 0,
          deltaY: Number(message.deltaY) || 0,
        });
        return;
      }

      if (message.inputType === 'insertText') {
        const text = typeof message.text === 'string' ? message.text : '';

        this.imeCompositionText = '';

        if (text) {
          await client.send('Input.insertText', { text });
        }

        return;
      }

      if (message.inputType === 'composition') {
        const text = typeof message.text === 'string' ? message.text : '';

        await this.updateImeComposition(text);
        return;
      }

      if (message.inputType === 'commitComposition') {
        const text = typeof message.text === 'string' ? message.text : '';

        await this.commitImeComposition(text);
        return;
      }

      if (message.inputType === 'cancelComposition') {
        await this.cancelImeComposition();
        return;
      }

      if (message.inputType === 'keyboard') {
        this.imeCompositionText = '';
        await this.dispatchKeyboardInput(message);
      }
    } catch (error) {
      if (this.isTargetClosedError(error)) {
        console.warn('[EmbeddedBrowserService] input ignored because target was closed:', error);
        await this.resetClosedPageState();
        return;
      }

      console.warn('[EmbeddedBrowserService] dispatch input failed:', error);
    }
  }

  public async stop(): Promise<void> {
    await this.disposePage();
  }

  public async dispose(): Promise<void> {
    if (!this.sharedBrowserSource) {
      this.stopProxy();
    } else {
      this.lastProxyUrl = '';
      this.useProxy = false;
    }

    if (this.sharedCookiePersistTimer) {
      clearTimeout(this.sharedCookiePersistTimer);
      this.sharedCookiePersistTimer = null;
    }

    await this.persistSharedCookies().catch(() => undefined);
    await this.disposePage();

    if (this.browser && !this.sharedBrowserSource) {
      await this.browser.close().catch(() => undefined);
    }

    this.browser = null;

    if (!this.sharedBrowserSource) {
      await this.cleanupCreatedTempUserDataDirs();
    }

    this.activeUserDataDirName = this.userDataDirName;
    this.removeAllListeners();
  }

  private isTargetClosedError(error: unknown): boolean {
    if (!error) return false;

    const message = error instanceof Error ? error.message : String(error);

    return /target closed|session closed|connection closed|protocol error.*target closed|target page, context or browser has been closed/i.test(message);
  }

  private async resetClosedPageState(): Promise<void> {
    this.abortCurrentNavigation();
    this.isScreencastStarted = false;
    this.lastFramePayload = null;
    this.pendingFramePayload = null;

    if (this.frameFlushTimer) {
      clearTimeout(this.frameFlushTimer);
      this.frameFlushTimer = null;
    }

    if (this.client) {
      await this.client.detach().catch(() => undefined);
      this.client = null;
    }

    this.page = null;
  }

  private createNavigationSignal(): AbortSignal {
    this.abortCurrentNavigation();

    const controller = new AbortController();

    this.navigationAbortController = controller;

    return controller.signal;
  }

  private clearNavigationSignal(signal: AbortSignal): void {
    if (this.navigationAbortController?.signal === signal) {
      this.navigationAbortController = null;
    }
  }

  private abortCurrentNavigation(): void {
    if (!this.navigationAbortController) return;

    this.navigationAbortController.abort();
    this.navigationAbortController = null;
  }

  private isNavigationAbortError(error: unknown): boolean {
    if (!error) return false;

    const name = typeof error === 'object' && 'name' in error ? String((error as { name?: unknown }).name || '') : '';
    const message = error instanceof Error ? error.message : String(error);

    return name === 'AbortError' || /abort|aborted/i.test(message);
  }

  private isNavigationTimeoutError(error: unknown): boolean {
    if (!error) return false;

    const message = error instanceof Error ? error.message : String(error);

    return /timeout|timed out|navigation timeout/i.test(message);
  }

  private normalizeMouseEventType(eventType?: BrowserMouseEventType | BrowserKeyboardEventType): BrowserMouseEventType {
    if (eventType === 'mouseMoved' || eventType === 'mousePressed' || eventType === 'mouseReleased' || eventType === 'mouseWheel') {
      return eventType;
    }

    return 'mouseMoved';
  }

  private getNumberConfig(key: string, fallback: number): number {
    const value = vscode.workspace.getConfiguration().get<number>(key);

    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return fallback;
    }

    return value;
  }

  private clampNumber(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }

  private getMaxDeviceScaleFactor(): number {
    const fallback = 2;

    return this.clampNumber(this.getNumberConfig('quickOps.browser.maxDeviceScaleFactor', fallback), 1, 3);
  }

  private getScreencastQuality(): number {
    const fallback = 100;

    return Math.round(this.clampNumber(this.getNumberConfig('quickOps.browser.screencastQuality', fallback), 45, 100));
  }

  private getScreencastEveryNthFrame(): number {
    const fallback = platform() === 'darwin' ? 1 : 1;

    return Math.round(this.clampNumber(this.getNumberConfig('quickOps.browser.screencastEveryNthFrame', fallback), 1, 3));
  }
  private getScreencastFormat(): 'jpeg' | 'png' {
    const format = String(vscode.workspace.getConfiguration().get<string>('quickOps.browser.screencastFormat') || 'png').toLowerCase();

    return format === 'png' ? 'png' : 'jpeg';
  }

  private async restartScreencast(): Promise<void> {
    if (!this.client || !this.isScreencastStarted) return;

    await this.client.send('Page.stopScreencast').catch(() => undefined);

    if (this.screencastFrameHandler) {
      this.client.off('Page.screencastFrame', this.screencastFrameHandler as any);
      this.screencastFrameHandler = null;
    }

    this.isScreencastStarted = false;
    await this.startScreencast();
  }

  private async updateImeComposition(text: string): Promise<void> {
    const client = await this.ensureClient();
    const nextText = String(text || '');

    this.imeCompositionText = nextText;

    await (client as any)
      .send('Input.imeSetComposition', {
        text: nextText,
        selectionStart: nextText.length,
        selectionEnd: nextText.length,
      })
      .catch((error: unknown) => {
        if (!this.isTargetClosedError(error)) {
          console.warn('[EmbeddedBrowserService] ime composition update failed:', error);
        }
      });
  }

  private async commitImeComposition(text: string): Promise<void> {
    const client = await this.ensureClient();
    const nextText = String(text || '');

    if (this.imeCompositionText) {
      await (client as any)
        .send('Input.imeSetComposition', {
          text: '',
          selectionStart: 0,
          selectionEnd: 0,
        })
        .catch((error: unknown) => {
          if (!this.isTargetClosedError(error)) {
            console.warn('[EmbeddedBrowserService] ime composition clear before commit failed:', error);
          }
        });
    }

    this.imeCompositionText = '';

    if (nextText) {
      await client.send('Input.insertText', { text: nextText });
    }
  }

  private async cancelImeComposition(): Promise<void> {
    if (!this.imeCompositionText) return;

    const client = await this.ensureClient();

    await (client as any)
      .send('Input.imeSetComposition', {
        text: '',
        selectionStart: 0,
        selectionEnd: 0,
      })
      .catch((error: unknown) => {
        if (!this.isTargetClosedError(error)) {
          console.warn('[EmbeddedBrowserService] ime composition cancel failed:', error);
        }
      });

    this.imeCompositionText = '';
  }

  /**
   * @description 向内嵌 Chromium 转发键盘事件
   *
   * 普通字符继续使用 Input.insertText，兼容现有英文输入和中文输入法逻辑。
   * Enter 使用 Puppeteer Keyboard.press 发送完整按下、字符和抬起事件，
   * 由目标网页自行决定执行提交还是换行。
   */
  private async dispatchKeyboardInput(message: BrowserInputMessage): Promise<void> {
    const page = await this.ensurePage();
    const client = await this.ensureClient();
    const key = message.key || '';
    const eventType = message.eventType === 'keyUp' ? 'keyUp' : 'keyDown';

    if (key === 'Process' || key === 'Unidentified' || key === 'Dead') {
      return;
    }

    /**
     * Enter 必须向目标网页发送完整键盘事件。
     *
     * 之前对 contenteditable、textarea、aria-multiline 元素调用
     * Input.insertText({ text: '\n' })，只能插入换行，不会触发网页监听的
     * keydown / keyup，因此聊天输入框无法执行提交。
     *
     * Webview 会分别发送 keyDown 和 keyUp。这里在 keyDown 时通过 press()
     * 一次性发送完整事件，并忽略随后到达的 keyUp，避免重复触发。
     */
    if (key === 'Enter') {
      if (eventType === 'keyUp') {
        return;
      }

      this.imeCompositionText = '';

      const pressedModifiers: Array<'Alt' | 'Control' | 'Meta' | 'Shift'> = [];

      try {
        if (message.altKey) {
          await page.keyboard.down('Alt');
          pressedModifiers.push('Alt');
        }

        if (message.ctrlKey) {
          await page.keyboard.down('Control');
          pressedModifiers.push('Control');
        }

        if (message.metaKey) {
          await page.keyboard.down('Meta');
          pressedModifiers.push('Meta');
        }

        if (message.shiftKey) {
          await page.keyboard.down('Shift');
          pressedModifiers.push('Shift');
        }

        await page.keyboard.press('Enter');
      } finally {
        while (pressedModifiers.length > 0) {
          const modifier = pressedModifiers.pop();

          if (modifier) {
            await page.keyboard.up(modifier).catch(() => undefined);
          }
        }
      }

      return;
    }

    /**
     * 普通字符不在 keyDown 中重复转发中文输入法的组合文本。
     * 中文输入仍由 composition / commitComposition 相关分支处理。
     */
    if (eventType === 'keyDown' && key.length === 1 && !message.ctrlKey && !message.metaKey && !message.altKey) {
      await client.send('Input.insertText', { text: key });
      return;
    }

    const virtualKeyCode = this.getVirtualKeyCode(key);
    const dispatchType = eventType === 'keyUp' ? 'keyUp' : 'rawKeyDown';

    await client.send('Input.dispatchKeyEvent', {
      type: dispatchType,
      key,
      code: message.code || key,
      windowsVirtualKeyCode: virtualKeyCode,
      nativeVirtualKeyCode: virtualKeyCode,
      modifiers: this.getKeyboardModifiers(message),
    });
  }

  private getKeyboardModifiers(message: BrowserInputMessage): number {
    let modifiers = 0;

    if (message.altKey) modifiers += 1;
    if (message.ctrlKey) modifiers += 2;
    if (message.metaKey) modifiers += 4;
    if (message.shiftKey) modifiers += 8;

    return modifiers;
  }

  private getVirtualKeyCode(key: string): number {
    if (!key) return 0;

    const specialKeyMap: Record<string, number> = {
      Backspace: 8,
      Tab: 9,
      Enter: 13,
      Escape: 27,
      ArrowLeft: 37,
      ArrowUp: 38,
      ArrowRight: 39,
      ArrowDown: 40,
      Delete: 46,
      Home: 36,
      End: 35,
      PageUp: 33,
      PageDown: 34,
      Space: 32,
    };

    if (specialKeyMap[key]) return specialKeyMap[key];
    if (key.length === 1) return key.toUpperCase().charCodeAt(0);

    return 0;
  }

  private async ensurePage(): Promise<Page> {
    if (this.page?.isClosed()) {
      await this.resetClosedPageState();
    }

    if (this.page) return this.page;

    await this.ensureBrowser();

    if (!this.browser) {
      throw new Error('Chrome 启动失败。');
    }

    this.page = await this.browser.newPage();
    await this.page.setViewport(this.lastViewport);
    await this.configurePageCompatibility(this.page);
    await this.hookPageEvents(this.page);
    await this.ensureClient();

    return this.page;
  }

  private async ensureClient(): Promise<CDPSession> {
    const page = await this.ensurePageWithoutClientLoop();

    if (this.client && (!this.page || this.page.isClosed())) {
      await this.client.detach().catch(() => undefined);
      this.client = null;
    }

    if (this.client) return this.client;

    const client = await page.target().createCDPSession();

    this.client = client;

    await client.send('Page.enable');
    await client.send('Runtime.enable');
    await client.send('Network.enable');
    await this.startScreencast();

    return client;
  }

  private async ensurePageWithoutClientLoop(): Promise<Page> {
    if (this.page?.isClosed()) {
      await this.resetClosedPageState();
    }

    if (this.page) return this.page;

    await this.ensureBrowser();

    if (!this.browser) {
      throw new Error('Chrome 启动失败。');
    }

    this.page = await this.browser.newPage();
    await this.page.setViewport(this.lastViewport);
    await this.configurePageCompatibility(this.page);
    await this.hookPageEvents(this.page);

    return this.page;
  }

  /**
   * @description 配置网页兼容请求信息
   *
   * Puppeteer 的无头模式会在 User-Agent 中加入 HeadlessChrome。
   * 这里直接使用当前已安装 Chrome 返回的 UA，仅移除无头模式标识，
   * 保证浏览器版本、操作系统信息与真实运行环境保持一致，不写死版本号。
   *
   * 该配置只作用于当前 Page，不写入 VS Code 全局设置。
   */
  private async configurePageCompatibility(page: Page): Promise<void> {
    if (this.compatibilityConfiguredPages.has(page)) return;

    this.compatibilityConfiguredPages.add(page);

    let browserUserAgent = '';

    try {
      browserUserAgent = String((await this.browser?.userAgent()) || '').trim();
    } catch {
      browserUserAgent = '';
    }

    const userAgent = browserUserAgent.replace(/\bHeadlessChrome\//gi, 'Chrome/');

    if (userAgent) {
      await page.setUserAgent(userAgent).catch((error) => {
        console.warn('[EmbeddedBrowserService] set compatible user agent failed:', error);
      });
    }

    await page
      .setExtraHTTPHeaders({
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      })
      .catch((error) => {
        console.warn('[EmbeddedBrowserService] set compatible request headers failed:', error);
      });
  }

  /**
   * @description 获取当前网页标题与站点图标
   */
  private async getPageMetadata(page: Page): Promise<BrowserPageMetadata> {
    try {
      return await page.evaluate(() => {
        const url = window.location.href;
        const title = document.title || url;
        const links = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel][href]'));
        const declaredIcon = links.find((link) => {
          const rel = String(link.rel || '').toLowerCase();
          const relTokens = rel.split(/\s+/).filter(Boolean);

          return relTokens.includes('icon') || rel === 'apple-touch-icon' || rel === 'apple-touch-icon-precomposed';
        });

        let faviconUrl = declaredIcon?.href || '';

        if (!faviconUrl && /^https?:\/\//i.test(url)) {
          try {
            faviconUrl = new URL('/favicon.ico', url).href;
          } catch {
            faviconUrl = '';
          }
        }

        return {
          url,
          title,
          faviconUrl,
        };
      });
    } catch {
      const fallbackUrl = page.url();
      const fallbackTitle = await page.title().catch(() => fallbackUrl);

      return {
        url: fallbackUrl,
        title: fallbackTitle || fallbackUrl,
        faviconUrl: '',
      };
    }
  }

  private isTempUserDataDirName(userDataDirName: string): boolean {
    return String(userDataDirName || '').startsWith(this.TEMP_USER_DATA_DIR_PREFIX);
  }

  private getUserDataDirUri(userDataDirName: string): vscode.Uri {
    return vscode.Uri.joinPath(this.context.globalStorageUri, userDataDirName);
  }

  private async deleteTempUserDataDir(userDataDirName: string): Promise<void> {
    if (!this.isTempUserDataDirName(userDataDirName)) return;

    const uri = this.getUserDataDirUri(userDataDirName);

    await Promise.resolve(
      vscode.workspace.fs.delete(uri, {
        recursive: true,
        useTrash: false,
      }),
    ).catch(() => undefined);
  }

  private async cleanupCreatedTempUserDataDirs(): Promise<void> {
    const names = new Set(this.tempUserDataDirNames);

    if (this.isTempUserDataDirName(this.activeUserDataDirName)) {
      names.add(this.activeUserDataDirName);
    }

    await Promise.allSettled(Array.from(names).map((name) => this.deleteTempUserDataDir(name)));
    this.tempUserDataDirNames.clear();
  }

  private async cleanupStaleTempUserDataDirs(maxAge = 24 * 60 * 60 * 1000): Promise<void> {
    try {
      const entries = await vscode.workspace.fs.readDirectory(this.context.globalStorageUri);
      const now = Date.now();

      await Promise.allSettled(
        entries
          .filter(([name, fileType]) => {
            return fileType === vscode.FileType.Directory && this.isTempUserDataDirName(name);
          })
          .map(async ([name]) => {
            const uri = this.getUserDataDirUri(name);
            const stat = await Promise.resolve(vscode.workspace.fs.stat(uri)).catch(() => null);

            if (!stat) return;

            /**
             * 不立即删除所有临时目录，避免多窗口并发运行时误删正在使用的 Profile。
             * 当前实例创建的临时目录会在 dispose() 中立即清理。
             */
            if (now - stat.mtime < maxAge) return;

            await this.deleteTempUserDataDir(name);
          }),
      );
    } catch {
      // ignore
    }
  }

  private createUserDataDirName(): string {
    const userDataDirName = `${this.TEMP_USER_DATA_DIR_PREFIX}${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    this.tempUserDataDirNames.add(userDataDirName);

    return userDataDirName;
  }

  private isUserDataDirLockedError(error: unknown): boolean {
    if (!error) return false;

    const message = error instanceof Error ? error.message : String(error);

    return /browser is already running|userdatadir|user data dir|process_singleton|profile.*in use|正在运行/i.test(message);
  }

  private async ensureBrowser(): Promise<void> {
    if (this.sharedBrowserSource) {
      await this.sharedBrowserSource.ensureBrowser();

      if (!this.sharedBrowserSource.browser) {
        throw new Error('共享 Chrome 启动失败。');
      }

      this.browser = this.sharedBrowserSource.browser;
      this.debugPort = this.sharedBrowserSource.debugPort;
      this.activeUserDataDirName = this.sharedBrowserSource.activeUserDataDirName;
      return;
    }

    if (this.browser || this.isLaunching) {
      while (this.isLaunching) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return;
    }

    this.isLaunching = true;

    try {
      const chromePath = await this.getChromeExecutablePath();

      if (!chromePath) {
        throw new Error('没有找到 Chrome/Edge，请安装 Chrome，或在 quickOps.browser.chromeExecutable 配置浏览器路径。');
      }

      this.debugPort = await this.findFreePort(Number(vscode.workspace.getConfiguration().get<number>('quickOps.browser.debugPort')) || 9222);

      const args = [
        `--remote-debugging-port=${this.debugPort}`,
        '--remote-allow-origins=*',
        '--allow-file-access-from-files',
        '--disable-features=TranslateUI',
        '--hide-scrollbars=false',
        '--ignore-certificate-errors',
        '--allow-insecure-localhost',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-background-networking',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-popup-blocking',
        '--disable-dev-shm-usage',
        '--disable-extensions',
        '--disable-sync',
        '--lang=zh-CN',
        '--mute-audio',
        '--metrics-recording-only',
        '--disable-component-update',
      ];

      if (platform() === 'linux') {
        args.push('--no-sandbox');
      }

      const launchBrowser = async (userDataDirName: string) => {
        return puppeteer.launch({
          executablePath: chromePath,
          headless: true,
          args,
          defaultViewport: this.lastViewport,
          userDataDir: path.join(this.context.globalStorageUri.fsPath, userDataDirName),
        });
      };

      try {
        this.browser = await launchBrowser(this.activeUserDataDirName);
      } catch (error) {
        if (!this.isUserDataDirLockedError(error)) {
          throw error;
        }

        const fallbackUserDataDirName = this.createUserDataDirName();

        console.warn(`[EmbeddedBrowserService] userDataDir is locked, retry with ${fallbackUserDataDirName}:`, error);

        this.activeUserDataDirName = fallbackUserDataDirName;
        this.browser = await launchBrowser(this.activeUserDataDirName);
      }

      const browser = this.browser;

      if (!browser) {
        throw new Error('Chrome 启动失败。');
      }

      const pages = await browser.pages();
      await Promise.allSettled(pages.map((item) => item.close()));
    } finally {
      this.isLaunching = false;
    }
  }

  private async installNavigationBridge(page: Page): Promise<void> {
    await page
      .exposeFunction('__quickOpsNotifyNavigation', async (url: string, title?: string) => {
        const nextUrl = String(url || '').trim();

        if (!nextUrl) return;

        this.emit('urlChanged', {
          url: nextUrl,
        });

        this.emit('titleChanged', {
          title: title || nextUrl,
        });
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);

        if (!/already registered|window\['__quickOpsNotifyNavigation'\]/i.test(message)) {
          console.warn('[EmbeddedBrowserService] expose navigation bridge failed:', error);
        }
      });
  }

  private async installClipboardBridge(page: Page): Promise<void> {
    await page
      .exposeFunction('__quickOpsWriteClipboard', async (text: string) => {
        const value = String(text || '');

        if (!value) return;

        await vscode.env.clipboard.writeText(value);
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);

        if (!/already registered|window\['__quickOpsWriteClipboard'\]/i.test(message)) {
          console.warn('[EmbeddedBrowserService] expose clipboard bridge failed:', error);
        }
      });

    await page
      .evaluateOnNewDocument(() => {
        const win = window as typeof window & {
          __quickOpsWriteClipboard?: (text: string) => Promise<void> | void;
          __quickOpsClipboardBridgeInstalled?: boolean;
        };

        if (win.__quickOpsClipboardBridgeInstalled) {
          return;
        }

        win.__quickOpsClipboardBridgeInstalled = true;

        const notifyClipboardText = (value: unknown) => {
          const text = String(value || '');

          if (!text) return;

          window.setTimeout(() => {
            const writeClipboard = win.__quickOpsWriteClipboard;

            if (typeof writeClipboard !== 'function') {
              return;
            }

            Promise.resolve(writeClipboard(text)).catch(() => {
              // noop
            });
          }, 0);
        };

        const getSelectedText = () => {
          const activeElement = document.activeElement as HTMLElement | null;
          const selectionText = window.getSelection()?.toString() || '';

          if (selectionText) {
            return selectionText;
          }

          if (!activeElement) {
            return '';
          }

          const tagName = activeElement.tagName.toLowerCase();

          if (tagName === 'input' || tagName === 'textarea') {
            const input = activeElement as HTMLInputElement | HTMLTextAreaElement;
            const value = typeof input.value === 'string' ? input.value : '';
            const start = typeof input.selectionStart === 'number' ? input.selectionStart : 0;
            const end = typeof input.selectionEnd === 'number' ? input.selectionEnd : 0;

            if (end > start) {
              return value.slice(start, end);
            }

            return value;
          }

          const editable = activeElement.closest('[contenteditable="true"], [contenteditable="plaintext-only"]') as HTMLElement | null;

          if (editable) {
            return editable.innerText || editable.textContent || '';
          }

          return '';
        };

        const patchNavigatorClipboard = () => {
          const originalClipboard = navigator.clipboard;
          const originalWriteText = originalClipboard?.writeText?.bind(originalClipboard);
          const originalReadText = originalClipboard?.readText?.bind(originalClipboard);
          const bridgeClipboard = originalClipboard || {};

          try {
            Object.defineProperty(bridgeClipboard, 'writeText', {
              configurable: true,
              value: async (text: string) => {
                notifyClipboardText(text);

                if (originalWriteText) {
                  try {
                    return await originalWriteText(text);
                  } catch {
                    return undefined;
                  }
                }

                return undefined;
              },
            });
          } catch {
            // noop
          }

          if (originalReadText) {
            try {
              Object.defineProperty(bridgeClipboard, 'readText', {
                configurable: true,
                value: async () => {
                  try {
                    return await originalReadText();
                  } catch {
                    return getSelectedText();
                  }
                },
              });
            } catch {
              // noop
            }
          }

          try {
            Object.defineProperty(navigator, 'clipboard', {
              configurable: true,
              get: () => bridgeClipboard,
            });
          } catch {
            // noop
          }
        };

        patchNavigatorClipboard();

        const rawExecCommand = document.execCommand?.bind(document);

        if (rawExecCommand) {
          document.execCommand = function (commandId: string, showUI?: boolean, value?: string) {
            const isCopy = String(commandId || '').toLowerCase() === 'copy';
            const beforeText = isCopy ? getSelectedText() : '';
            const result = rawExecCommand(commandId, showUI, value);

            if (isCopy) {
              notifyClipboardText(beforeText || getSelectedText());
            }

            return result;
          };
        }

        document.addEventListener(
          'copy',
          (event) => {
            const text = event.clipboardData?.getData('text/plain') || getSelectedText();

            if (text) {
              notifyClipboardText(text);
            }
          },
          true,
        );
      })
      .catch(() => undefined);
  }

  private async installNavigationPatch(page: Page): Promise<void> {
    await page
      .evaluateOnNewDocument(() => {
        const normalizeTarget = (target: EventTarget | null): HTMLAnchorElement | null => {
          let current = target as HTMLElement | null;

          while (current && current.tagName !== 'A') {
            current = current.parentElement;
          }

          return current as HTMLAnchorElement | null;
        };

        const forceSelfTarget = (root: ParentNode | Element | null) => {
          if (!root) return;

          const nodes = 'querySelectorAll' in root ? root.querySelectorAll('a[target="_blank"], a[target="_new"]') : [];

          for (const node of Array.from(nodes)) {
            node.setAttribute('target', '_self');
          }
        };

        const rawOpen = window.open;

        window.open = function (url?: string | URL, target?: string, features?: string) {
          if (url) {
            window.location.href = String(url);
            return null;
          }

          return rawOpen ? rawOpen.call(window, url, target, features) : null;
        };

        const notifyNavigation = () => {
          window.setTimeout(() => {
            const notify = (window as any).__quickOpsNotifyNavigation;

            if (typeof notify !== 'function') return;

            try {
              notify(window.location.href, document.title || window.location.href);
            } catch {
              // noop
            }
          }, 0);
        };

        const rawPushState = history.pushState;
        const rawReplaceState = history.replaceState;

        history.pushState = function (...args) {
          const result = rawPushState.apply(this, args as any);

          notifyNavigation();
          return result;
        };

        history.replaceState = function (...args) {
          const result = rawReplaceState.apply(this, args as any);

          notifyNavigation();
          return result;
        };

        window.addEventListener('popstate', notifyNavigation, true);
        window.addEventListener('hashchange', notifyNavigation, true);

        document.addEventListener(
          'click',
          (event) => {
            const anchor = normalizeTarget(event.target);

            if (!anchor) return;

            const target = (anchor.getAttribute('target') || '').toLowerCase();

            if (target === '_blank' || target === '_new') {
              anchor.setAttribute('target', '_self');
            }
          },
          true,
        );

        document.addEventListener('DOMContentLoaded', () => {
          forceSelfTarget(document);

          const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
              for (const node of Array.from(mutation.addedNodes)) {
                if (node.nodeType === 1) {
                  forceSelfTarget(node as Element);
                }
              }
            }
          });

          observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
          });
        });
      })
      .catch(() => undefined);
  }

  private async patchCurrentDocumentNavigation(page: Page): Promise<void> {
    await page
      .evaluate(() => {
        const nodes = document.querySelectorAll('a[target="_blank"], a[target="_new"]');

        for (const node of Array.from(nodes)) {
          node.setAttribute('target', '_self');
        }
      })
      .catch(() => undefined);
  }

  private async switchToPage(nextPage: Page): Promise<void> {
    const previousPage = this.page;

    this.isScreencastStarted = false;

    if (this.client) {
      await this.client.detach().catch(() => undefined);
      this.client = null;
    }

    this.page = nextPage;
    await this.page.setViewport(this.lastViewport).catch(() => undefined);
    await this.configurePageCompatibility(this.page);
    await this.hookPageEvents(this.page);
    await this.ensureClient();

    if (previousPage && previousPage !== nextPage) {
      await previousPage.close().catch(() => undefined);
    }

    this.emit('urlChanged', {
      url: this.page.url(),
    });

    this.emit('titleChanged', {
      title: await this.page.title().catch(() => this.page?.url() || ''),
    });
  }

  private async hookPageEvents(page: Page): Promise<void> {
    if (this.hookedPages.has(page)) return;

    this.hookedPages.add(page);

    await this.installNavigationBridge(page);
    await this.installClipboardBridge(page);
    await this.installNavigationPatch(page);

    page.on('load', async () => {
      await this.patchCurrentDocumentNavigation(page);
      this.schedulePersistSharedCookies(800);

      this.emit('pageLoaded', await this.getPageMetadata(page));
    });

    page.on('domcontentloaded', async () => {
      await this.patchCurrentDocumentNavigation(page);
      this.schedulePersistSharedCookies(1200);

      this.emit('pageLoaded', await this.getPageMetadata(page));
    });

    page.on('framenavigated', async (frame) => {
      if (frame !== page.mainFrame()) return;

      await this.patchCurrentDocumentNavigation(page);
      this.schedulePersistSharedCookies(1200);

      this.emit('urlChanged', {
        url: page.url(),
      });

      this.emit('titleChanged', {
        title: await page.title().catch(() => page.url()),
      });
    });

    page.on('popup', async (popup: Page | null) => {
      if (!popup) return;

      await this.switchToPage(popup);
    });

    page.on('pageerror', (error: unknown) => {
      // 页面运行时 JS 错误不能当成页面加载失败。
      // Browse Lite 的处理方式是把浏览器 CDP 事件转给前端 DevTools，而不是因为网页内部脚本异常就中断预览。
      // 例如新浪页面会抛出 `weiboPhoto is not defined`，真实 Chrome 里只是控制台错误，页面仍然可以继续显示。
      console.warn('[EmbeddedBrowserService] page runtime error:', error);
    });

    page.on('dialog', async (dialog) => {
      const type = dialog.type();
      const message = dialog.message();

      if (type === 'alert') {
        await vscode.window.showInformationMessage(message);
        await dialog.accept().catch(() => undefined);
        return;
      }

      if (type === 'confirm') {
        const result = await vscode.window.showQuickPick(['确定', '取消'], { placeHolder: message });
        await (result === '确定' ? dialog.accept() : dialog.dismiss()).catch(() => undefined);
        return;
      }

      if (type === 'prompt') {
        const result = await vscode.window.showInputBox({ prompt: message });
        await dialog.accept(result || '').catch(() => undefined);
        return;
      }

      await dialog.dismiss().catch(() => undefined);
    });
  }

  private async startScreencast(): Promise<void> {
    if (!this.client || this.isScreencastStarted) return;

    this.isScreencastStarted = true;

    if (this.screencastFrameHandler) {
      this.client.off('Page.screencastFrame', this.screencastFrameHandler as any);
      this.screencastFrameHandler = null;
    }

    this.screencastFrameHandler = async (event: any) => {
      const currentClient = this.client;

      /**
       * 先 ACK 再处理帧，避免 Chrome 因为等待 ACK 堆积后续帧。
       * Browse Lite 也是基于 CDP screencast + ack 的流式刷新思路。
       */
      await currentClient
        ?.send('Page.screencastFrameAck', {
          sessionId: event.sessionId,
        })
        .catch(() => undefined);

      const payload: BrowserFramePayload = {
        data: event.data,
        width: event.metadata?.deviceWidth || this.lastViewport.width,
        height: event.metadata?.deviceHeight || this.lastViewport.height,
        format: this.getScreencastFormat(),
      };

      const isFirstFrame = !this.lastFramePayload;

      this.lastFramePayload = payload;

      if (isFirstFrame) {
        this.pendingFramePayload = null;
        this.lastFrameEmitAt = Date.now();
        this.emit('frame', payload);
        return;
      }

      this.scheduleFrameEmit(payload);
    };

    this.client.on('Page.screencastFrame', this.screencastFrameHandler as any);

    const format = this.getScreencastFormat();

    /**
     * 对齐 vscode-browse-lite 的清晰度策略：
     * - 默认 png
     * - quality 100
     * - everyNthFrame 1
     * - 不传 maxWidth / maxHeight，避免 Chrome 把高 DPR 截图再次压缩缩放
     *
     * 真实清晰度主要由 setViewport / Emulation.setDeviceMetricsOverride 的
     * deviceScaleFactor 决定，前端按 window.devicePixelRatio 传入。
     */
    const startParams: Record<string, unknown> = {
      quality: format === 'jpeg' ? this.getScreencastQuality() : 100,
      format,
      everyNthFrame: this.getScreencastEveryNthFrame(),
    };

    await this.client.send('Page.startScreencast', startParams as any);
  }

  private scheduleFrameEmit(payload: BrowserFramePayload): void {
    this.pendingFramePayload = payload;

    const now = Date.now();
    const elapsed = now - this.lastFrameEmitAt;

    if (elapsed >= this.frameEmitInterval) {
      this.flushPendingFrame();
      return;
    }

    if (this.frameFlushTimer) return;

    this.frameFlushTimer = setTimeout(() => {
      this.frameFlushTimer = null;
      this.flushPendingFrame();
    }, this.frameEmitInterval - elapsed);
  }

  private flushPendingFrame(): void {
    if (!this.pendingFramePayload) return;

    const payload = this.pendingFramePayload;

    this.pendingFramePayload = null;
    this.lastFrameEmitAt = Date.now();

    this.emit('frame', payload);
  }

  private async disposePage(): Promise<void> {
    this.abortCurrentNavigation();
    this.isScreencastStarted = false;
    this.pendingFramePayload = null;

    if (this.frameFlushTimer) {
      clearTimeout(this.frameFlushTimer);
      this.frameFlushTimer = null;
    }

    if (this.client) {
      await this.client.send('Page.stopLoading').catch(() => undefined);
      await this.client.send('Page.stopScreencast').catch(() => undefined);

      if (this.screencastFrameHandler) {
        this.client.off('Page.screencastFrame', this.screencastFrameHandler as any);
        this.screencastFrameHandler = null;
      }

      await this.client.detach().catch(() => undefined);
      this.client = null;
    }

    if (this.page) {
      await this.page.close().catch(() => undefined);
      this.page = null;
    }

    this.lastFramePayload = null;
  }

  private async findFreePort(startPort: number): Promise<number> {
    const net = await import('net');

    const isFree = (port: number) => {
      return new Promise<boolean>((resolve) => {
        const server = net.createServer();

        server.once('error', () => resolve(false));
        server.once('listening', () => {
          server.close(() => resolve(true));
        });
        server.listen(port, '127.0.0.1');
      });
    };

    let port = startPort;

    while (!(await isFree(port))) {
      port += 1;
    }

    return port;
  }

  private async getChromeExecutablePath(): Promise<string | undefined> {
    const configured =
      vscode.workspace.getConfiguration().get<string>('quickOps.browser.chromeExecutable') || vscode.workspace.getConfiguration().get<string>('browse-lite.chromeExecutable') || '';

    if (configured && (await this.pathExists(configured))) {
      return configured;
    }

    const candidates = this.getPlatformChromeCandidates();

    for (const candidate of candidates) {
      if (await this.pathExists(candidate)) {
        return candidate;
      }
    }

    return undefined;
  }

  private async pathExists(fsPath: string): Promise<boolean> {
    if (!fsPath) return false;

    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(fsPath));
      return true;
    } catch {
      return false;
    }
  }

  private getPlatformChromeCandidates(): string[] {
    if (process.platform === 'darwin') {
      const homeDir = homedir();

      return [
        // 系统应用目录
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',

        // 当前用户应用目录
        path.join(homeDir, 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
        path.join(homeDir, 'Applications/Chromium.app/Contents/MacOS/Chromium'),
        path.join(homeDir, 'Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'),

        // 兼容浏览器临时放在桌面的情况
        path.join(homeDir, 'Desktop/Google Chrome.app/Contents/MacOS/Google Chrome'),
        path.join(homeDir, 'Desktop/Chromium.app/Contents/MacOS/Chromium'),
        path.join(homeDir, 'Desktop/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'),
      ];
    }

    if (process.platform === 'win32') {
      const localAppData = process.env.LOCALAPPDATA || '';
      const programFiles = process.env.PROGRAMFILES || 'C:\\Program Files';
      const programFilesX86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';

      return [
        path.join(programFiles, 'Google/Chrome/Application/chrome.exe'),
        path.join(programFilesX86, 'Google/Chrome/Application/chrome.exe'),
        path.join(localAppData, 'Google/Chrome/Application/chrome.exe'),
        path.join(programFiles, 'Microsoft/Edge/Application/msedge.exe'),
        path.join(programFilesX86, 'Microsoft/Edge/Application/msedge.exe'),
      ];
    }

    return ['/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium', '/snap/bin/chromium'];
  }

  private getCurrentOrigin(): string {
    try {
      const url = this.page?.url() || '';
      return new URL(url).origin;
    } catch {
      return '*';
    }
  }

  private getPageId(): string {
    try {
      const target = this.page?.target() as any;
      return target?._targetId || target?._targetInfo?.targetId || '';
    } catch {
      return '';
    }
  }
}
