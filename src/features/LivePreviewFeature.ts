import * as vscode from 'vscode';
import puppeteer, { Browser, Page, CDPSession } from 'puppeteer-core';
import * as fs from 'fs';
// @ts-ignore
import * as chrome from 'karma-chrome-launcher';
import * as edge from '@chiragrupani/karma-chromium-edge-launcher';

import { IFeature } from '../core/interfaces/IFeature';
import ColorLog from '../utils/ColorLog';
import { getReactWebviewHtml } from '../utils/WebviewHelper';

export class LivePreviewFeature implements IFeature {
  public readonly id = 'LivePreviewFeature';
  private panel: vscode.WebviewPanel | undefined;

  private browser: Browser | undefined;
  private page: Page | undefined;
  private cdpSession: CDPSession | undefined;

  public activate(context: vscode.ExtensionContext): void {
    const command = vscode.commands.registerCommand('quick-ops.openLivePreview', () => {
      void this.showPreviewPanel(context);
    });

    context.subscriptions.push(command);
    ColorLog.black(`[${this.id}]`, 'Activated.');
  }

  private getChromiumPath(): string | undefined {
    const knownChromiums = [...Object.entries(chrome), ...Object.entries(edge)];
    for (const [key, info] of knownChromiums) {
      if (!key.startsWith('launcher')) continue;
      const cmdPath = (info as any)?.[1]?.prototype?.DEFAULT_CMD?.[process.platform];
      if (cmdPath && typeof cmdPath === 'string' && fs.existsSync(cmdPath)) return cmdPath;
    }
    return undefined;
  }

