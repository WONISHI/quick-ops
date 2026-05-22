import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';

export class LocalProxyServer {
  private server: http.Server | null = null;

  public port: number = 0;

  /**
   * 当前预览站点的 origin。
   *
   * 例如：
   *   https://www.antdv.com
   *
   * 当浏览器请求：
   *   http://127.0.0.1:port/assets/index.js
   *
   * 没有 ?url= 时，就用 currentTargetOrigin 还原成：
   *   https://www.antdv.com/assets/index.js
   */
  private currentTargetOrigin: string = '';

  /**
   * 精确路径映射：
   *
   * /assets/index.js
   * => https://www.antdv.com/assets/index.js
   */
  private readonly routeTargetMap = new Map<string, string>();

  /**
   * 目录路径映射：
   *
   * /assets/
   * => https://www.antdv.com/assets/
   */
  private readonly routeBaseMap = new Map<string, string>();

  private readonly MAX_ROUTE_CACHE_SIZE = 3000;

  public start(): Promise<number> {
    return new Promise((resolve, reject) => {
      if (this.server) {
        resolve(this.port);
        return;
      }

      this.server = http.createServer(this.handleRequest.bind(this));

      this.server.on('error', (error) => {
        reject(error);
      });

      this.server.listen(0, '127.0.0.1', () => {
        const address = this.server?.address();

        if (!address || typeof address === 'string') {
          reject(new Error('Local proxy server address is invalid.'));
          return;
        }

        this.port = address.port;
        resolve(this.port);
      });
    });
  }

  public stop(): void {
    if (!this.server) return;

    this.server.close();
    this.server = null;
    this.port = 0;

    this.currentTargetOrigin = '';
    this.routeTargetMap.clear();
    this.routeBaseMap.clear();
  }

  private normalizeRoutePath(pathname: string): string {
    if (!pathname) return '/';

    return pathname.startsWith('/') ? pathname : `/${pathname}`;
  }

  private getDirPath(pathname: string): string {
    const normalized = this.normalizeRoutePath(pathname);

    if (normalized === '/') return '/';

    const index = normalized.lastIndexOf('/');

    if (index <= 0) return '/';

    return normalized.slice(0, index + 1);
  }

  private trimRouteCacheIfNeeded(): void {
    if (this.routeTargetMap.size <= this.MAX_ROUTE_CACHE_SIZE) return;

    const removeCount = Math.ceil(this.MAX_ROUTE_CACHE_SIZE / 3);

    Array.from(this.routeTargetMap.keys())
      .slice(0, removeCount)
      .forEach((key) => {
        this.routeTargetMap.delete(key);
      });

    Array.from(this.routeBaseMap.keys())
      .slice(0, removeCount)
      .forEach((key) => {
        this.routeBaseMap.delete(key);
      });
  }

