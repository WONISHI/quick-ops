import * as http from 'http';
import type { AddressInfo } from 'net';
import { EventEmitter } from 'events';
import httpProxy = require('http-proxy');

import { ExtensionContextProvider } from '@common/providers/extension-context.provider';
import { API_PROXY_RULES_STATE_KEY } from '@modules/api-proxy/constants/api-proxy.constant';
import type { ApiProxyLogItem, ApiProxyRule, ApiProxyServerState } from '@modules/api-proxy/api-proxy.type';

export class ApiProxyService extends EventEmitter {
  public static inject = [ExtensionContextProvider];

  private server?: http.Server;
  private proxyServer?: ReturnType<typeof httpProxy.createProxyServer>;
  private port = 0;
  private readonly logs: ApiProxyLogItem[] = [];

  constructor(private readonly extensionContextProvider: ExtensionContextProvider) {
    super();
  }

  public getRules(): ApiProxyRule[] {
    return this.extensionContextProvider.getContext().workspaceState.get<ApiProxyRule[]>(API_PROXY_RULES_STATE_KEY) || [];
  }

  public async saveRules(rules: ApiProxyRule[]): Promise<void> {
    await this.extensionContextProvider.getContext().workspaceState.update(API_PROXY_RULES_STATE_KEY, Array.isArray(rules) ? rules : []);
  }

  public async clearRules(): Promise<void> {
    await this.extensionContextProvider.getContext().workspaceState.update(API_PROXY_RULES_STATE_KEY, undefined);
  }

  public getLogs(): ApiProxyLogItem[] {
    return this.logs.slice(-300);
  }

  public clearLogs(): void {
    this.logs.splice(0);
    this.emit('logsChanged', this.getLogs());
  }

  public getServerState(): ApiProxyServerState {
    return {
      running: !!this.server && this.port > 0,
      port: this.port,
      origin: this.port > 0 ? `http://127.0.0.1:${this.port}` : '',
    };
  }

  public async startServer(port = 0): Promise<ApiProxyServerState> {
    if (this.server && this.port > 0) {
      return this.getServerState();
    }

    this.proxyServer = httpProxy.createProxyServer({
      changeOrigin: true,
      secure: false,
      xfwd: true,
    });

    this.proxyServer.on('proxyReq', (_proxyReq: any, req: any) => {
      this.addLog('info', `开始转发：${req.method || 'GET'} ${req.url || ''}`);
    });

    this.proxyServer.on('proxyRes', (proxyRes: any, req: any) => {
      this.addLog('success', `响应成功：${proxyRes.statusCode || 0} ${req.method || 'GET'} ${req.url || ''}`);
    });

    this.proxyServer.on('error', (error: Error, req: any, res: any) => {
      this.addLog('error', `代理失败：${error.message}`, req.url);

      if (!res.headersSent) {
        res.writeHead(502, {
          'Content-Type': 'application/json; charset=utf-8',
        });
      }

      res.end(
        JSON.stringify({
          ok: false,
          message: error.message,
        }),
      );
    });

    this.server = http.createServer((req, res) => this.handleRequest(req, res));

    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject);
      this.server?.listen(port, '127.0.0.1', resolve);
    });

    this.port = (this.server.address() as AddressInfo).port;
    this.addLog('success', `代理服务已启动：${this.getServerState().origin}`);

    return this.getServerState();
  }

  public async stopServer(): Promise<ApiProxyServerState> {
    const server = this.server;

    this.server = undefined;
    this.proxyServer?.close();
    this.proxyServer = undefined;
    this.port = 0;

    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    this.addLog('info', '代理服务已停止');

    return this.getServerState();
  }

  public dispose(): void {
    void this.stopServer();
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    this.setCorsHeaders(res);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const requestUrl = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
    const rule = this.matchRule(requestUrl);

    if (!rule) {
      this.addLog('error', `未命中规则：${requestUrl.pathname}`);
      res.writeHead(404, {
        'Content-Type': 'application/json; charset=utf-8',
      });
      res.end(
        JSON.stringify({
          ok: false,
          message: '未命中代理规则',
          path: requestUrl.pathname,
        }),
      );
      return;
    }

    const targetUrl = this.createTargetUrl(rule, requestUrl);
    const originalPath = req.url || '';

    req.url = `${targetUrl.pathname}${targetUrl.search}`;

    this.addLog('info', `命中规则：${rule.name || rule.id}`, originalPath, targetUrl.toString());

    if (!this.proxyServer) {
      res.writeHead(500, {
        'Content-Type': 'application/json; charset=utf-8',
      });
      res.end(
        JSON.stringify({
          ok: false,
          message: '代理服务未初始化',
        }),
      );
      return;
    }

    this.proxyServer.web(req, res, {
      target: targetUrl.origin,
    });
  }

  private matchRule(requestUrl: URL): ApiProxyRule | undefined {
    const pathname = requestUrl.pathname;
    const fullUrl = requestUrl.toString();

    return this.getRules().find((rule) => {
      if (!rule.enabled || !rule.match || !rule.target) return false;

      if (rule.matchType === 'exact') {
        return rule.match === pathname || rule.match === fullUrl;
      }

      try {
        const regex = new RegExp(rule.match);

        return regex.test(pathname) || regex.test(fullUrl);
      } catch {
        return false;
      }
    });
  }

  private createTargetUrl(rule: ApiProxyRule, requestUrl: URL): URL {
    const rewriteValue = this.createRewriteValue(rule, requestUrl);

    if (/^https?:\/\//i.test(rewriteValue)) {
      return new URL(rewriteValue);
    }

    const targetUrl = new URL(rewriteValue || requestUrl.pathname, rule.target);

    if (rule.preserveQuery && !targetUrl.search) {
      targetUrl.search = requestUrl.search;
    }

    return targetUrl;
  }

  private createRewriteValue(rule: ApiProxyRule, requestUrl: URL): string {
    if (!rule.rewrite) {
      return requestUrl.pathname;
    }

    if (rule.matchType !== 'regex') {
      return rule.rewrite;
    }

    try {
      const pathnameRegex = new RegExp(rule.match);

      if (pathnameRegex.test(requestUrl.pathname)) {
        return requestUrl.pathname.replace(pathnameRegex, rule.rewrite);
      }

      return requestUrl.toString().replace(pathnameRegex, rule.rewrite);
    } catch {
      return rule.rewrite;
    }
  }

  private addLog(level: ApiProxyLogItem['level'], message: string, from?: string, to?: string): void {
    this.logs.push({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      time: Date.now(),
      level,
      message,
      from,
      to,
    });

    this.emit('logsChanged', this.getLogs());
  }

  private setCorsHeaders(res: http.ServerResponse): void {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
  }
}