  private async showPreviewPanel(context: vscode.ExtensionContext) {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'quickOpsLivePreview',
      '网页预览 (Screencast)',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        enableFindWidget: true,
        localResourceRoots: [context.extensionUri]
      }
    );

    this.panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'icon.png');

    this.panel.onDidDispose(() => {
      this.panel = undefined;
      void this.cleanupPuppeteer();
    });

    const lastUrl = context.workspaceState.get<string>('quickOps.lastPreviewUrl') || '';
    const lastDevice = context.workspaceState.get<string>('quickOps.lastPreviewDevice') || 'device-responsive';

    this.panel.webview.html = getReactWebviewHtml(context.extensionUri, this.panel.webview, '/preview');

    this.panel.webview.onDidReceiveMessage(async (message) => {
      if (message.type === 'ready') {
        this.panel?.webview.postMessage({ type: 'init', device: lastDevice, url: lastUrl });
      } else if (message.type === 'saveUrl') {
        await context.workspaceState.update('quickOps.lastPreviewUrl', message.url);
      } else if (message.type === 'saveDevice') {
        await context.workspaceState.update('quickOps.lastPreviewDevice', message.device);
      } else if (message.type === 'searchWorkspace') {
        await vscode.commands.executeCommand('workbench.action.findInFiles', { query: message.query });
      } else if (message.type === 'reqSyncFavorites') {
        const favs = context.globalState.get<any[]>('quickOps.globalFavorites') || [];
        this.panel?.webview.postMessage({ type: 'syncFavorites', favorites: favs });
      } else if (message.type === 'saveAllFavorites') {
        await context.globalState.update('quickOps.globalFavorites', message.favorites);
        this.panel?.webview.postMessage({ type: 'syncFavorites', favorites: message.favorites });
      } else if (message.type === 'toggleFavorite') {
        let favs = context.globalState.get<any[]>('quickOps.globalFavorites') || [];
        const index = favs.findIndex((f) => f.url === message.url);
        if (index > -1) {
          favs.splice(index, 1);
          void vscode.window.showInformationMessage('已取消收藏');
        } else {
          favs.push({ url: message.url, title: message.title, timestamp: Date.now() });
          void vscode.window.showInformationMessage('⭐️ 已添加到全局收藏夹');
        }
        await context.globalState.update('quickOps.globalFavorites', favs);
        this.panel?.webview.postMessage({ type: 'syncFavorites', favorites: favs });
      } else if (message.type === 'openExternalBrowser') {
        await vscode.env.openExternal(vscode.Uri.parse(message.url));
      } else if (message.type === 'showInfo') {
        void vscode.window.showInformationMessage(message.message);
      } else if (message.type === 'showError') {
        void vscode.window.showErrorMessage(message.message);
      } else if (message.type === 'navigateScreencast') {
        if (this.page) {
          try {
            await this.page.goto(message.url, { waitUntil: 'domcontentloaded' });
          } catch (e) {
            console.error('Screencast Navigation failed', e);
          }
        }
      } else if (message.type === 'changeViewport') {
        if (this.page && message.width > 0 && message.height > 0) {
          await this.page.setViewport({
            width: Math.round(message.width),
            height: Math.round(message.height),
            deviceScaleFactor: 1
          });
        }
      } else if (message.type === 'mouseMove') {
        await this.page?.mouse.move(message.x, message.y);
      } else if (message.type === 'mouseClick') {
        await this.page?.mouse.click(message.x, message.y, { button: 'left', clickCount: 1 });
      } else if (message.type === 'mouseScroll') {
        await this.page?.mouse.wheel({ deltaY: message.deltaY });
      } else if (message.type === 'keyboardType') {
        if (!this.page) return;
        if (message.key === 'Enter') await this.page.keyboard.press('Enter');
        else if (message.key === 'Backspace') await this.page.keyboard.press('Backspace');
        else if (message.key === 'Tab') await this.page.keyboard.press('Tab');
        else if (message.key === 'Escape') await this.page.keyboard.press('Escape');
        else if (message.key.length === 1) await this.page.keyboard.type(message.key);
      }
    });

    await this.startPuppeteerEngine();

    setTimeout(() => {
      this.panel?.webview.postMessage({ type: 'init', device: lastDevice, url: lastUrl });
    }, 200);
  }

  private bindPageEvents() {
    if (!this.page) return;

    this.page.on('framenavigated', async (frame) => {
      if (!this.page || frame !== this.page.mainFrame()) return;

      const url = frame.url();
      let title = url;

      try {
        const pageTitle = await this.page.title();
        if (pageTitle?.trim()) title = pageTitle.trim();
      } catch { }

      this.panel?.webview.postMessage({
        type: 'pageNavigated',
        url,
        title
      });
    });

    this.page.on('popup', async (popup) => {
      if (!popup) return;

      try {
        let popupUrl = popup.url();

        if (!popupUrl || popupUrl === 'about:blank') {
          try {
            await popup.waitForNavigation({
              waitUntil: 'domcontentloaded',
              timeout: 5000
            });
            popupUrl = popup.url();
          } catch { }
        }

        if (popupUrl && popupUrl !== 'about:blank' && this.page) {
          await this.page.goto(popupUrl, { waitUntil: 'domcontentloaded' });
        }
      } catch (e) {
        console.error('Popup redirect failed', e);
      } finally {
        try {
          await popup.close();
        } catch { }
      }
    });
  }

  private async startPuppeteerEngine() {
    const executablePath = this.getChromiumPath();
    if (!executablePath) {
      void vscode.window.showErrorMessage('❌ 未检测到 Chrome/Edge 浏览器，推流引擎启动失败！');
      return;
    }

    this.browser = await puppeteer.launch({
      executablePath,
      headless: true,
      defaultViewport: { width: 1200, height: 800, deviceScaleFactor: 1 },
      args: ['--disable-gpu']
    });

    this.page = await this.browser.newPage();
    await this.page.setViewport({ width: 1200, height: 800, deviceScaleFactor: 1 });

    this.bindPageEvents();

    this.cdpSession = await this.page.target().createCDPSession();

    this.cdpSession.on('Page.screencastFrame', async (frameObject) => {
      if (this.panel) {
        this.panel.webview.postMessage({
          type: 'renderFrame',
          base64Data: frameObject.data,
          format: 'png'
        });
      }

      try {
        await this.cdpSession?.send('Page.screencastFrameAck', { sessionId: frameObject.sessionId });
      } catch { }
    });

    await this.cdpSession.send('Page.startScreencast', {
      format: 'png',
      everyNthFrame: 1
    });
  }

  private async cleanupPuppeteer() {
    if (this.browser) {
      await this.browser.close();
      this.browser = undefined;
      this.page = undefined;
      this.cdpSession = undefined;
    }
  }
}