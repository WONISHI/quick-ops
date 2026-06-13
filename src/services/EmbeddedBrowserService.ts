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

export class EmbeddedBrowserService extends EventEmitter {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private client: CDPSession | null = null;
  private isLaunching = false;
  private isScreencastStarted = false;
  private navigationAbortController: AbortController | null = null;
  private lastFramePayload: BrowserFramePayload | null = null;
  private pendingFramePayload: BrowserFramePayload | null = null;
  private frameFlushTimer: NodeJS.Timeout | null = null;
  private lastFrameEmitAt = 0;
  private readonly frameEmitInterval = platform() === 'darwin' ? 90 : 66;
  private screencastFrameHandler: ((event: any) => Promise<void>) | null = null;
  private readonly hookedPages = new WeakSet<Page>();
  private debugPort = 9222;
  private activeUserDataDirName = this.userDataDirName;
  private imeCompositionText = '';
  private lastViewport = {
    width: 1280,
    height: 720,
    deviceScaleFactor: 1,
  };

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly userDataDirName = `BrowserUserData-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  ) {
    super();
    this.activeUserDataDirName = userDataDirName;
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
    }).catch(() => '');

    const normalizedText = String(text || '');

    if (!normalizedText) return;

    await vscode.env.clipboard.writeText(normalizedText);
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

    return page.evaluate((payload) => {
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
      const previousActiveIndex =
        previousState?.keyword === payload.keyword && Number.isFinite(previousState.activeIndex)
          ? previousState.activeIndex
          : -1;

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
        activeIndex =
          payload.direction === 'previous'
            ? (previousActiveIndex - 1 + total) % total
            : (previousActiveIndex + 1) % total;
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
    }, {
      keyword: normalizedKeyword,
      direction,
    }).catch((error) => {
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

    await this.page.evaluate(() => {
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
    const rawDeviceScaleFactor = Number(message.deviceScaleFactor) || 1;
    const maxDeviceScaleFactor = platform() === 'darwin' ? 1.1 : 1.35;
    const deviceScaleFactor = Math.min(maxDeviceScaleFactor, Math.max(1, rawDeviceScaleFactor));

    if (
      this.lastViewport.width === width &&
      this.lastViewport.height === height &&
      this.lastViewport.deviceScaleFactor === deviceScaleFactor
    ) {
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

    await (client as any).send('Input.imeSetComposition', {
      text: nextText,
      selectionStart: nextText.length,
      selectionEnd: nextText.length,
    }).catch((error: unknown) => {
      if (!this.isTargetClosedError(error)) {
        console.warn('[EmbeddedBrowserService] ime composition update failed:', error);
      }
    });
  }

  private async commitImeComposition(text: string): Promise<void> {
    const client = await this.ensureClient();
    const nextText = String(text || '');

    if (this.imeCompositionText) {
      await (client as any).send('Input.imeSetComposition', {
        text: '',
        selectionStart: 0,
        selectionEnd: 0,
      }).catch((error: unknown) => {
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

    await (client as any).send('Input.imeSetComposition', {
      text: '',
      selectionStart: 0,
      selectionEnd: 0,
    }).catch((error: unknown) => {
      if (!this.isTargetClosedError(error)) {
        console.warn('[EmbeddedBrowserService] ime composition cancel failed:', error);
      }
    });

    this.imeCompositionText = '';
  }

  private async dispatchKeyboardInput(message: BrowserInputMessage): Promise<void> {
    const client = await this.ensureClient();
    const key = message.key || '';
    const eventType = message.eventType === 'keyUp' ? 'keyUp' : 'keyDown';
    const modifiers = this.getKeyboardModifiers(message);

    if (key === 'Process' || key === 'Unidentified' || key === 'Dead') {
      return;
    }

    if (key === 'Enter' && eventType === 'keyDown' && (await this.shouldInsertLineBreak(message))) {
      this.imeCompositionText = '';
      await client.send('Input.insertText', { text: '\n' });
      return;
    }

    if (eventType === 'keyDown' && key.length === 1 && !message.ctrlKey && !message.metaKey && !message.altKey) {
      await client.send('Input.insertText', { text: key });
      return;
    }

    const virtualKeyCode = this.getVirtualKeyCode(key);
    const dispatchType = eventType === 'keyUp' ? 'keyUp' : 'rawKeyDown';
    const enterText = key === 'Enter' && eventType === 'keyDown' ? '\r' : undefined;

    await client.send('Input.dispatchKeyEvent', {
      type: dispatchType,
      key,
      code: message.code || key,
      text: enterText,
      unmodifiedText: enterText,
      windowsVirtualKeyCode: virtualKeyCode,
      nativeVirtualKeyCode: virtualKeyCode,
      modifiers,
    });
  }

  private async shouldInsertLineBreak(message: BrowserInputMessage): Promise<boolean> {
    if (message.key !== 'Enter') return false;

    const page = await this.ensurePage();

    return page.evaluate((payload) => {
      const activeElement = document.activeElement as HTMLElement | null;

      if (!activeElement) return false;

      const tagName = activeElement.tagName.toLowerCase();
      const isTextarea = tagName === 'textarea';
      const isContentEditable = activeElement.isContentEditable || !!activeElement.closest('[contenteditable="true"], [contenteditable="plaintext-only"]');
      const isAriaMultiline = activeElement.getAttribute('aria-multiline') === 'true';
      const isInput = tagName === 'input';

      if (isTextarea || isContentEditable || isAriaMultiline) {
        return true;
      }

      if (!isInput) return false;

      const input = activeElement as HTMLInputElement;
      const inputType = String(input.type || 'text').toLowerCase();
      const textLikeTypes = new Set(['text', 'search', 'url', 'email', 'tel', 'password', 'number']);

      if (!textLikeTypes.has(inputType)) return false;

      /**
       * input 本身是单行控件，普通 Enter 应该保留站点原生行为，比如百度搜索。
       * 带换行快捷键时也不强行插入换行，避免单行搜索框出现不可见换行。
       */
      return false;
    }, {
      shiftKey: !!message.shiftKey,
      ctrlKey: !!message.ctrlKey,
      altKey: !!message.altKey,
      metaKey: !!message.metaKey,
    }).catch(() => false);
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

  private createUserDataDirName(): string {
    return `BrowserUserData-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  private isUserDataDirLockedError(error: unknown): boolean {
    if (!error) return false;

    const message = error instanceof Error ? error.message : String(error);

    return /browser is already running|userdatadir|user data dir|process_singleton|profile.*in use|正在运行/i.test(message);
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
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-background-networking',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-popup-blocking',
        '--disable-dev-shm-usage',
        '--disable-extensions',
        '--disable-sync',
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

        console.warn(
          `[EmbeddedBrowserService] userDataDir is locked, retry with ${fallbackUserDataDirName}:`,
          error
        );

        this.activeUserDataDirName = fallbackUserDataDirName;
        this.browser = await launchBrowser(this.activeUserDataDirName);
      }

