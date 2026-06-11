import { EventEmitter } from 'events';
import { platform } from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import type { Browser, CDPSession, Page } from 'puppeteer-core';
import puppeteer from 'puppeteer-core';

interface BrowserFramePayload {
  data: string;
  width: number;
  height: number;
}

interface BrowserSnapshot {
  url: string;
  title: string;
  frame: BrowserFramePayload | null;
  hasPage: boolean;
}

type BrowserMouseEventType = 'mouseMoved' | 'mousePressed' | 'mouseReleased' | 'mouseWheel';
type BrowserKeyboardEventType = 'keyDown' | 'keyUp';

interface BrowserInputMessage {
  inputType: 'mouse' | 'wheel' | 'keyboard';
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

export class EmbeddedBrowserService extends EventEmitter {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private client: CDPSession | null = null;
  private isLaunching = false;
  private isScreencastStarted = false;
  private navigationAbortController: AbortController | null = null;
  private lastFramePayload: BrowserFramePayload | null = null;
  private readonly hookedPages = new WeakSet<Page>();
  private debugPort = 9222;
  private lastViewport = {
    width: 1280,
    height: 720,
    deviceScaleFactor: 2,
  };

  constructor(private readonly context: vscode.ExtensionContext) {
    super();
  }

  public async getSnapshot(): Promise<BrowserSnapshot> {
    if (!this.page) {
      return {
        url: '',
        title: '',
        frame: this.lastFramePayload,
        hasPage: false,
      };
    }

    return {
      url: this.page.url(),
      title: await this.page.title().catch(() => this.page?.url() || ''),
      frame: this.lastFramePayload,
      hasPage: true,
    };
  }

  public async navigate(url: string): Promise<void> {
    const page = await this.ensurePage();
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
    }
  }

  public async reload(url?: string): Promise<void> {
    const page = await this.ensurePage();

    if (url && page.url() !== url) {
      await this.navigate(url);
      return;
    }

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

    const text = await page.evaluate(() => {
      const activeElement = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;

      if (
        activeElement &&
        typeof activeElement.selectionStart === 'number' &&
        typeof activeElement.selectionEnd === 'number' &&
        typeof activeElement.value === 'string'
      ) {
        const start = activeElement.selectionStart || 0;
        const end = activeElement.selectionEnd || 0;

        if (end > start) {
          return activeElement.value.slice(start, end);
        }
      }

      return window.getSelection()?.toString() || '';
    }).catch(() => '');

    if (!text) return;

    await vscode.env.clipboard.writeText(text);
  }

  public async selectTextRange(startX: number, startY: number, endX: number, endY: number): Promise<void> {
    const page = await this.ensurePage();

    await page.evaluate((payload) => {
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

        if (
          range.collapsed &&
          (startRange.startContainer !== endRange.startContainer || startRange.startOffset !== endRange.startOffset)
        ) {
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
    }, {
      startX,
      startY,
      endX,
      endY,
    }).catch(() => undefined);
  }

  public async clearCache(): Promise<void> {
    const client = await this.ensureClient();

    await Promise.allSettled([
      client.send('Network.clearBrowserCookies'),
      client.send('Network.clearBrowserCache'),
      client.send('Storage.clearDataForOrigin', {
        origin: this.getCurrentOrigin(),
        storageTypes: 'all',
      }),
    ]);
  }

  public async openDevTools(): Promise<void> {
    const client = await this.ensureClient();
    const port = this.debugPort;
    const pageId = this.getPageId();

    if (!pageId) {
      await vscode.commands.executeCommand('workbench.action.webview.openDeveloperTools');
      return;
    }

    await vscode.env.openExternal(vscode.Uri.parse(`http://127.0.0.1:${port}/devtools/inspector.html?ws=127.0.0.1:${port}/devtools/page/${pageId}`));
    void client;
  }

  public async setViewport(message: BrowserViewportMessage): Promise<void> {
    const width = Math.max(320, Math.floor(Number(message.width) || 1280));
    const height = Math.max(240, Math.floor(Number(message.height) || 720));
    const deviceScaleFactor = Math.min(3, Math.max(1, Number(message.deviceScaleFactor) || 2));

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
      await this.client.send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor,
        mobile: false,
      }).catch(() => undefined);

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
          button: eventType === 'mouseMoved' ? 'none' : message.button || 'left',
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

      if (message.inputType === 'keyboard') {
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
    await this.disposePage();

    if (this.browser) {
      await this.browser.close().catch(() => undefined);
      this.browser = null;
    }

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
    if (
      eventType === 'mouseMoved' ||
      eventType === 'mousePressed' ||
      eventType === 'mouseReleased' ||
      eventType === 'mouseWheel'
    ) {
      return eventType;
    }

    return 'mouseMoved';
  }

