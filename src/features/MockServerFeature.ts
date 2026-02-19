import * as vscode from 'vscode';
// 使用 require 解决 "此表达式不可调用" 的 TypeScript 报错
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const Mock = require('mockjs');
import { createProxyMiddleware } from 'http-proxy-middleware';
import type { Options } from 'http-proxy-middleware';
import { isEmpty } from 'lodash-es';

import { IFeature } from '../core/interfaces/IFeature';
import { ConfigurationService } from '../services/ConfigurationService';
import { MockWebviewProvider } from '../providers/MockWebviewProvider';

// --- 类型定义（便于维护）---
interface IMockConfigItem {
  port: number;
  target: string;
  rules: any[];
}

// 代理配置项：对应 config.proxy 中的每个键值对
// interface IProxyServiceConfig extends Options {
//   target: string;
//   origin?: string; // 路径前缀，自动生成
//   on?: {
//     proxyReq?: Function;
//     error?: Function;
//   };
//   [key: string]: any;
// }

export class MockServerFeature implements IFeature {
  public readonly id = 'MockServerFeature';
  private server: any;
  private app: any;

  private webviewProvider!: MockWebviewProvider;
  private _isRunning: boolean = false;
  private _currentPort: number = 443;

  constructor(private configService: ConfigurationService = ConfigurationService.getInstance()) {}

  // -------------------------------------------------------------
  // 激活：注册 Webview
  // -------------------------------------------------------------
  public activate(context: vscode.ExtensionContext): void {
    this.webviewProvider = new MockWebviewProvider(context.extensionUri, this);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider('quickOps.mockView', this.webviewProvider));
  }

  // -------------------------------------------------------------
  // 状态通知
  // -------------------------------------------------------------
  public notifyStatusToWebview(webview?: vscode.Webview) {
    const msg = { type: 'status', running: this._isRunning, port: this._currentPort };
    if (webview) {
      webview.postMessage(msg);
    } else {
      this.webviewProvider.updateStatus(this._isRunning, this._currentPort);
    }
  }

  // -------------------------------------------------------------
  // 启动 Mock 服务器
  // -------------------------------------------------------------
  public async startServer() {
    if (this.server) {
      vscode.window.showInformationMessage('Mock Server 已经在运行中');
      this.notifyStatusToWebview();
      return;
    }

    // 1. 获取 Mock 配置（支持数组和对象两种格式）
    const mockConfigs = this.configService.config.mock;
    let config: IMockConfigItem;

    if (Array.isArray(mockConfigs) && mockConfigs.length > 0) {
      config = mockConfigs[0]; // 默认取第一个配置
    } else if (typeof mockConfigs === 'object' && !Array.isArray(mockConfigs)) {
      config = mockConfigs as any;
    } else {
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
      } else {
        vscode.window.showWarningMessage('未配置 Target，所有未命中的接口将无法转发');
      }
    }

    // 3. 创建 Express 实例
    this.app = express();
    this.app.use(cors());
    this.app.use(bodyParser.json());
    this.app.use(bodyParser.urlencoded({ extended: true }));

    // 4. 核心拦截中间件（Mock 规则优先）
    this.app.use(this.createMockInterceptor(config.port));

    // 5. 注册所有动态代理（抽离为独立方法）
    this.setupProxies(this.app);

    // 6. 启动监听
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

  // -------------------------------------------------------------
  // 停止服务器
  // -------------------------------------------------------------
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

  // -------------------------------------------------------------
  // 🚀 抽离的方法：注册所有代理中间件
  // -------------------------------------------------------------
  private setupProxies(app: any): void {
    const proxyConfigs = this.configService.config.proxy;
    if (isEmpty(proxyConfigs)) {
      console.log('[Proxy] 无代理配置，跳过');
      return;
    }

    Object.entries(proxyConfigs).forEach(([origin, services]) => {
      // 确保路径前缀以 '/' 开头（Express 挂载要求）
      const mountPath = origin.startsWith('/') ? origin : `/${origin}`;

      // 合并默认配置 + 当前服务的特定配置
      const proxyOptions: any = {
        target: services.target || 'http://localhost',
        changeOrigin: services.changeOrigin ?? true,
        secure: services.secure ?? false,
        logLevel: services.logLevel ?? 'debug',
        timeout: services.timeout ?? 5000,
        proxyTimeout: services.proxyTimeout ?? 6000,
        // 支持 pathRewrite、router 等，直接从 services 透传
        ...(services.pathRewrite && { pathRewrite: services.pathRewrite }),
        ...(services.router && { router: services.router }),
        on: {
          proxyReq: (proxyReq: any, req: any, res: any) => {
            console.log(`[Proxy] ${req.method} ${mountPath} → ${services.target}`);
            services.on?.proxyReq?.(proxyReq, req, res);
          },
          error: (err: any, req: any, res: any) => {
            console.error(`[Proxy Error] ${mountPath}:`, err.message);
            services.on?.error?.(err, req, res);
          },
        },
      };

      // 注册代理中间件
      app.use(mountPath, createProxyMiddleware(proxyOptions));
      console.log(`[Proxy] 已注册: ${mountPath} → ${services.target}`);
    });
  }

  // -------------------------------------------------------------
  // 内部方法：创建 Mock 拦截中间件（保持原逻辑，仅提取）
  // -------------------------------------------------------------
  private createMockInterceptor(currentPort: number) {
    return async (req: any, res: any, next: any) => {
      const requestHost = req.get('host');
      const protocol = req.protocol;
      const currentConfigs = this.configService.config.mock;
      const fullOrigin = `${protocol}://${requestHost}`;
      let currentRules: any[] = [];

      // 从数组中找到当前端口对应的配置
      if (Array.isArray(currentConfigs)) {
        const activeConfig = currentConfigs.find((c: any) => {
          return c.port === currentPort || c.target === fullOrigin || c.target?.includes(requestHost);
        });
        currentRules = activeConfig?.rules || [];
      } else {
        currentRules = (currentConfigs as any)?.rules || [];
      }

      // 查找匹配的规则
      const matchedRule = currentRules.find((r) => r.enabled && req.method.toUpperCase() === r.method?.toUpperCase() && (req.path === r.url || req.path.includes(r.url)));

      if (matchedRule) {
        console.log(`[Mock] 命中规则: ${req.path}`);

        // 静态数据
        if (matchedRule.data) {
          console.log(`  -> 静态 JSON 模式`);
          res.set('Content-Type', matchedRule.contentType || 'application/json');
          try {
            const responseData = typeof matchedRule.data === 'string' ? JSON.parse(matchedRule.data) : matchedRule.data;
            res.send(responseData);
          } catch (e: any) {
            res.status(500).json({ error: '无效的静态 JSON', details: e.message });
          }
          return;
        }

        // 动态 Mock (mockjs)
        if (matchedRule.template) {
          console.log(`  -> Mock 模板模式`);
          try {
            const templateObj = typeof matchedRule.template === 'string' ? JSON.parse(matchedRule.template) : matchedRule.template;
            const mockData = Mock.mock(templateObj);
            res.set('Content-Type', matchedRule.contentType || 'application/json');
            res.send(mockData);
          } catch (e: any) {
            res.status(500).json({ error: 'Mock 生成失败', details: e.message });
          }
          return;
        }

        // 规则开启但无数据 -> 纯转发（由后续代理处理）
        console.log(`  -> 转发模式（命中规则但无数据）`);
      }

      next();
    };
  }
}