      const pages = await this.browser.pages();
      await Promise.allSettled(pages.map((item) => item.close()));
    } finally {
      this.isLaunching = false;
    }
  }

  private async installNavigationBridge(page: Page): Promise<void> {
    await page.exposeFunction('__quickOpsNotifyNavigation', async (url: string, title?: string) => {
      const nextUrl = String(url || '').trim();

      if (!nextUrl) return;

      this.emit('urlChanged', {
        url: nextUrl,
      });

      this.emit('titleChanged', {
        title: title || nextUrl,
      });
    }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);

      if (!/already registered|window\['__quickOpsNotifyNavigation'\]/i.test(message)) {
        console.warn('[EmbeddedBrowserService] expose navigation bridge failed:', error);
      }
    });
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

    await this.installNavigationBridge(page);
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
      await currentClient?.send('Page.screencastFrameAck', {
        sessionId: event.sessionId,
      }).catch(() => undefined);

      const payload: BrowserFramePayload = {
        data: event.data,
        width: event.metadata?.deviceWidth || this.lastViewport.width,
        height: event.metadata?.deviceHeight || this.lastViewport.height,
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

    const isMac = platform() === 'darwin';
    const scale = isMac ? 1 : Math.min(1.25, Math.max(1, this.lastViewport.deviceScaleFactor || 1));

    await this.client.send('Page.startScreencast', {
      format: 'jpeg',
      quality: isMac ? 58 : 68,
      maxWidth: Math.ceil(this.lastViewport.width * scale),
      maxHeight: Math.ceil(this.lastViewport.height * scale),
      everyNthFrame: isMac ? 2 : 1,
    });
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
