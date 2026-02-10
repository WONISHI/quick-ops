import * as vscode from 'vscode';
// 使用 require 解决 "此表达式不可调用" 的 TypeScript 报错
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const Mock = require('mockjs');

import { createProxyMiddleware } from 'http-proxy-middleware';
import { IFeature } from '../core/interfaces/IFeature';
import { ConfigurationService } from '../services/ConfigurationService';
import { MockWebviewProvider } from '../providers/MockWebviewProvider';

export class MockServerFeature implements IFeature {
  public readonly id = 'MockServerFeature';
  private server: any;
  private app: any; // 使用 any 规避类型检查

  private webviewProvider!: MockWebviewProvider;
  private _isRunning: boolean = false;
  private _currentPort: number = 3000;

  constructor(private configService: ConfigurationService = ConfigurationService.getInstance()) {}

  public activate(context: vscode.ExtensionContext): void {
    this.webviewProvider = new MockWebviewProvider(context.extensionUri, this);

    context.subscriptions.push(vscode.window.registerWebviewViewProvider('quickOps.mockView', this.webviewProvider));
  }

  // 辅助方法：供 Provider 调用以获取当前状态
  public notifyStatusToWebview(webview?: vscode.Webview) {
    const msg = { type: 'status', running: this._isRunning, port: this._currentPort };
    if (webview) {
      webview.postMessage(msg);
    } else {
      this.webviewProvider.updateStatus(this._isRunning, this._currentPort);
    }
  }

  public async startServer() {
    if (this.server) {
      vscode.window.showInformationMessage('Mock Server 已经在运行中');
      this.notifyStatusToWebview();
      return;
    }

    const config = this.configService.config.mock || { port: 3000, target: '', rules: [] };
    this._currentPort = config.port;

    if (!config.target) {
      const target = await vscode.window.showInputBox({
        prompt: '未配置目标域名 (Target)，请输入真实后端地址',
        placeHolder: 'http://example.com',
      });
      if (target) {
        config.target = target;
        await this.configService.updateConfig('mock', config);
      } else {
        vscode.window.showWarningMessage('无法启动：未配置转发目标地址');
        return;
      }
    }

    this.app = express();
    this.app.use(cors());
    this.app.use(bodyParser.json());
    this.app.use(bodyParser.urlencoded({ extended: true }));

    // --- 拦截中间件 ---
    this.app.use(async (req: any, res: any, next: any) => {
      // 动态读取配置，支持热更新
      const currentConfig = this.configService.config.mock;
      const rules = currentConfig?.rules || [];

      const matchedRule = rules.find((r) => r.enabled && req.method.toUpperCase() === r.method.toUpperCase() && (req.path === r.url || req.path.includes(r.url)));

      if (matchedRule) {
        console.log(`[Mock] Hit: ${req.path}`);
        try {
          const templateObj = typeof matchedRule.template === 'string' ? JSON.parse(matchedRule.template) : matchedRule.template;
          const mockData = Mock.mock(templateObj);
          res.set('Content-Type', matchedRule.contentType || 'application/json');
          res.send(mockData);
        } catch (e: any) {
          res.status(500).json({ error: 'Mock Failed', details: e.message });
        }
        return;
      }
      next();
    });

    // --- 代理中间件 ---
    const proxyConfig: any = {
      target: config.target,
      changeOrigin: true,
      secure: false,
      logLevel: 'debug',
      timeout: 5000,
      proxyTimeout: 6000,
      on: {
        error: (err: any) => {
          console.log('error', err);
        },
      },
    };

    this.app.use('/', createProxyMiddleware(proxyConfig));

    try {
      this.server = this.app.listen(config.port, () => {
        this._isRunning = true;
        vscode.window.showInformationMessage(`Mock Server 启动: http://localhost:${config.port}`);
        this.notifyStatusToWebview();
      });

      this.server.on('error', (e: any) => {
        if (e.code === 'EADDRINUSE') {
          vscode.window.showErrorMessage(`端口 ${config.port} 被占用`);
          this.stopServer();
        } else {
          vscode.window.showErrorMessage(`启动失败: ${e.message}`);
        }
      });
    } catch (e: any) {
      vscode.window.showErrorMessage(`启动异常: ${e.message}`);
    }
  }

  public stopServer() {
    if (this.server) {
      this.server.close();
      this.server = null;
      this.app = undefined;
      this._isRunning = false;
      vscode.window.showInformationMessage('Mock Server 已停止');
      this.notifyStatusToWebview();
    }
  }
}