  private rememberTargetRoute(targetUrlStr: string): void {
    try {
      const targetUrl = new URL(targetUrlStr);

      if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') {
        return;
      }

      this.currentTargetOrigin = `${targetUrl.protocol}//${targetUrl.host}`;

      const routePath = this.normalizeRoutePath(targetUrl.pathname || '/');
      const routeDir = this.getDirPath(routePath);

      this.routeTargetMap.set(routePath, targetUrl.href);
      this.routeBaseMap.set(routeDir, new URL('./', targetUrl.href).href);

      /**
       * 根路径兜底。
       *
       * 这对 VitePress / Umi / Webpack chunk 很重要。
       *
       * 例如：
       *   /assets/index.js
       *   /6efcc5cd-async.js
       */
      this.routeBaseMap.set('/', `${targetUrl.protocol}//${targetUrl.host}/`);

      this.trimRouteCacheIfNeeded();
    } catch {
      // ignore
    }
  }

  private resolveTargetByKnownRoute(reqUrl: URL): string | null {
    const routePath = this.normalizeRoutePath(reqUrl.pathname || '/');

    const exactTarget = this.routeTargetMap.get(routePath);

    if (exactTarget) {
      try {
        const url = new URL(exactTarget);

        if (reqUrl.search) {
          url.search = reqUrl.search;
        }

        return url.href;
      } catch {
        return exactTarget;
      }
    }

    const sortedPrefixes = Array.from(this.routeBaseMap.keys()).sort((a, b) => {
      return b.length - a.length;
    });

    for (const prefix of sortedPrefixes) {
      if (!routePath.startsWith(prefix)) continue;

      const baseTarget = this.routeBaseMap.get(prefix);

      if (!baseTarget) continue;

      try {
        const restPath = routePath.slice(prefix.length);
        const nextUrl = new URL(restPath + reqUrl.search, baseTarget);

        return nextUrl.href;
      } catch {
        // continue
      }
    }

    /**
     * 最后兜底：使用当前页面 origin 解析。
     *
     * 这一步解决 HTML 原样返回后，浏览器直接请求：
     *
     *   http://127.0.0.1:port/assets/index.js
     *
     * 的情况。
     */
    if (this.currentTargetOrigin) {
      try {
        return new URL(routePath + reqUrl.search, `${this.currentTargetOrigin}/`).href;
      } catch {
        return null;
      }
    }

    return null;
  }

  private resolveTargetUrl(req: http.IncomingMessage): string | null {
    const reqUrl = new URL(req.url || '/', `http://${req.headers.host}`);

    /**
     * 标准入口：
     *
     * /?url=https://www.antdv.com/components/overview-cn/
     */
    const directTarget = reqUrl.searchParams.get('url');

    if (directTarget) {
      this.rememberTargetRoute(directTarget);
      return directTarget;
    }

    /**
     * 无 ?url= 的资源请求：
     *
     * /assets/index.js
     * /assets/style.css
     * /6efcc5cd-async.js
     */
    const knownRouteTarget = this.resolveTargetByKnownRoute(reqUrl);

    if (knownRouteTarget) {
      this.rememberTargetRoute(knownRouteTarget);
      return knownRouteTarget;
    }

    /**
     * referer 兜底。
     */
    const referer = req.headers.referer || req.headers.referrer;

    if (!referer || Array.isArray(referer)) {
      return null;
    }

    try {
      const refUrl = new URL(referer);
      const parentTarget = refUrl.searchParams.get('url');

      if (!parentTarget) {
        if (this.currentTargetOrigin) {
          return new URL(req.url || '/', `${this.currentTargetOrigin}/`).href;
        }

        return null;
      }

      const resolved = new URL(req.url || '/', parentTarget).href;

      this.rememberTargetRoute(resolved);

      return resolved;
    } catch {
      return null;
    }
  }

  private rewriteCookieHeader(cookie: string): string {
    return cookie
      .replace(/;\s*Secure/gi, '')
      .replace(/;\s*SameSite=None/gi, '')
      .replace(/;\s*SameSite=Strict/gi, '')
      .replace(/;\s*SameSite=Lax/gi, '');
  }

  private patchResponseHeaders(headers: http.IncomingHttpHeaders): http.OutgoingHttpHeaders {
    const nextHeaders: http.OutgoingHttpHeaders = { ...headers };

    /**
     * 允许 iframe 加载。
     */
    delete nextHeaders['x-frame-options'];
    delete nextHeaders['content-security-policy'];
    delete nextHeaders['content-security-policy-report-only'];
    delete nextHeaders['strict-transport-security'];

    /**
     * 注意：
     * 这版 HTML 不改写，所以理论上 content-length 可以保留。
     * 但为了避免某些站点返回压缩/转换后的长度不一致，这里仍删除。
     */
    delete nextHeaders['content-length'];

    /**
     * 上游请求会设置 accept-encoding: identity。
     */
    delete nextHeaders['content-encoding'];

    const setCookie = nextHeaders['set-cookie'];

    if (Array.isArray(setCookie)) {
      nextHeaders['set-cookie'] = setCookie.map((cookie) => {
        return this.rewriteCookieHeader(cookie);
      });
    } else if (typeof setCookie === 'string') {
      nextHeaders['set-cookie'] = this.rewriteCookieHeader(setCookie);
    }

    return nextHeaders;
  }

  private isHtmlResponse(headers: http.IncomingHttpHeaders): boolean {
    const contentType = String(headers['content-type'] || '').toLowerCase();

    return contentType.includes('text/html');
  }

  private isScriptLikeUrl(targetUrl: URL): boolean {
    const pathname = targetUrl.pathname.toLowerCase();

    return (
      pathname.endsWith('.js') ||
      pathname.endsWith('.mjs') ||
      pathname.endsWith('.cjs') ||
      pathname.endsWith('.jsx') ||
      pathname.endsWith('.ts') ||
      pathname.endsWith('.tsx')
    );
  }

  private isCssLikeUrl(targetUrl: URL): boolean {
    return targetUrl.pathname.toLowerCase().endsWith('.css');
  }

  private collectResponseBody(
    proxyRes: http.IncomingMessage,
    onDone: (body: Buffer) => void,
    onError: (error: Error) => void
  ): void {
    const chunks: Buffer[] = [];

    proxyRes.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    proxyRes.on('end', () => {
      onDone(Buffer.concat(chunks));
    });

    proxyRes.on('error', onError);
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    let targetUrlStr: string | null = null;

    try {
      targetUrlStr = this.resolveTargetUrl(req);

      if (!targetUrlStr) {
        console.warn('[QuickOps Proxy Missing Target]', {
          requestUrl: req.url,
          referer: req.headers.referer,
          currentTargetOrigin: this.currentTargetOrigin,
          knownRouteCount: this.routeTargetMap.size,
          knownBaseCount: this.routeBaseMap.size,
        });

        res.writeHead(400, {
          'content-type': 'text/plain; charset=utf-8',
        });

        res.end('Missing target URL');
        return;
      }

      const targetUrl = new URL(targetUrlStr);
      const requestModule = targetUrl.protocol === 'https:' ? https : http;

      const headers: http.OutgoingHttpHeaders = {
        ...req.headers,
      };

      /**
       * 关键：不要把 127.0.0.1 的 host 传给目标站。
       */
      headers.host = targetUrl.host;

      /**
       * HTML 原样返回，不再做文本改写。
       * 但为了稳定，仍然禁用压缩，避免后续 header 不匹配。
       */
      headers['accept-encoding'] = 'identity';

      /**
       * referer 尽量还原成真实目标地址。
       */
      if (headers.referer && typeof headers.referer === 'string') {
        try {
          const refUrl = new URL(headers.referer);
          const realReferer = refUrl.searchParams.get('url');

          if (realReferer) {
            headers.referer = realReferer;
          } else if (this.currentTargetOrigin) {
            headers.referer = new URL(refUrl.pathname + refUrl.search, `${this.currentTargetOrigin}/`).href;
          }
        } catch {
          delete headers.referer;
        }
      }

      const options: http.RequestOptions | https.RequestOptions = {
        protocol: targetUrl.protocol,
        hostname: targetUrl.hostname,
        port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
        path: `${targetUrl.pathname}${targetUrl.search}`,
        method: req.method,
        headers,
      };

      const proxyReq = requestModule.request(options, (proxyRes) => {
        const patchedHeaders = this.patchResponseHeaders(proxyRes.headers);

        /**
         * 重定向继续交给代理处理。
         */
        const location = proxyRes.headers.location;

        if (location) {
          const redirectUrl = new URL(location, targetUrlStr as string).href;

          this.rememberTargetRoute(redirectUrl);

          patchedHeaders.location = `/?url=${encodeURIComponent(redirectUrl)}`;

          res.writeHead(proxyRes.statusCode || 302, patchedHeaders);
          res.end();
          return;
        }

        const isHtml = this.isHtmlResponse(proxyRes.headers);

        /**
         * JS 请求却拿到 HTML，说明资源路径还是被还原错了，
         * 或目标站 fallback 到 index.html。
         */
        if (this.isScriptLikeUrl(targetUrl) && isHtml) {
          console.warn('[QuickOps Proxy MIME Warning]', {
            requestUrl: req.url,
            targetUrl: targetUrl.href,
            statusCode: proxyRes.statusCode,
            contentType: proxyRes.headers['content-type'],
            referer: req.headers.referer,
            currentTargetOrigin: this.currentTargetOrigin,
          });
        }

        /**
         * 这版不改写 HTML / CSS / JS 内容。
         *
         * 这样可以最大程度避免 Vue / VitePress SSR hydration DOM 不一致。
         */
        if (isHtml || this.isCssLikeUrl(targetUrl) || this.isScriptLikeUrl(targetUrl)) {
          this.collectResponseBody(
            proxyRes,
            (body) => {
              res.writeHead(proxyRes.statusCode || 200, patchedHeaders);
              res.end(body);
            },
            (error) => {
              res.writeHead(502, {
                'content-type': 'text/plain; charset=utf-8',
              });

              res.end(`Proxy Read Failed: ${error.message}`);
            }
          );

          return;
        }

        res.writeHead(proxyRes.statusCode || 200, patchedHeaders);
        proxyRes.pipe(res);
      });

      proxyReq.on('error', (error) => {
        res.writeHead(502, {
          'content-type': 'text/plain; charset=utf-8',
        });

        res.end(`Proxy Request Failed: ${error.message}`);
      });

      if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
        req.pipe(proxyReq);
      } else {
        proxyReq.end();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      console.error('[QuickOps Proxy Internal Error]', {
        requestUrl: req.url,
        targetUrl: targetUrlStr,
        currentTargetOrigin: this.currentTargetOrigin,
        message,
      });

      res.writeHead(500, {
        'content-type': 'text/plain; charset=utf-8',
      });

      res.end(`Proxy Internal Error: ${message}`);
    }
  }
}