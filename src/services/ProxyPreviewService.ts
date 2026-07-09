import * as http from 'http';
import * as https from 'https';
import * as net from 'net';
import * as tls from 'tls';
import * as vscode from 'vscode';
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'http';
import type { Duplex } from 'stream';

export interface ProxyRule {
  id: string;
  path: string;
  target: string;
  changeOrigin?: boolean;
  proxyStatic?: boolean;
}

export interface ProxyPreviewConfig {
  frontend: string;
  port: number;
  rules: ProxyRule[];
}

export interface ProxyPreviewStatus {
  running: boolean;
  frontend: string;
  port: number;
  proxyUrl: string;
  rules: ProxyRule[];
}

const DEFAULT_STATIC_EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.jsx',
  '.css',
  '.less',
  '.scss',
  '.sass',
  '.map',
  '.json',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.webp',
  '.ico',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.otf',
  '.wasm',
]);

const DEFAULT_DEV_SERVER_PATHS = [
  '/@vite',
  '/@react-refresh',
  '/@fs',
  '/node_modules',
  '/__webpack_hmr',
  '/sockjs-node',
  '/ws',
];

export default class ProxyPreviewService {
  private server?: http.Server;
  private activeConfig: ProxyPreviewConfig | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly stateKey = 'quickOps.proxyPreview.config',
  ) {}

  public getDefaultConfig(): ProxyPreviewConfig {
    return {
      frontend: 'http://localhost:5173',
      port: 8899,
      rules: [
        {
          id: `${Date.now()}-api`,
          path: '/api',
          target: 'http://localhost:8080',
          changeOrigin: true,
          proxyStatic: false,
        },
      ],
    };
  }

  public getConfig(): ProxyPreviewConfig {
    return this.normalizeConfig(
      this.context.workspaceState.get<ProxyPreviewConfig>(this.stateKey) || this.getDefaultConfig(),
    );
  }

  public async saveConfig(config: ProxyPreviewConfig): Promise<ProxyPreviewConfig> {
    const normalizedConfig = this.normalizeConfig(config);

    await this.context.workspaceState.update(this.stateKey, normalizedConfig);

    if (this.server) {
      this.activeConfig = normalizedConfig;
    }

    return normalizedConfig;
  }

  public getProxyUrl(config = this.activeConfig || this.getConfig()): string {
    return `http://127.0.0.1:${config.port}`;
  }

  public getStatus(): ProxyPreviewStatus {
    const config = this.activeConfig || this.getConfig();

    return {
      running: !!this.server,
      frontend: config.frontend,
      port: config.port,
      proxyUrl: this.getProxyUrl(config),
      rules: config.rules,
    };
  }

  public async start(config?: ProxyPreviewConfig): Promise<ProxyPreviewStatus> {
    const nextConfig = config ? await this.saveConfig(config) : this.getConfig();

    await this.stop();

    this.activeConfig = nextConfig;

    this.server = http.createServer((req, res) => {
      void this.handleRequest(req, res, nextConfig);
    });

    this.server.on('upgrade', (req, socket, head) => {
      this.handleUpgrade(req, socket, head, nextConfig);
    });

    await new Promise<void>((resolve, reject) => {
      const server = this.server;

      if (!server) {
        reject(new Error('代理服务创建失败。'));
        return;
      }

      const handleError = (error: Error) => {
        server.off('listening', handleListening);
        reject(error);
      };

      const handleListening = () => {
        server.off('error', handleError);
        resolve();
      };

      server.once('error', handleError);
      server.once('listening', handleListening);
      server.listen(nextConfig.port, '127.0.0.1');
    });

    return this.getStatus();
  }

  public async stop(): Promise<void> {
    if (!this.server) return;

    const server = this.server;

    this.server = undefined;
    this.activeConfig = undefined;

    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }

  public async dispose(): Promise<void> {
    await this.stop();
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse, config: ProxyPreviewConfig): Promise<void> {
    const target = this.resolveTarget(req.url || '/', config);

    try {
      await this.proxyHttpRequest(req, res, target);
    } catch (error: any) {
      if (res.headersSent) {
        res.end();
        return;
      }

      res.statusCode = 502;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(
        JSON.stringify({
          message: 'QuickOps 代理请求失败',
          error: error?.message || String(error),
          target,
        }),
      );
    }
  }

  private handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, config: ProxyPreviewConfig): void {
    const target = this.resolveTarget(req.url || '/', config);

    try {
      const targetUrl = new URL(target);
      const isHttps = targetUrl.protocol === 'https:';
      const port = Number(targetUrl.port || (isHttps ? 443 : 80));

      let upstreamSocket: net.Socket | tls.TLSSocket;

      const handleConnected = () => {
        const requestPath = this.getProxyRequestPath(req.url || '/', targetUrl);
        const headers = this.createProxyHeaders(req.headers, targetUrl, true);

        upstreamSocket.write(
          [
            `${req.method} ${requestPath} HTTP/${req.httpVersion}`,
            ...Object.entries(headers).map(([key, value]) => {
              return `${key}: ${Array.isArray(value) ? value.join(', ') : value}`;
            }),
            '',
            '',
          ].join('\r\n'),
        );

        if (head.length > 0) {
          upstreamSocket.write(head);
        }

        upstreamSocket.pipe(socket);
        socket.pipe(upstreamSocket);
      };

      if (isHttps) {
        upstreamSocket = tls.connect(
          {
            host: targetUrl.hostname,
            port,
            servername: targetUrl.hostname,
          },
          handleConnected,
        );
      } else {
        upstreamSocket = net.connect(
          {
            host: targetUrl.hostname,
            port,
          },
          handleConnected,
        );
      }

      upstreamSocket.on('error', () => {
        socket.destroy();
      });

      socket.on('error', () => {
        upstreamSocket.destroy();
      });
    } catch {
      socket.destroy();
    }
  }

  private proxyHttpRequest(req: IncomingMessage, res: ServerResponse, target: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const targetUrl = new URL(target);
      const isHttps = targetUrl.protocol === 'https:';
      const requestPath = this.getProxyRequestPath(req.url || '/', targetUrl);
      const headers = this.createProxyHeaders(req.headers, targetUrl);

      const handleProxyResponse = (proxyRes: IncomingMessage) => {
        res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
        proxyRes.pipe(res);
        proxyRes.on('end', resolve);
        proxyRes.on('error', reject);
      };

      const requestOptions: http.RequestOptions = {
        protocol: targetUrl.protocol,
        hostname: targetUrl.hostname,
        port: targetUrl.port || (isHttps ? 443 : 80),
        method: req.method,
        path: requestPath,
        headers,
      };

      const proxyReq = isHttps
        ? https.request(requestOptions, handleProxyResponse)
        : http.request(requestOptions, handleProxyResponse);

      proxyReq.on('error', reject);
      req.on('error', reject);
      req.pipe(proxyReq);
    });
  }

  private createProxyHeaders(headers: IncomingHttpHeaders, targetUrl: URL, isUpgrade = false): IncomingHttpHeaders {
    const nextHeaders: IncomingHttpHeaders = {
      ...headers,
      host: targetUrl.host,
    };

    if (isUpgrade) {
      nextHeaders.connection = 'Upgrade';
    }

    return nextHeaders;
  }

  private resolveTarget(rawUrl: string, config: ProxyPreviewConfig): string {
    const pathname = this.getPathname(rawUrl);
    const matchedRule = this.matchRule(pathname, config.rules);

    if (matchedRule?.proxyStatic) {
      return matchedRule.target;
    }

    if (this.isStaticResource(pathname) || this.isDevServerInternalPath(pathname)) {
      return config.frontend;
    }

    if (matchedRule) {
      return matchedRule.target;
    }

    return config.frontend;
  }

  private matchRule(pathname: string, rules: ProxyRule[]): ProxyRule | undefined {
    return rules.find((rule) => {
      const rulePath = this.normalizeRulePath(rule.path);

      return pathname === rulePath || pathname.startsWith(`${rulePath}/`);
    });
  }

  private isStaticResource(pathname: string): boolean {
    const ext = pathname.match(/(\.[a-zA-Z0-9]+)$/)?.[1]?.toLowerCase();

    return !!ext && DEFAULT_STATIC_EXTENSIONS.has(ext);
  }

  private isDevServerInternalPath(pathname: string): boolean {
    return DEFAULT_DEV_SERVER_PATHS.some((prefix) => {
      return pathname === prefix || pathname.startsWith(`${prefix}/`);
    });
  }

  private getPathname(rawUrl: string): string {
    try {
      return new URL(rawUrl, 'http://127.0.0.1').pathname;
    } catch {
      return '/';
    }
  }

  private getProxyRequestPath(rawUrl: string, targetUrl: URL): string {
    const sourceUrl = new URL(rawUrl, 'http://127.0.0.1');
    const basePath = targetUrl.pathname.replace(/\/+$/, '');
    const requestPath = `${sourceUrl.pathname}${sourceUrl.search}`;

    if (!basePath) return requestPath;

    return `${basePath}${requestPath}`;
  }

  private normalizeConfig(config: ProxyPreviewConfig): ProxyPreviewConfig {
    return {
      frontend: this.normalizeOrigin(config.frontend || 'http://localhost:5173'),
      port: Number(config.port || 8899),
      rules: Array.isArray(config.rules)
        ? config.rules
            .filter((rule) => rule.path && rule.target)
            .map((rule) => ({
              id: rule.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
              path: this.normalizeRulePath(rule.path),
              target: this.normalizeOrigin(rule.target),
              changeOrigin: rule.changeOrigin !== false,
              proxyStatic: !!rule.proxyStatic,
            }))
        : [],
    };
  }

  private normalizeOrigin(value: string): string {
    const url = new URL(String(value || '').trim());
    const pathname = url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, '');

    return `${url.protocol}//${url.host}${pathname}`;
  }

  private normalizeRulePath(value: string): string {
    const rulePath = String(value || '').trim();

    if (!rulePath) return '/';

    return `/${rulePath.replace(/^\/+/, '').replace(/\/+$/, '')}`;
  }
}
