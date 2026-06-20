import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';

export class LocalProxyServerService {
  private server: http.Server | null = null;

  public port = 0;

  private currentTargetOrigin = '';
  private currentPageUrl = '';

  private readonly routeTargetMap = new Map<string, string>();
  private readonly routeBaseMap = new Map<string, string>();
  private readonly MAX_ROUTE_CACHE_SIZE = 3000;

  public start(): Promise<number> {
    return new Promise((resolve, reject) => {
      if (this.server) {
        resolve(this.port);
        return;
      }

      this.server = http.createServer(this.handleRequest.bind(this));

      this.server.on('error', error => {
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

  public async getProxyUrl(rawUrl: string): Promise<string> {
    const port = await this.start();

    return `http://127.0.0.1:${port}/?url=${encodeURIComponent(rawUrl)}`;
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

  private getOrigin(targetUrl: URL): string {
    return `${targetUrl.protocol}//${targetUrl.host}`;
  }

  private clearRouteCache(): void {
    this.routeTargetMap.clear();
    this.routeBaseMap.clear();
  }

  private trimRouteCacheIfNeeded(): void {
    if (this.routeTargetMap.size <= this.MAX_ROUTE_CACHE_SIZE) return;

    const removeCount = Math.ceil(this.MAX_ROUTE_CACHE_SIZE / 3);

    Array.from(this.routeTargetMap.keys())
      .slice(0, removeCount)
      .forEach(key => {
        this.routeTargetMap.delete(key);
      });

    Array.from(this.routeBaseMap.keys())
      .slice(0, removeCount)
      .forEach(key => {
        this.routeBaseMap.delete(key);
      });
  }

  private isLikelyPageUrl(targetUrl: URL): boolean {
    const pathname = targetUrl.pathname.toLowerCase();

    if (!pathname || pathname === '/') return true;
    if (pathname.endsWith('/')) return true;

    return !/\.[a-z0-9]+$/i.test(pathname);
  }

  private rememberTargetRoute(
    targetUrlStr: string,
    options?: {
      isPage?: boolean;
    },
  ): void {
    try {
      const targetUrl = new URL(targetUrlStr);

      if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') {
        return;
      }

      const targetOrigin = this.getOrigin(targetUrl);
      const isPage =
        options && options.isPage === true
          ? true
          : this.isLikelyPageUrl(targetUrl);

      if (isPage) {
        if (
          this.currentTargetOrigin &&
          this.currentTargetOrigin !== targetOrigin
        ) {
          this.clearRouteCache();
        }

        this.currentTargetOrigin = targetOrigin;
        this.currentPageUrl = targetUrl.href;
      }

      const routePath = this.normalizeRoutePath(targetUrl.pathname || '/');
      const routeDir = this.getDirPath(routePath);

      this.routeTargetMap.set(routePath, targetUrl.href);
      this.routeBaseMap.set(routeDir, new URL('./', targetUrl.href).href);

      if (isPage) {
        this.routeBaseMap.set('/', `${targetOrigin}/`);
      }

      this.trimRouteCacheIfNeeded();
    } catch {
      // ignore
    }
  }

  private resolveTargetByReferer(req: http.IncomingMessage): string | null {
    const referer = req.headers.referer || req.headers.referrer;

    if (!referer || Array.isArray(referer)) {
      return null;
    }

    try {
      const refUrl = new URL(referer);
      const parentTarget = refUrl.searchParams.get('url');

      if (!parentTarget) return null;

      return new URL(req.url || '/', parentTarget).href;
    } catch {
      return null;
    }
  }

  private resolveTargetByKnownRoute(reqUrl: URL): string | null {
    const routePath = this.normalizeRoutePath(reqUrl.pathname || '/');
    const exactTarget = this.routeTargetMap.get(routePath);

    if (exactTarget) {
      try {
        const url = new URL(exactTarget);

        if (
          this.currentTargetOrigin &&
          this.getOrigin(url) !== this.currentTargetOrigin
        ) {
          this.routeTargetMap.delete(routePath);
        } else {
          if (reqUrl.search) {
            url.search = reqUrl.search;
          }

          return url.href;
        }
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
        const baseUrl = new URL(baseTarget);

        if (
          prefix === '/' &&
          this.currentTargetOrigin &&
          this.getOrigin(baseUrl) !== this.currentTargetOrigin
        ) {
          this.routeBaseMap.delete(prefix);
          continue;
        }

        const restPath = routePath.slice(prefix.length);
        const nextUrl = new URL(restPath + reqUrl.search, baseTarget);

        return nextUrl.href;
      } catch {
        // continue
      }
    }

    if (this.currentTargetOrigin) {
      try {
        return new URL(
          routePath + reqUrl.search,
          `${this.currentTargetOrigin}/`,
        ).href;
      } catch {
        return null;
      }
    }

    return null;
  }

  private resolveTargetUrl(req: http.IncomingMessage): string | null {
    const reqUrl = new URL(req.url || '/', `http://${req.headers.host}`);
    const directTarget = reqUrl.searchParams.get('url');

    if (directTarget) {
      const targetUrl = new URL(directTarget);
      const isPage = this.isLikelyPageUrl(targetUrl);

      this.rememberTargetRoute(directTarget, {
        isPage,
      });

      return directTarget;
    }

    const refererTarget = this.resolveTargetByReferer(req);

    if (refererTarget) {
      const targetUrl = new URL(refererTarget);

      this.rememberTargetRoute(refererTarget, {
        isPage: this.isLikelyPageUrl(targetUrl),
      });

      return refererTarget;
    }

    const knownRouteTarget = this.resolveTargetByKnownRoute(reqUrl);

    if (knownRouteTarget) {
      const targetUrl = new URL(knownRouteTarget);

      this.rememberTargetRoute(knownRouteTarget, {
        isPage: this.isLikelyPageUrl(targetUrl),
      });

      return knownRouteTarget;
    }

    if (this.currentTargetOrigin) {
      try {
        const cleanPath = req.url?.startsWith('/') ? req.url : `/${req.url}`;
        const resolved = new URL(cleanPath, `${this.currentTargetOrigin}/`).href;
        const resolvedUrl = new URL(resolved);

        this.rememberTargetRoute(resolved, {
          isPage: this.isLikelyPageUrl(resolvedUrl),
        });

        return resolved;
      } catch {
        return null;
      }
    }

    return null;
  }

  private rewriteCookieHeader(cookie: string): string {
    return cookie
      .replace(/;\s*Secure/gi, '')
      .replace(/;\s*SameSite=None/gi, '')
      .replace(/;\s*SameSite=Strict/gi, '')
      .replace(/;\s*SameSite=Lax/gi, '');
  }

  private patchResponseHeaders(
    headers: http.IncomingHttpHeaders,
  ): http.OutgoingHttpHeaders {
    const nextHeaders: http.OutgoingHttpHeaders = {
      ...headers,
    };

    delete nextHeaders['x-frame-options'];
    delete nextHeaders['content-security-policy'];
    delete nextHeaders['content-security-policy-report-only'];
    delete nextHeaders['strict-transport-security'];
    delete nextHeaders['content-length'];
    delete nextHeaders['content-encoding'];

    nextHeaders['access-control-allow-origin'] = '*';
    nextHeaders['access-control-allow-methods'] =
      'GET,POST,PUT,PATCH,DELETE,OPTIONS';
    nextHeaders['access-control-allow-headers'] = '*';

    const setCookie = nextHeaders['set-cookie'];

    if (Array.isArray(setCookie)) {
      nextHeaders['set-cookie'] = setCookie.map(cookie => {
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

  private createProxyUrl(rawUrl: string, baseUrl: string): string {
    if (this.port <= 0) return rawUrl;

    try {
      if (!rawUrl) return rawUrl;

      if (/^(javascript|mailto|tel|data|blob):/i.test(rawUrl)) {
        return rawUrl;
      }

      if (rawUrl.startsWith('#')) {
        return rawUrl;
      }

      const proxyOrigin = `http://127.0.0.1:${this.port}`;

      if (rawUrl.startsWith(`${proxyOrigin}/`)) {
        return rawUrl;
      }

      const absoluteUrl = new URL(rawUrl, baseUrl).href;

      return `${proxyOrigin}/?url=${encodeURIComponent(absoluteUrl)}`;
    } catch {
      return rawUrl;
    }
  }

  private rewriteHtmlResourceUrls(html: string, targetUrl: URL): string {
    const baseUrl = targetUrl.href;

    return html.replace(
      /\s(src|href|action)=("([^"]*)"|'([^']*)')/gi,
      (
        _match: string,
        attrName: string,
        wrappedValue: string,
        doubleValue: string,
        singleValue: string,
      ) => {
        const rawValue =
          typeof doubleValue === 'string' ? doubleValue : singleValue;

        if (!rawValue) {
          return ` ${attrName}=${wrappedValue}`;
        }

        const nextValue = this.createProxyUrl(rawValue, baseUrl);
        const quote = wrappedValue.startsWith("'") ? "'" : '"';

        return ` ${attrName}=${quote}${nextValue}${quote}`;
      },
    );
  }

  private injectNavigationPatch(html: string): string {
    if (!html) return html;

    if (html.includes('data-quick-ops-navigation-patch="true"')) {
      return html;
    }

    const proxyOrigin =
      this.port > 0 ? `http://127.0.0.1:${this.port}` : '';

    const escapedProxyOrigin = this.escapeScriptString(proxyOrigin);

    const script = `
<script data-quick-ops-navigation-patch="true">
(function () {
  var proxyOrigin = \`${escapedProxyOrigin}\`;

  function toProxyUrl(url) {
    try {
      if (!url || !proxyOrigin) return url;
      if (/^(javascript:|mailto:|tel:|data:|blob:)/i.test(url)) return url;
      if (url.indexOf(proxyOrigin + '/') === 0) return url;
      var absoluteUrl = new URL(url, window.location.href).href;
      return proxyOrigin + '/?url=' + encodeURIComponent(absoluteUrl);
    } catch (error) {
      return url;
    }
  }

  document.addEventListener('click', function (event) {
    var target = event.target;
    while (target && target.tagName !== 'A') {
      target = target.parentElement;
    }

    if (!target || !target.href) return;
    if (target.target === '_blank') return;

    event.preventDefault();
    window.location.href = toProxyUrl(target.getAttribute('href') || target.href);
  }, true);

  var rawOpen = window.open;
  window.open = function (url, target, features) {
    return rawOpen.call(window, toProxyUrl(url), target, features);
  };
})();
</script>
`;

    if (/<\/head>/i.test(html)) {
      return html.replace(/<\/head>/i, `${script}</head>`);
    }

    if (/<\/body>/i.test(html)) {
      return html.replace(/<\/body>/i, `${script}</body>`);
    }

    return `${script}${html}`;
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
        const absoluteUrl = new URL(
          publicPath,
          `${targetUrl.protocol}//${targetUrl.host}/`,
        ).href;

        return `http://127.0.0.1:${this.port}/?url=${encodeURIComponent(absoluteUrl)}`;
      }

      const absoluteUrl = new URL(publicPath, targetUrl.href);

      return `http://127.0.0.1:${this.port}/?url=${encodeURIComponent(absoluteUrl.href)}`;
    } catch {
      return publicPath;
    }
  }

  private patchWebpackPublicPath(scriptText: string, targetUrl: URL): string {
    let nextText = scriptText;

    nextText = nextText.replace(
      /(\b[a-zA-Z_$][\w$]*\.p\s*=\s*)(["'])(\/[^"']*)\2/g,
      (_match, prefix: string, quote: string, publicPath: string) => {
        const proxyPublicPath = this.createProxyPublicPath(publicPath, targetUrl);

        return `${prefix}${quote}${proxyPublicPath}${quote}`;
      },
    );

    nextText = nextText.replace(
      /(\b__webpack_require__\.p\s*=\s*)(["'])(\/[^"']*)\2/g,
      (_match, prefix: string, quote: string, publicPath: string) => {
        const proxyPublicPath = this.createProxyPublicPath(publicPath, targetUrl);

        return `${prefix}${quote}${proxyPublicPath}${quote}`;
      },
    );

    return nextText;
  }

  private patchRequestHeaders(
    req: http.IncomingMessage,
    targetUrl: URL,
  ): http.OutgoingHttpHeaders {
    const headers: http.OutgoingHttpHeaders = {
      ...req.headers,
    };

    headers.host = targetUrl.host;
    headers['accept-encoding'] = 'identity';

    if (headers.origin) {
      headers.origin = this.getOrigin(targetUrl);
    }

    if (headers.referer && typeof headers.referer === 'string') {
      try {
        if (headers.referer.includes('?url=')) {
          const refUrl = new URL(headers.referer);
          const realReferer = refUrl.searchParams.get('url');

          if (realReferer) {
            headers.referer = realReferer;
          }
        } else if (this.currentTargetOrigin) {
          headers.referer = this.currentPageUrl || `${this.currentTargetOrigin}/`;
        }
      } catch {
        headers.referer = `${this.getOrigin(targetUrl)}/`;
      }
    }

    return headers;
  }

  private handleOptionsRequest(res: http.ServerResponse): void {
    this.safeSend(
      res,
      204,
      {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
        'access-control-allow-headers': '*',
      },
      '',
    );
  }

  private collectResponseBody(
    proxyRes: http.IncomingMessage,
    onDone: (body: Buffer) => void,
    onError: (error: Error) => void,
  ): void {
    const chunks: Buffer[] = [];

    proxyRes.on('data', chunk => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    proxyRes.on('end', () => {
      onDone(Buffer.concat(chunks));
    });

    proxyRes.on('error', onError);
  }

  private sendBufferedResponse(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    proxyRes: http.IncomingMessage,
    targetUrl: URL,
    patchedHeaders: http.OutgoingHttpHeaders,
  ): void {
    const isHtml = this.isHtmlResponse(proxyRes.headers);
    const isScript =
      this.isScriptLikeUrl(targetUrl) || this.isJavascriptResponse(proxyRes.headers);
    const isCss = this.isCssLikeUrl(targetUrl);

    if (isHtml || isCss || isScript) {
      this.collectResponseBody(
        proxyRes,
        body => {
          if (res.writableEnded || res.destroyed) return;

          if (isHtml) {
            const html = body.toString('utf8');
            const rewrittenHtml = this.rewriteHtmlResourceUrls(html, targetUrl);
            const patchedHtml = this.injectNavigationPatch(rewrittenHtml);

            patchedHeaders['content-type'] =
              proxyRes.headers['content-type'] || 'text/html; charset=utf-8';

            this.safeSend(
              res,
              proxyRes.statusCode || 200,
              patchedHeaders,
              patchedHtml,
            );

            return;
          }

          if (isScript) {
            const text = body.toString('utf8');
            const patchedText = this.patchWebpackPublicPath(text, targetUrl);

            patchedHeaders['content-type'] =
              proxyRes.headers['content-type'] ||
              'application/javascript; charset=utf-8';

            this.safeSend(
              res,
              proxyRes.statusCode || 200,
              patchedHeaders,
              patchedText,
            );

            return;
          }

          this.safeSend(res, proxyRes.statusCode || 200, patchedHeaders, body);
        },
        () => {
          this.safeSend(res, 302, { location: targetUrl.href }, '');
        },
      );

      return;
    }

    if (!this.safeWriteHead(res, proxyRes.statusCode || 200, patchedHeaders)) {
      proxyRes.resume();
      return;
    }

    proxyRes.pipe(res);
  }

  private handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): void {
    let targetUrlStr: string | null = null;

    try {
      if (req.method === 'OPTIONS') {
        this.handleOptionsRequest(res);
        return;
      }

      targetUrlStr = this.resolveTargetUrl(req);

      if (!targetUrlStr) {
        if (req.url && /^(http|https):\/\//i.test(req.url)) {
          this.safeSend(res, 302, { location: req.url }, '');
          return;
        }

        this.safeSend(
          res,
          400,
          {
            'content-type': 'text/plain; charset=utf-8',
          },
          'Missing target URL',
        );

        return;
      }

      const targetUrl = new URL(targetUrlStr);
      const requestModule = targetUrl.protocol === 'https:' ? https : http;
      const headers = this.patchRequestHeaders(req, targetUrl);

      if (!headers['user-agent']) {
        headers['user-agent'] =
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
      }

      const options: http.RequestOptions | https.RequestOptions = {
        protocol: targetUrl.protocol,
        hostname: targetUrl.hostname,
        port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
        path: `${targetUrl.pathname}${targetUrl.search}`,
        method: req.method,
        headers,
        family: 4,
        timeout: 15000,
      };

      const proxyReq = requestModule.request(options, proxyRes => {
        if (res.writableEnded || res.destroyed) {
          proxyRes.resume();
          return;
        }

        if (
          proxyRes.statusCode &&
          proxyRes.statusCode >= 502 &&
          proxyRes.statusCode <= 504
        ) {
          this.safeSend(res, 302, { location: targetUrlStr as string }, '');
          proxyRes.resume();
          return;
        }

        const patchedHeaders = this.patchResponseHeaders(proxyRes.headers);
        const location = proxyRes.headers.location;

        if (location) {
          const redirectUrl = new URL(location, targetUrlStr as string).href;

          this.rememberTargetRoute(redirectUrl, {
            isPage: this.isLikelyPageUrl(new URL(redirectUrl)),
          });

          patchedHeaders.location = `/?url=${encodeURIComponent(redirectUrl)}`;

          this.safeSend(res, proxyRes.statusCode || 302, patchedHeaders, '');
          proxyRes.resume();
          return;
        }

        if (this.isHtmlResponse(proxyRes.headers) && this.isLikelyPageUrl(targetUrl)) {
          this.currentPageUrl = targetUrl.href;
        }

        this.sendBufferedResponse(req, res, proxyRes, targetUrl, patchedHeaders);
      });

      proxyReq.on('timeout', () => {
        proxyReq.destroy(new Error('ProxyTimeout'));
      });

      proxyReq.on('error', () => {
        if (res.headersSent || res.writableEnded || res.destroyed) {
          return;
        }

        this.safeSend(res, 302, { location: targetUrlStr as string }, '');
      });

      req.on('aborted', () => {
        proxyReq.destroy();
      });

      res.on('close', () => {
        if (!res.writableEnded) {
          proxyReq.destroy();
        }
      });

      if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
        req.pipe(proxyReq);
      } else {
        proxyReq.end();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (targetUrlStr && !res.headersSent && !res.writableEnded && !res.destroyed) {
        this.safeSend(res, 302, { location: targetUrlStr }, '');
      } else if (!res.headersSent) {
        this.safeSend(
          res,
          500,
          {
            'content-type': 'text/plain; charset=utf-8',
          },
          `Proxy Internal Error: ${message}`,
        );
      }
    }
  }

  private safeWriteHead(
    res: http.ServerResponse,
    statusCode: number,
    headers?: http.OutgoingHttpHeaders,
  ): boolean {
    if (res.headersSent || res.writableEnded || res.destroyed) {
      return false;
    }

    res.writeHead(statusCode, headers);

    return true;
  }

  private safeEnd(res: http.ServerResponse, body?: string | Buffer): void {
    if (res.writableEnded || res.destroyed) {
      return;
    }

    res.end(body);
  }

  private safeSend(
    res: http.ServerResponse,
    statusCode: number,
    headers: http.OutgoingHttpHeaders,
    body?: string | Buffer,
  ): void {
    if (!this.safeWriteHead(res, statusCode, headers)) {
      return;
    }

    this.safeEnd(res, body);
  }

  private escapeScriptString(value: string): string {
    return value
      .replace(/\\/g, '\\\\')
      .replace(/`/g, '\\`')
      .replace(/\$/g, '\\$')
      .replace(/<\/script>/gi, '<\\/script>');
  }
}