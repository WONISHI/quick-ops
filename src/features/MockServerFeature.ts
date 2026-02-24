import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
const express = require('express');
const cors = require('cors');
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
    app.use(cors());
    app.use(bodyParser.json({ limit: '50mb' }));
    app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));

    // 1. Mock 拦截层
    app.use(async (req: any, res: any, next: any) => {
      let allMocks = this.configService.config.mock || [];
      if (!Array.isArray(allMocks)) allMocks = [];

      const rules = allMocks.filter((m: any) => m.proxyId === proxyConfig.id);

      // 🌟 核心修复：严格匹配路径（忽略参数）
      const matchedRule = rules.find((r: any) => {
        if (!r.enabled) return false;
        // 去除配置里可能误填的参数部分 (例如 /api/user?id=1 变成 /api/user)
        const rulePath = (r.url || '').split('?')[0];
        // req.path 是 Express 自动剥离了查询参数的纯路径
        return req.method.toUpperCase() === r.method.toUpperCase() && req.path === rulePath;
      });

      if (matchedRule) {
        if (matchedRule.target && !matchedRule.dataPath && !matchedRule.data && !matchedRule.template) {
          return next(); // 仅配置了转发，没有 Mock 数据，放行给代理层
        }

        console.log(`[Proxy:${proxyConfig.port}] Mock Hit: ${req.path}`);
        res.set('Content-Type', matchedRule.contentType || 'application/json');

        // 读取文件数据
        if (matchedRule.dataPath) {
          let absPath = matchedRule.dataPath;

          // 如果是相对路径，拼上根目录
          if (!path.isAbsolute(absPath)) {
            const root = this.getWorkspaceRoot();
            if (root) {
              absPath = path.join(root, absPath);
            }
          }

          if (fs.existsSync(absPath)) {
            try {
              const fileContent = fs.readFileSync(absPath, 'utf8');
              const parsedData = JSON.parse(fileContent);
              if (matchedRule.isTemplate) {
                return res.send(Mock.mock(parsedData));
              } else {
                return res.send(parsedData);
              }
            } catch (e: any) {
              return res.status(500).json({ error: '读取 Mock 文件失败', details: e.message });
            }
          } else {
            console.warn(`[Proxy:${proxyConfig.port}] Mock 文件不存在: ${absPath}`);
          }
        }

        // 兼容旧的行内数据
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

    // 🛡️ 核心修复：强制格式化 URL 协议头，防止引发 null.split 致命崩溃
    const formatUrl = (url: string) => {
      if (!url || typeof url !== 'string' || url.trim() === '') return undefined;
      let trimmed = url.trim();
      // 如果没有协议头，强制加上 http:// (这样 target 解析才不会报 protocol null)
      if (!/^https?:\/\//i.test(trimmed)) {
        trimmed = trimmed.replace(/^\/+/, ''); // 去除意外开头的双斜杠
        trimmed = `http://${trimmed}`;
      }
      return trimmed;
    };

    const defaultTarget = formatUrl(proxyConfig.target);
    if (!defaultTarget) return; // 配置异常则不启动代理

    const proxyOptions: any = {
      target: defaultTarget,
      changeOrigin: true,
      secure: false, // 允许自签名 HTTPS
      logLevel: 'error',

      router: (req: any) => {
        let allMocks = this.configService.config.mock || [];
        if (!Array.isArray(allMocks)) allMocks = [];
        const rules = allMocks.filter((m: any) => m.proxyId === proxyConfig.id);

        // 🌟 核心修复：独立代理转发的路由也使用严格匹配
        const matchedRule = rules.find((r: any) => {
          if (!r.enabled) return false;
          const rulePath = (r.url || '').split('?')[0];
          return req.method.toUpperCase() === r.method.toUpperCase() && req.path === rulePath;
        });

        if (matchedRule && matchedRule.target) {
          const ruleTarget = formatUrl(matchedRule.target);
          if (ruleTarget) return ruleTarget;
        }
        return defaultTarget;
      },

      onError: (err: any, req: any, res: any) => {
        console.error(`[Proxy Error - Port ${proxyConfig.port}]`, err.message);
        if (!res.headersSent) res.status(502).send(`Proxy Error: ${err.message}`);
      },

      onProxyReq: (proxyReq: any, req: any, res: any) => {
        if (req.body) {
          const bodyData = JSON.stringify(req.body);
          proxyReq.setHeader('Content-Type', 'application/json');
          proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
          proxyReq.write(bodyData);
        }
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
