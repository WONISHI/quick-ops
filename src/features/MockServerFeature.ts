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

// 定义接口结构，方便类型提示
interface IMockConfigItem {
  port: number;
  target: string;
  rules: any[];
}

export class MockServerFeature implements IFeature {
  public readonly id = 'MockServerFeature';
  private server: any;
  private app: any; // 使用 any 规避类型检查

  private webviewProvider!: MockWebviewProvider;
  private _isRunning: boolean = false;
  private _currentPort: number = 443;

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

    // 1. 读取配置：适配数组结构
    // 假设我们启动列表中的第一个配置，或者你可以遍历启动所有（这里演示启动第一个）
    const mockConfigs = this.configService.config.mock;
    let config: IMockConfigItem;

    if (Array.isArray(mockConfigs) && mockConfigs.length > 0) {
      config = mockConfigs[0]; // 默认取第一个配置
    } else if (typeof mockConfigs === 'object' && !Array.isArray(mockConfigs)) {
      // 兼容旧的对象结构
      config = mockConfigs as any;
    } else {
      // 默认初始化
      config = { port: 443, target: '', rules: [] };
    }

    this._currentPort = config.port;

    // 2. 校验 Target
    if (!config.target) {
      const target = await vscode.window.showInputBox({
        prompt: '未配置全局转发目标 (Target)，请输入真实后端地址',
        placeHolder: 'http://example.com',
      });
      if (target) {
        config.target = target;
        // 注意：这里保存时要小心，如果是数组，需要更新数组中的那一项
        // 为简化，这里暂时只更新内存，持久化保存建议在 Webview 侧完成
        // await this.configService.updateConfig('mock', [config]);
      } else {
        vscode.window.showWarningMessage('未配置 Target，所有未命中的接口将无法转发');
        // 不 return，允许仅运行 Mock 模式
      }
    }

    this.app = express();
    this.app.use(cors());
    this.app.use(bodyParser.json());
    this.app.use(bodyParser.urlencoded({ extended: true }));

    // --- 3. 核心拦截中间件 (处理 Mock 返回) ---
    this.app.use(async (req: any, res: any, next: any) => {
      // 动态读取最新配置 (支持热更新)
      const requestHost = req.get('host');
      const protocol = req.protocol;
      const currentConfigs = this.configService.config.mock;
      const fullOrigin = `${protocol}://${requestHost}`;
      let currentRules: any[] = [];

      // 从数组中找到当前端口对应的配置
      if (Array.isArray(currentConfigs)) {
        const activeConfig = currentConfigs.find((c: any) => {
          return c.port === this._currentPort || c.target === fullOrigin || c.target.includes(requestHost);
        });
        currentRules = activeConfig?.rules || [];
      } else {
        currentRules = (currentConfigs as any)?.rules || [];
      }

      // 查找匹配的规则
      const matchedRule = currentRules.find((r) => r.enabled && req.method.toUpperCase() === r.method.toUpperCase() && (req.path === r.url || req.path.includes(r.url)));

      if (matchedRule) {
        console.log(`[Mock] Hit Rule: ${req.path}`);

        // 情况 A: 静态数据 (data 字段存在)
        if (matchedRule.data) {
          console.log(`  -> Static JSON Mode`);
          res.set('Content-Type', matchedRule.contentType || 'application/json');
          try {
            const responseData = typeof matchedRule.data === 'string' ? JSON.parse(matchedRule.data) : matchedRule.data;
            res.send(responseData);
          } catch (e: any) {
            res.status(500).json({ error: 'Invalid Static JSON', details: e.message });
          }
          return;
        }

        // 情况 B: 动态 Mock (template 字段存在)
        if (matchedRule.template) {
          console.log(`  -> Mock Template Mode`);
          try {
            const templateObj = typeof matchedRule.template === 'string' ? JSON.parse(matchedRule.template) : matchedRule.template;
            const mockData = Mock.mock(templateObj);
            res.set('Content-Type', matchedRule.contentType || 'application/json');
            res.send(mockData);
          } catch (e: any) {
            res.status(500).json({ error: 'Mock Generation Failed', details: e.message });
          }
          return;
        }

        // 情况 C: 规则开启但无数据 -> 纯转发规则 (Pass through to Proxy)
        console.log(`  -> Forwarding Mode (Specific Rule)`);
      }

      next();
    });

    // --- 4. 代理转发中间件 ---
    const proxyConfig: any = {
      target: config.target || 'http://localhost', // 默认兜底
      changeOrigin: true,
      secure: false,
      logLevel: 'debug',
      timeout: 5000,
      proxyTimeout: 6000,
      on: {
        proxyReq: async () => {
          console.log('onProxyReq - 请求被代理前');
        },
        error: (err: any) => {
          console.log('error', err);
        },
      },
    };

    this.app.use('/nfplus-nephogram-admin', createProxyMiddleware(proxyConfig));

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
