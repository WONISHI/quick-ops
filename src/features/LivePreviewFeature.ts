import * as vscode from 'vscode';
import puppeteer from 'puppeteer-core';
import * as fs from 'fs';
import * as chrome from 'karma-chrome-launcher';
import * as edge from '@chiragrupani/karma-chromium-edge-launcher';

import { IFeature } from '../core/interfaces/IFeature';
import ColorLog from '../utils/ColorLog';
import { getReactWebviewHtml } from '../utils/WebviewHelper';

export class LivePreviewFeature implements IFeature {
  public readonly id = 'LivePreviewFeature';
  private panel: vscode.WebviewPanel | undefined;
  
  private browser: puppeteer.Browser | undefined;
  private page: puppeteer.Page | undefined;
  private cdpSession: puppeteer.CDPSession | undefined;

  // 虚拟视口分辨率
  private readonly VIEWPORT_WIDTH = 1200;
  private readonly VIEWPORT_HEIGHT = 800;

  public activate(context: vscode.ExtensionContext): void {
    const command = vscode.commands.registerCommand('quick-ops.openLivePreview', async () => {
      const url = await vscode.window.showInputBox({
        prompt: '输入要实时预览的网址 (如 http://localhost:5173)',
        value: 'http://localhost:5173'
      });
      if (url) {
        await this.showScreencastPanel(context, url);
      }
    });

    context.subscriptions.push(command);
    ColorLog.black(`[${this.id}]`, 'Activated.');
  }

  // 🌟 核心升级：使用 vscode-browse-lite 同款的 Karma 寻址器
  // 它会自动读取注册表、系统环境变量，100% 找到用户电脑上的 Chrome 或 Edge
  private getChromiumPath(): string | undefined {
    // 将两个库导出的全部可用启动器合并
    const knownChromiums = [...Object.entries(chrome), ...Object.entries(edge)];

    for (const [key, info] of knownChromiums) {
      // 过滤掉非启动器的导出项
      if (!key.startsWith('launcher')) continue;

      // 提取底层封装的跨平台真实绝对路径
      const path = (info as any)?.[1]?.prototype?.DEFAULT_CMD?.[process.platform];
      
      if (path && typeof path === 'string' && fs.existsSync(path)) {
        ColorLog.black(`[${this.id}]`, `检测到本地浏览器: ${path}`);
        return path;
      }
    }

    return undefined;
  }

  private async showScreencastPanel(context: vscode.ExtensionContext, url: string) {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
    } else {
      this.panel = vscode.window.createWebviewPanel(
        'quickOpsScreencast', 
        '原生硬核预览 (Screencast)', 
        vscode.ViewColumn.Beside, 
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [context.extensionUri]
        }
      );

      this.panel.onDidDispose(() => {
        this.panel = undefined;
        this.cleanupPuppeteer();
      });

      this.panel.webview.html = getReactWebviewHtml(context.extensionUri, this.panel.webview, '/preview');
      
      this.panel.webview.onDidReceiveMessage(async (msg) => {
        if (!this.page) return;

        try {
          switch (msg.type) {
            case 'mouseMove':
              await this.page.mouse.move(msg.x, msg.y);
              break;
            case 'mouseClick':
              await this.page.mouse.click(msg.x, msg.y);
              break;
            case 'mouseScroll':
              await this.page.mouse.wheel({ deltaY: msg.deltaY });
              break;
            case 'keyboardType':
              if (msg.key === 'Enter') await this.page.keyboard.press('Enter');
              else if (msg.key === 'Backspace') await this.page.keyboard.press('Backspace');
              else if (msg.key.length === 1) await this.page.keyboard.type(msg.key);
              break;
          }
        } catch (e) {
          console.error('事件转发失败:', e);
        }
      });
    }

    await this.startPuppeteerScreencast(url);
  }

  private async startPuppeteerScreencast(url: string) {
    vscode.window.showInformationMessage('🚀 正在启动后台推流引擎...');
    
    // 🌟 1. 获取用户本地的浏览器路径
    const executablePath = this.getChromiumPath();
    
    if (!executablePath) {
      vscode.window.showErrorMessage('❌ 引擎启动失败：未能在您的电脑上找到 Chrome 或 Edge 浏览器！');
      return;
    }

    // 🌟 2. 使用本地内核启动 Puppeteer
    this.browser = await puppeteer.launch({
      executablePath: executablePath, // 使用智能找到的路径
      headless: true,
      defaultViewport: { width: this.VIEWPORT_WIDTH, height: this.VIEWPORT_HEIGHT }
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

    await this.cdpSession.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 80,
      everyNthFrame: 1
    });

    await this.page.goto(url, { waitUntil: 'networkidle2' });
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