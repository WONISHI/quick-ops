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
    const command = vscode.commands.registerCommand('quick-ops.openLivePreview', async () => {
      const url = await vscode.window.showInputBox({
        prompt: '输入网址以启动纯净版 Screencast 引擎',
        value: 'http://localhost:5173'
      });
      if (url) void this.showPreviewPanel(context, url);
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

  private async showPreviewPanel(context: vscode.ExtensionContext, initialUrl: string) {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'quickOpsLivePreview',
      '原生核心引擎 (Screencast)',
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [context.extensionUri] }
    );

    this.panel.onDidDispose(() => {
      this.panel = undefined;
      void this.cleanupPuppeteer();
    });

    this.panel.webview.html = getReactWebviewHtml(context.extensionUri, this.panel.webview, '/preview');

    this.panel.webview.onDidReceiveMessage(async (message) => {
      if (message.type === 'interaction') {
        if (this.cdpSession) {
          try {
            await this.cdpSession.send(message.action as any, message.params);
          } catch (e) {
            console.error('CDP Interaction failed:', e);
          }
        }
      } 
      else if (message.type === 'navigate') {
        if (this.page) await this.page.goto(message.url, { waitUntil: 'domcontentloaded' });
      }
      // 🌟 新增：工具栏交互事件
      else if (message.type === 'goBack') {
        if (this.page) await this.page.goBack();
      }
      else if (message.type === 'goForward') {
        if (this.page) await this.page.goForward();
      }
      else if (message.type === 'reload') {
        if (this.page) await this.page.reload();
      }
      else if (message.type === 'resize') {
        if (this.page) {
          await this.page.setViewport({
            width: Math.round(message.width),
            height: Math.round(message.height),
            deviceScaleFactor: 1, 
          });
        }
      }
    });

    await this.startPuppeteerEngine(initialUrl);
  }

  private async startPuppeteerEngine(url: string) {
    const executablePath = this.getChromiumPath();
    if (!executablePath) {
      void vscode.window.showErrorMessage('❌ 未检测到 Chrome/Edge 浏览器');
      return;
    }

    this.browser = await puppeteer.launch({
      executablePath,
      headless: true,
      defaultViewport: { width: 1200, height: 800 },
      args: ['--disable-gpu', '--no-sandbox'],
    });

    this.page = await this.browser.newPage();
    this.cdpSession = await this.page.target().createCDPSession();

    this.cdpSession.on('Page.screencastFrame', async (frameObject) => {
      if (this.panel) {
        this.panel.webview.postMessage({
          type: 'renderFrame',
          base64Data: frameObject.data,
          format: 'jpeg',
        });
      }
      try {
        await this.cdpSession?.send('Page.screencastFrameAck', { sessionId: frameObject.sessionId });
      } catch {}
    });

    await this.cdpSession.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 80,
      everyNthFrame: 1,
    });

    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
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