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
   */
  private currentTargetOrigin: string = '';

  /**
   * 当前页面地址。
   *
   * 例如：
   *   https://www.antdv.com/components/overview-cn/
   */
  private currentPageUrl: string = '';

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
        const address = this.server ? this.server.address() : null;

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
    this.currentPageUrl = '';
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

  private isLikelyPageUrl(targetUrl: URL): boolean {
    const pathname = targetUrl.pathname.toLowerCase();

    if (!pathname || pathname === '/') return true;

    if (pathname.endsWith('/')) return true;

    return !/\.[a-z0-9]+$/i.test(pathname);
  }

  private rememberTargetRoute(targetUrlStr: string): void {
    try {
      const targetUrl = new URL(targetUrlStr);

      if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') {
        return;
      }

      this.currentTargetOrigin = `${targetUrl.protocol}//${targetUrl.host}`;

      if (this.isLikelyPageUrl(targetUrl)) {
        this.currentPageUrl = targetUrl.href;
      }

      const routePath = this.normalizeRoutePath(targetUrl.pathname || '/');
      const routeDir = this.getDirPath(routePath);

      this.routeTargetMap.set(routePath, targetUrl.href);
      this.routeBaseMap.set(routeDir, new URL('./', targetUrl.href).href);

      /**
       * 根路径兜底。
       *
       * 注意：
       * 这里仍然保留，因为很多站点资源就是从根路径加载。
       * 但是动态 chunk 的 publicPath 会在 JS 内容里被修正，
       * 避免浏览器直接访问：
       *
       *   http://127.0.0.1:port/vendors_xxx.js
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
     * 内容可能会被代理修正，所以必须删除 content-length。
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

  private isJavascriptResponse(headers: http.IncomingHttpHeaders): boolean {
    const contentType = String(headers['content-type'] || '').toLowerCase();

    return (
      contentType.includes('javascript') ||
      contentType.includes('ecmascript') ||
      contentType.includes('application/x-javascript') ||
      contentType.includes('text/js')
    );
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

  private createProxyPublicPath(publicPath: string, targetUrl: URL): string {
    if (this.port <= 0) return publicPath;

    try {
      if (/^https?:\/\//i.test(publicPath)) {
        return `http://127.0.0.1:${this.port}/?url=${encodeURIComponent(publicPath)}`;
      }

      if (publicPath.startsWith('//')) {
        const protocolUrl = `${targetUrl.protocol}${publicPath}`;
        return `http://127.0.0.1:${this.port}/?url=${encodeURIComponent(protocolUrl)}`;
      }

      if (publicPath.startsWith('/')) {
        const absoluteUrl = new URL(publicPath, `${targetUrl.protocol}//${targetUrl.host}/`).href;
        return `http://127.0.0.1:${this.port}/?url=${encodeURIComponent(absoluteUrl)}`;
      }

      const absoluteUrl = new URL(publicPath, targetUrl.href).href;

      return `http://127.0.0.1:${this.port}/?url=${encodeURIComponent(absoluteUrl)}`;
    } catch {
      return publicPath;
    }
  }

  private patchWebpackPublicPath(scriptText: string, targetUrl: URL): string {
    let nextText = scriptText;

    /**
     * 修复 webpack / umi 动态 chunk publicPath。
     *
     * 原始代码常见形式：
     *   o.p="/"
     *   r.p="/"
     *   __webpack_require__.p="/"
     *
     * 如果不修正，浏览器会请求：
     *   http://127.0.0.1:port/vendors_2-async.xxx.js
     *
     * 代理可能会拿到 HTML fallback，导致：
     *   Uncaught SyntaxError: Unexpected token '<'
     */
    nextText = nextText.replace(
      /(\b[a-zA-Z_$][\w$]*\.p\s*=\s*)(["'])(\/[^"']*)\2/g,
      (_match, prefix: string, quote: string, publicPath: string) => {
        const proxyPublicPath = this.createProxyPublicPath(publicPath, targetUrl);

        return `${prefix}${quote}${proxyPublicPath}${quote}`;
      }
    );

    nextText = nextText.replace(
      /(\b__webpack_require__\.p\s*=\s*)(["'])(\/[^"']*)\2/g,
      (_match, prefix: string, quote: string, publicPath: string) => {
        const proxyPublicPath = this.createProxyPublicPath(publicPath, targetUrl);

        return `${prefix}${quote}${proxyPublicPath}${quote}`;
      }
    );

    return nextText;
  }

  private shouldPatchJavascript(proxyRes: http.IncomingMessage, targetUrl: URL): boolean {
    if (this.isScriptLikeUrl(targetUrl)) return true;

    return this.isJavascriptResponse(proxyRes.headers);
  }

  private sendBufferedResponse(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    proxyRes: http.IncomingMessage,
    targetUrl: URL,
    patchedHeaders: http.OutgoingHttpHeaders
  ): void {
    const isHtml = this.isHtmlResponse(proxyRes.headers);
    const isScript = this.shouldPatchJavascript(proxyRes, targetUrl);

    /**
     * JS 请求却拿到 HTML，说明资源路径被还原错了，
     * 或目标站 fallback 到 index.html。
     *
     * 这里不能继续把 HTML 当 JS 返回，否则浏览器会报：
     *   Unexpected token '<'
     */
    if (this.isScriptLikeUrl(targetUrl) && isHtml) {
      console.warn('[QuickOps Proxy MIME Warning]', {
        requestUrl: req.url,
        targetUrl: targetUrl.href,
        statusCode: proxyRes.statusCode,
        contentType: proxyRes.headers['content-type'],
        referer: req.headers.referer,
        currentTargetOrigin: this.currentTargetOrigin,
        currentPageUrl: this.currentPageUrl,
      });
    }

    if (isHtml || this.isCssLikeUrl(targetUrl) || isScript) {
      this.collectResponseBody(
        proxyRes,
        (body) => {
          if (isScript && !isHtml) {
            const charset = String(proxyRes.headers['content-type'] || '').toLowerCase().includes('charset=')
              ? undefined
              : '; charset=utf-8';

            const text = body.toString('utf8');
            const patchedText = this.patchWebpackPublicPath(text, targetUrl);

            patchedHeaders['content-type'] = proxyRes.headers['content-type'] || `application/javascript${charset || ''}`;

            res.writeHead(proxyRes.statusCode || 200, patchedHeaders);
            res.end(patchedText);
            return;
          }

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
          currentPageUrl: this.currentPageUrl,
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
       * 禁用压缩，方便后续对 JS runtime 做 publicPath 修正。
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

        /**
         * 如果当前响应是页面，记录当前页面地址。
         */
        if (this.isHtmlResponse(proxyRes.headers) && this.isLikelyPageUrl(targetUrl)) {
          this.currentPageUrl = targetUrl.href;
        }

        this.sendBufferedResponse(req, res, proxyRes, targetUrl, patchedHeaders);
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
        currentPageUrl: this.currentPageUrl,
        message,
      });

      res.writeHead(500, {
        'content-type': 'text/plain; charset=utf-8',
      });

      res.end(`Proxy Internal Error: ${message}`);
    }
  }
}