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
  
  // 🌟 修复：直接使用解构出来的类型，不再使用 puppeteer.XXX
  private browser: Browser | undefined;
  private page: Page | undefined;
  private cdpSession: CDPSession | undefined;

  public activate(context: vscode.ExtensionContext): void {
    const command = vscode.commands.registerCommand('quick-ops.openLivePreview', () => {
      this.showPreviewPanel(context);
    });

    context.subscriptions.push(command);
    ColorLog.black(`[${this.id}]`, 'Activated.');
  }

  private getChromiumPath(): string | undefined {
    const knownChromiums = [...Object.entries(chrome), ...Object.entries(edge)];
    for (const [key, info] of knownChromiums) {
      if (!key.startsWith('launcher')) continue;
      const path = (info as any)?.[1]?.prototype?.DEFAULT_CMD?.[process.platform];
      if (path && typeof path === 'string' && fs.existsSync(path)) return path;
    }
    return undefined;
  }

  private async showPreviewPanel(context: vscode.ExtensionContext) {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
      return;
    }

    this.panel = vscode.window.createWebviewPanel('quickOpsLivePreview', '网页预览 (Screencast)', vscode.ViewColumn.Beside, {
      enableScripts: true,
      retainContextWhenHidden: true,
      enableFindWidget: true,
      localResourceRoots: [context.extensionUri]
    });

    this.panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'icon.png');

    this.panel.onDidDispose(() => {
      this.panel = undefined;
      this.cleanupPuppeteer();
    });

    const lastUrl = context.workspaceState.get<string>('quickOps.lastPreviewUrl') || '';
    const lastDevice = context.workspaceState.get<string>('quickOps.lastPreviewDevice') || 'device-responsive';

    this.panel.webview.html = getReactWebviewHtml(context.extensionUri, this.panel.webview, '/preview');

    setTimeout(() => {
      this.panel?.webview.postMessage({ type: 'init', device: lastDevice, url: lastUrl });
    }, 500);

    // 启动后台引擎
    await this.startPuppeteerEngine();

    this.panel.webview.onDidReceiveMessage(async (message) => {
      if (message.type === 'ready') {
        this.panel?.webview.postMessage({ type: 'init', device: lastDevice, url: lastUrl });
      }
      else if (message.type === 'saveUrl') {
        await context.workspaceState.update('quickOps.lastPreviewUrl', message.url);
      } 
      else if (message.type === 'saveDevice') {
        await context.workspaceState.update('quickOps.lastPreviewDevice', message.device);
      } 
      else if (message.type === 'searchWorkspace') {
        vscode.commands.executeCommand('workbench.action.findInFiles', { query: message.query });
      }
      else if (message.type === 'reqSyncFavorites') {
        const favs = context.globalState.get<any[]>('quickOps.globalFavorites') || [];
        this.panel?.webview.postMessage({ type: 'syncFavorites', favorites: favs });
      } 
      else if (message.type === 'saveAllFavorites') {
        await context.globalState.update('quickOps.globalFavorites', message.favorites);
        this.panel?.webview.postMessage({ type: 'syncFavorites', favorites: message.favorites });
      }
      else if (message.type === 'toggleFavorite') {
        let favs = context.globalState.get<any[]>('quickOps.globalFavorites') || [];
        const index = favs.findIndex(f => f.url === message.url);
        if (index > -1) {
          favs.splice(index, 1);
          vscode.window.showInformationMessage('已取消收藏');
        } else {
          favs.push({ url: message.url, title: message.title, timestamp: Date.now() });
          vscode.window.showInformationMessage('⭐️ 已添加到全局收藏夹');
        }
        await context.globalState.update('quickOps.globalFavorites', favs);
        this.panel?.webview.postMessage({ type: 'syncFavorites', favorites: favs });
      }
      else if (message.type === 'openExternalBrowser') {
        vscode.env.openExternal(vscode.Uri.parse(message.url));
      } 
      else if (message.type === 'showInfo') {
        vscode.window.showInformationMessage(message.message);
      } 
      else if (message.type === 'showError') {
        vscode.window.showErrorMessage(message.message);
      }
      
      // Screencast 核心驱动指令
      else if (message.type === 'navigateScreencast') {
        if (this.page) {
          try {
            await this.page.goto(message.url, { waitUntil: 'domcontentloaded' });
          } catch (e) {
            console.error('Screencast Navigation failed', e);
          }
        }
      }
      else if (message.type === 'changeViewport') {
        if (this.page && message.width > 0 && message.height > 0) {
          await this.page.setViewport({ width: message.width, height: message.height });
        }
      }
      else if (message.type === 'mouseMove') {
        await this.page?.mouse.move(message.x, message.y);
      }
      else if (message.type === 'mouseDown') {
        await this.page?.mouse.move(message.x, message.y);
        await this.page?.mouse.down();
      }
      else if (message.type === 'mouseUp') {
        await this.page?.mouse.move(message.x, message.y);
        await this.page?.mouse.up();
      }
      else if (message.type === 'mouseScroll') {
        await this.page?.mouse.wheel({ deltaY: message.deltaY });
      }
      else if (message.type === 'keyboardType') {
        if (message.key === 'Enter') await this.page?.keyboard.press('Enter');
        else if (message.key === 'Backspace') await this.page?.keyboard.press('Backspace');
        else if (message.key.length === 1) await this.page?.keyboard.type(message.key);
      }
    });
  }

  private async startPuppeteerEngine() {
    const executablePath = this.getChromiumPath();
    if (!executablePath) {
      vscode.window.showErrorMessage('❌ 未检测到 Chrome/Edge 浏览器，推流引擎启动失败！');
      return;
    }

    this.browser = await puppeteer.launch({
      executablePath: executablePath,
      headless: true,
      defaultViewport: { width: 1200, height: 800 }
    });

    this.page = await this.browser.newPage();
    this.cdpSession = await this.page.target().createCDPSession();

    this.cdpSession.on('Page.screencastFrame', async (frameObject) => {
      if (this.panel) {
        this.panel.webview.postMessage({
          type: 'renderFrame',
          base64Data: frameObject.data
        });
      }
      try {
        await this.cdpSession?.send('Page.screencastFrameAck', { sessionId: frameObject.sessionId });
      } catch (e) { }
    });

    await this.cdpSession.send('Page.startScreencast', { format: 'jpeg', quality: 80, everyNthFrame: 1 });
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