  private async restartScreencast(): Promise<void> {
    if (!this.client || !this.isScreencastStarted) return;

    await this.client.send('Page.stopScreencast').catch(() => undefined);
    this.isScreencastStarted = false;
    await this.startScreencast();
  }

  private async dispatchKeyboardInput(message: BrowserInputMessage): Promise<void> {
    const client = await this.ensureClient();
    const key = message.key || '';
    const type = message.eventType === 'keyUp' ? 'keyUp' : 'keyDown';
    const modifiers = this.getKeyboardModifiers(message);

    if (type === 'keyDown' && key.length === 1 && !message.ctrlKey && !message.metaKey && !message.altKey) {
      await client.send('Input.insertText', { text: key });
      return;
    }

    await client.send('Input.dispatchKeyEvent', {
      type,
      key,
      code: message.code || key,
      text: type === 'keyDown' && key.length === 1 ? key : undefined,
      windowsVirtualKeyCode: this.getVirtualKeyCode(key),
      nativeVirtualKeyCode: this.getVirtualKeyCode(key),
      modifiers,
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

    this.client = await page.target().createCDPSession();
    await this.client.send('Page.enable');
    await this.client.send('Runtime.enable');
    await this.client.send('Network.enable');
    await this.startScreencast();

    return this.client;
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
    await this.hookPageEvents(this.page);

    return this.page;
  }

  private async ensureBrowser(): Promise<void> {
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
      ];

      if (platform() === 'linux') {
        args.push('--no-sandbox');
      }

      this.browser = await puppeteer.launch({
        executablePath: chromePath,
        headless: true,
        args,
        defaultViewport: this.lastViewport,
        userDataDir: path.join(this.context.globalStorageUri.fsPath, 'BrowserUserData'),
      });

      const pages = await this.browser.pages();
      await Promise.allSettled(pages.map((item) => item.close()));
    } finally {
      this.isLaunching = false;
    }
  }

  private async installNavigationPatch(page: Page): Promise<void> {
    await page.evaluateOnNewDocument(() => {
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
        true
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
    }).catch(() => undefined);
  }

  private async patchCurrentDocumentNavigation(page: Page): Promise<void> {
    await page.evaluate(() => {
      const nodes = document.querySelectorAll('a[target="_blank"], a[target="_new"]');

      for (const node of Array.from(nodes)) {
        node.setAttribute('target', '_self');
      }
    }).catch(() => undefined);
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

    await this.installNavigationPatch(page);

    page.on('load', async () => {
      await this.patchCurrentDocumentNavigation(page);

      this.emit('pageLoaded', {
        url: page.url(),
        title: await page.title().catch(() => page.url()),
      });
    });

    page.on('domcontentloaded', async () => {
      await this.patchCurrentDocumentNavigation(page);

      this.emit('pageLoaded', {
        url: page.url(),
        title: await page.title().catch(() => page.url()),
      });
    });

    page.on('framenavigated', async (frame) => {
      if (frame !== page.mainFrame()) return;

      await this.patchCurrentDocumentNavigation(page);

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

    this.client.on('Page.screencastFrame', async (event: any) => {
      const payload: BrowserFramePayload = {
        data: event.data,
        width: event.metadata?.deviceWidth || this.lastViewport.width,
        height: event.metadata?.deviceHeight || this.lastViewport.height,
      };

      this.lastFramePayload = payload;

      this.emit('frame', payload);

      await this.client?.send('Page.screencastFrameAck', {
        sessionId: event.sessionId,
      }).catch(() => undefined);
    });

    await this.client.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 100,
      maxWidth: Math.ceil(this.lastViewport.width * this.lastViewport.deviceScaleFactor),
      maxHeight: Math.ceil(this.lastViewport.height * this.lastViewport.deviceScaleFactor),
      everyNthFrame: 1,
    });
  }

  private async disposePage(): Promise<void> {
    this.abortCurrentNavigation();
    this.isScreencastStarted = false;

    if (this.client) {
      await this.client.send('Page.stopLoading').catch(() => undefined);
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
      vscode.workspace.getConfiguration().get<string>('quickOps.browser.chromeExecutable') ||
      vscode.workspace.getConfiguration().get<string>('browse-lite.chromeExecutable') ||
      '';

    if (configured && await this.pathExists(configured)) {
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
      return [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
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

    return [
      '/usr/bin/google-chrome-stable',
      '/usr/bin/google-chrome',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
      '/snap/bin/chromium',
    ];
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
