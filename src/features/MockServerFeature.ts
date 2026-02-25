import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
const express = require('express');
const bodyParser = require('body-parser');
const Mock = require('mockjs');

import { createProxyMiddleware } from 'http-proxy-middleware';
import { IFeature } from '../core/interfaces/IFeature';
import { ConfigurationService } from '../services/ConfigurationService';
import { MockWebviewProvider } from '../providers/MockWebviewProvider';
import ColorLog from '../utils/ColorLog';

export class MockServerFeature implements IFeature {
  public readonly id = 'MockServerFeature';

  public servers: Map<string, any> = new Map();
  private webviewProvider!: MockWebviewProvider;

  constructor(private configService: ConfigurationService = ConfigurationService.getInstance()) {}

  public activate(context: vscode.ExtensionContext): void {
    this.webviewProvider = new MockWebviewProvider(context.extensionUri, this);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider('quickOps.mockView', this.webviewProvider));

    context.subscriptions.push(
      vscode.commands.registerCommand('quick-ops.mock.start', () => this.startAll()),
      vscode.commands.registerCommand('quick-ops.mock.stop', () => this.stopAll()),
    );

    setTimeout(() => {
      this.syncServers();
    }, 1000);
    ColorLog.black(`[${this.id}]`, 'Activated.');
  }

  private getWorkspaceRoot(): string | undefined {
    const folders = vscode.workspace.workspaceFolders;
    return folders && folders.length > 0 ? folders[0].uri.fsPath : undefined;
  }

  public notifyStatusToWebview() {
    const runningProxyIds = Array.from(this.servers.keys());
    this.webviewProvider.updateStatus(runningProxyIds);
  }

  public async startAll() {
    let proxies = this.configService.config.proxy || [];
    if (!Array.isArray(proxies)) proxies = [];

    if (proxies.length === 0) {
      vscode.window.showWarningMessage('启动失败：请先添加代理服务！');
      this.notifyStatusToWebview();
      return;
    }

    const hasEnabled = proxies.some((c: any) => c.enabled);
    if (!hasEnabled && proxies.length > 0) {
      proxies[0].enabled = true;
      await this.configService.updateConfig('proxy', proxies);
    }

    await this.syncServers();

    if (this.servers.size > 0) {
      vscode.window.showInformationMessage(`已启动 ${this.servers.size} 个代理服务`);
    }
  }

  public async stopAll() {
    for (const [id, server] of this.servers.entries()) {
      server.close();
    }
    this.servers.clear();
    vscode.window.showInformationMessage('所有代理服务已停止');
    this.notifyStatusToWebview();
  }

  public async syncServers() {
    let proxies = this.configService.config.proxy || [];
    if (!Array.isArray(proxies)) proxies = [];

    for (const [proxyId, server] of this.servers.entries()) {
      const conf = proxies.find((c: any) => c.id === proxyId);
      if (!conf || !conf.enabled) {
        server.close();
        this.servers.delete(proxyId);
      }
    }

    for (const conf of proxies) {
      if (conf.enabled && !this.servers.has(conf.id)) {
        if (!conf.port || !conf.target) continue;
        this.startProxyInstance(conf);
      }
    }

    this.notifyStatusToWebview();
  }

  private startProxyInstance(proxyConfig: any) {
    const app = express();

    app.use((req: any, res: any, next: any) => {
      res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
      res.header('Access-Control-Allow-Credentials', 'true');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
      res.header('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || '*');

      if (req.method === 'OPTIONS') {
        return res.status(200).end();
      }
      next();
    });

    app.use(bodyParser.json({ limit: '50mb' }));
    app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));

    // 🌟 1. Mock 拦截层
    app.use(async (req: any, res: any, next: any) => {
      let allMocks = this.configService.config.mock || [];
      if (!Array.isArray(allMocks)) allMocks = [];

      const rules = allMocks.filter((m: any) => m.proxyId === proxyConfig.id);

      const matchedRule = rules.find((r: any) => {
        if (!r.enabled) return false;
        const rulePath = (r.url || '').split('?')[0];
        return req.method.toUpperCase() === r.method.toUpperCase() && req.path === rulePath;
      });

      if (matchedRule) {
        if (matchedRule.target && !matchedRule.dataPath && !matchedRule.data && !matchedRule.template) {
          return next();
        }

        console.log(`[Mock Hit] ${req.method} ${req.path}`);
        res.set('Content-Type', matchedRule.contentType || 'application/json');

        if (matchedRule.dataPath) {
          let absPath = matchedRule.dataPath;
          if (!path.isAbsolute(absPath)) {
            const root = this.getWorkspaceRoot();
            if (root) absPath = path.join(root, absPath);
          }

          if (fs.existsSync(absPath)) {
            try {
              const fileContent = fs.readFileSync(absPath, 'utf8');
              const parsedData = JSON.parse(fileContent);
              return res.send(matchedRule.isTemplate ? Mock.mock(parsedData) : parsedData);
            } catch (e: any) {
              return res.status(500).json({ error: '读取 Mock 文件失败', details: e.message });
            }
          }
        }

        if (matchedRule.data) {
          const responseData = typeof matchedRule.data === 'string' ? JSON.parse(matchedRule.data) : matchedRule.data;
          return res.send(responseData);
        }
        if (matchedRule.template) {
          try {
            const templateObj = typeof matchedRule.template === 'string' ? JSON.parse(matchedRule.template) : matchedRule.template;
            return res.send(Mock.mock(templateObj));
          } catch (e: any) {
            return res.status(500).json({ error: 'Mock Parse Error', details: e.message });
          }
        }
      }
      next();
    });

    const formatUrl = (url: string) => {
      if (!url || typeof url !== 'string' || url.trim() === '') return undefined;
      let trimmed = url.trim();
      if (!/^https?:\/\//i.test(trimmed)) {
        trimmed = trimmed.replace(/^\/+/, '');
        trimmed = `http://${trimmed}`;
      }
      return trimmed;
    };

    // 如果配置了前端代理目标，默认 Target 指向前端，否则指向后端
    const defaultTarget = formatUrl(proxyConfig.frontendTarget) || formatUrl(proxyConfig.target);
    if (!defaultTarget) return;

    // 🌟 2. 终极网关与代理配置层
    const proxyOptions: any = {
      target: defaultTarget,
      changeOrigin: proxyConfig.changeOrigin !== false,
      secure: !!proxyConfig.secure,
      ws: proxyConfig.ws !== false,
      proxyTimeout: proxyConfig.timeout || 30000,
      timeout: proxyConfig.timeout || 30000,
      logLevel: 'silent',

      // 处理可选的路径重写
      pathRewrite: proxyConfig.pathRewrite || undefined,

      cookieDomainRewrite: { '*': '' },
      autoRewrite: true,

      router: (req: any) => {
        // 规则 1：如果命中 Mock，且该 Mock 配置了单独的 Target 转发
        let allMocks = this.configService.config.mock || [];
        if (!Array.isArray(allMocks)) allMocks = [];
        const rules = allMocks.filter((m: any) => m.proxyId === proxyConfig.id);

        const matchedRule = rules.find((r: any) => {
          if (!r.enabled) return false;
          const rulePath = (r.url || '').split('?')[0];
          return req.method.toUpperCase() === r.method.toUpperCase() && req.path === rulePath;
        });

        if (matchedRule && matchedRule.target) {
          const ruleTarget = formatUrl(matchedRule.target);
          if (ruleTarget) return ruleTarget;
        }

        // 规则 2 🌟：网关模式 (API 智能分发)
        if (proxyConfig.apiPrefix && proxyConfig.target) {
          // 支持配置多个前缀，如 "/api, /xy, /v1"
          const prefixes = proxyConfig.apiPrefix
            .split(',')
            .map((s: string) => s.trim())
            .filter(Boolean);
          if (prefixes.some((p: string) => req.path.startsWith(p))) {
            // 发现是 API 请求，引流到后端的真实服务器
            return formatUrl(proxyConfig.target);
          }
        }

        // 规则 3：非 API 请求，且配置了本地前端服务，引流到本地开发服务
        if (proxyConfig.frontendTarget) {
          return formatUrl(proxyConfig.frontendTarget);
        }

        // 兜底：去后端 Target
        return formatUrl(proxyConfig.target);
      },

      onProxyReq: (proxyReq: any, req: any, res: any) => {
        // 🌟 极致伪装：当我们判断出这个请求是要发给真实后端时，强制修改它的 Host / Origin 伪装成浏览器正常访问
        let isBackendRequest = false;
        if (proxyConfig.apiPrefix) {
          const prefixes = proxyConfig.apiPrefix
            .split(',')
            .map((s: string) => s.trim())
            .filter(Boolean);
          if (prefixes.some((p: string) => req.path.startsWith(p))) {
            isBackendRequest = true;
          }
        } else {
          // 如果没配置网关，默认全部去后端
          isBackendRequest = true;
        }

        if (isBackendRequest && proxyConfig.changeOrigin !== false) {
          try {
            const targetUrl = new URL(formatUrl(proxyConfig.target)!);
            proxyReq.setHeader('Origin', targetUrl.origin);
            proxyReq.setHeader('Referer', targetUrl.origin + req.path);
          } catch (e) {}
        }

        // 还原被 body-parser 吞掉的流
        if (!req.body || !Object.keys(req.body).length) return;
        if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return;

        const contentType = proxyReq.getHeader('Content-Type') || req.headers['content-type'] || '';
        let bodyData;

        if (contentType.includes('application/json')) {
          bodyData = JSON.stringify(req.body);
        } else if (contentType.includes('application/x-www-form-urlencoded')) {
          bodyData = new URLSearchParams(req.body).toString();
        } else {
          bodyData = JSON.stringify(req.body);
        }

        if (bodyData) {
          proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
          proxyReq.write(bodyData);
        }
      },

      onProxyRes: (proxyRes: any, req: any, res: any) => {
        const headersToRemove = [
          'content-security-policy',
          'content-security-policy-report-only',
          'x-frame-options',
          'clear-site-data',
          'strict-transport-security',
          'access-control-allow-origin',
          'access-control-allow-credentials',
          'access-control-allow-methods',
          'access-control-allow-headers',
        ];

        headersToRemove.forEach((header) => {
          delete proxyRes.headers[header];
        });

        proxyRes.headers['access-control-allow-origin'] = req.headers.origin || '*';
        proxyRes.headers['access-control-allow-credentials'] = 'true';
        proxyRes.headers['access-control-allow-methods'] = 'GET, POST, PUT, DELETE, PATCH, OPTIONS';
        proxyRes.headers['access-control-allow-headers'] = req.headers['access-control-request-headers'] || '*';
      },

      onError: (err: any, req: any, res: any) => {
        console.error(`[Proxy Error - Port ${proxyConfig.port}]`, err.message);
        if (!res.headersSent) res.status(502).json({ error: 'Proxy Request Failed', details: err.message });
      },
    };

    app.use('/', createProxyMiddleware(proxyOptions));

    try {
      const server = app.listen(proxyConfig.port, () => {
        this.servers.set(proxyConfig.id, server);
        this.notifyStatusToWebview();
      });

      server.on('error', (e: any) => {
        if (e.code === 'EADDRINUSE') {
          vscode.window.showErrorMessage(`启动失败：端口 ${proxyConfig.port} 被占用！`);
        } else {
          vscode.window.showErrorMessage(`代理异常: ${e.message}`);
        }
        this.servers.delete(proxyConfig.id);
        this.notifyStatusToWebview();
      });
    } catch (e: any) {
      vscode.window.showErrorMessage(`创建服务异常: ${e.message}`);
    }
  }
}
