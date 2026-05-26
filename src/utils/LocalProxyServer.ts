import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';

export class LocalProxyServer {
  private server: http.Server | null = null;

  public port: number = 0;

  /**
   * 当前预览页面的 origin。
   *
   * 例如：
   *   https://www.antdv.com
   *   https://cn.bing.com
   */
  private currentTargetOrigin: string = '';

  /**
   * 当前页面地址。
   *
   * 例如：
   *   https://www.antdv.com/components/overview-cn/
   *   https://cn.bing.com/search?q=baidu
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

  private clearRouteCache(): void {
    this.routeTargetMap.clear();
    this.routeBaseMap.clear();
  }

  private getOrigin(targetUrl: URL): string {
    return `${targetUrl.protocol}//${targetUrl.host}`;
  }

  private rememberTargetRoute(targetUrlStr: string, options?: { isPage?: boolean }): void {
    try {
      const targetUrl = new URL(targetUrlStr);

      if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') {
        return;
      }

      const targetOrigin = this.getOrigin(targetUrl);
      const isPage = options?.isPage === true || this.isLikelyPageUrl(targetUrl);

      /**
       * 关键修复：
       *
       * 只有页面主请求才能切换 currentTargetOrigin。
       * 如果页面从 ant.design 切到 cn.bing.com，必须清空旧缓存，
       * 否则 /rp/xxx.js 会继续命中旧的 ant.design 路径映射。
       */
      if (isPage) {
        if (this.currentTargetOrigin && this.currentTargetOrigin !== targetOrigin) {
          this.clearRouteCache();
        }

        this.currentTargetOrigin = targetOrigin;
        this.currentPageUrl = targetUrl.href;
      }

      const routePath = this.normalizeRoutePath(targetUrl.pathname || '/');
      const routeDir = this.getDirPath(routePath);

      this.routeTargetMap.set(routePath, targetUrl.href);
      this.routeBaseMap.set(routeDir, new URL('./', targetUrl.href).href);

      /**
       * 根路径兜底只能由页面主请求设置。
       *
       * 不能让 JS/CSS/图片资源设置 /，
       * 否则访问 r.bing.com、ant.design 这类资源后，
       * 后续 /rp/xxx.css 就可能被错误解析到别的域名。
       */
      if (isPage) {
        this.routeBaseMap.set('/', `${targetOrigin}/`);
      }

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

        /**
         * 如果精确缓存属于旧页面 origin，直接丢弃。
         *
         * 例如：
         *   当前页面是 cn.bing.com
         *   旧缓存里还有 /rp/xxx.js => https://ant.design/rp/xxx.js
         */
        if (this.currentTargetOrigin && this.getOrigin(url) !== this.currentTargetOrigin) {
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

        /**
         * 根路径映射必须跟当前页面 origin 一致。
         * 其他更具体的资源目录可以保留，例如：
         *   /rs/ => https://r.bing.com/rs/
         */
        if (prefix === '/' && this.currentTargetOrigin && this.getOrigin(baseUrl) !== this.currentTargetOrigin) {
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
     * /?url=https://cn.bing.com/search?q=baidu
     */
    const directTarget = reqUrl.searchParams.get('url');

    if (directTarget) {
      const targetUrl = new URL(directTarget);
      const isPage = this.isLikelyPageUrl(targetUrl);

      this.rememberTargetRoute(directTarget, { isPage });

      return directTarget;
    }

    /**
     * 无 ?url= 的资源请求：
     *
     * /assets/index.js
     * /assets/style.css
     * /rp/xxx.css
     */
    const knownRouteTarget = this.resolveTargetByKnownRoute(reqUrl);

    if (knownRouteTarget) {
      const targetUrl = new URL(knownRouteTarget);

      this.rememberTargetRoute(knownRouteTarget, {
        isPage: this.isLikelyPageUrl(targetUrl),
      });

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
      const resolvedUrl = new URL(resolved);

      this.rememberTargetRoute(resolved, {
        isPage: this.isLikelyPageUrl(resolvedUrl),
      });

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

  private escapeScriptString(value: string): string {
    return value
      .replace(/\\/g, '\\\\')
      .replace(/`/g, '\\`')
      .replace(/\$/g, '\\$')
      .replace(/<\/script>/gi, '<\\/script>');
  }

  private injectNavigationPatch(html: string): string {
    if (!html) return html;

    if (html.includes('data-quick-ops-navigation-patch="true"')) {
      return html;
    }

    const proxyOrigin = this.port > 0 ? `http://127.0.0.1:${this.port}` : '';
    const escapedProxyOrigin = this.escapeScriptString(proxyOrigin);

    const script = `
<script data-quick-ops-navigation-patch="true">
(function () {
  var proxyOrigin = \`${escapedProxyOrigin}\`;

  function isSpecialUrl(url) {
    return !url ||
      url.indexOf('javascript:') === 0 ||
      url.indexOf('mailto:') === 0 ||
      url.indexOf('tel:') === 0 ||
      url.indexOf('data:') === 0 ||
      url.indexOf('blob:') === 0 ||
      url.indexOf('#') === 0;
  }

  function isProxyUrl(url) {
    return proxyOrigin && url.indexOf(proxyOrigin + '/') === 0;
  }

  function normalizeUrl(url) {
    try {
      return new URL(url, window.location.href).href;
    } catch (e) {
      return url;
    }
  }

  function toProxyUrl(url) {
    var absoluteUrl = normalizeUrl(String(url || ''));

    if (!proxyOrigin) return absoluteUrl;

    if (isProxyUrl(absoluteUrl)) {
      return absoluteUrl;
    }

    return proxyOrigin + '/?url=' + encodeURIComponent(absoluteUrl);
  }

  function patchAnchor(anchor) {
    if (!anchor || !anchor.getAttribute) return;

    var href = anchor.getAttribute('href');

    if (!href || isSpecialUrl(href)) return;

    var absoluteUrl = normalizeUrl(href);

    if (!absoluteUrl || isProxyUrl(absoluteUrl)) return;

    anchor.setAttribute('data-quick-ops-raw-href', absoluteUrl);
    anchor.setAttribute('href', toProxyUrl(absoluteUrl));

    var target = anchor.getAttribute('target');

    if (target && target.toLowerCase() === '_blank') {
      anchor.setAttribute('target', '_self');
    }
  }

  function patchForm(form) {
    if (!form || !form.getAttribute) return;

    var action = form.getAttribute('action') || window.location.href;

    if (!action || isSpecialUrl(action)) return;

    var absoluteUrl = normalizeUrl(action);

    if (!absoluteUrl || isProxyUrl(absoluteUrl)) return;

    form.setAttribute('data-quick-ops-raw-action', absoluteUrl);
    form.setAttribute('action', toProxyUrl(absoluteUrl));

    var target = form.getAttribute('target');

    if (target && target.toLowerCase() === '_blank') {
      form.setAttribute('target', '_self');
    }
  }

  function patchStaticLinks() {
    var anchors = document.querySelectorAll('a[href]');

    for (var i = 0; i < anchors.length; i++) {
      patchAnchor(anchors[i]);
    }

    var forms = document.querySelectorAll('form');

    for (var j = 0; j < forms.length; j++) {
      patchForm(forms[j]);
    }
  }

  var rawOpen = window.open;

  window.open = function (url) {
    if (!url || isSpecialUrl(String(url))) {
      return rawOpen ? rawOpen.apply(window, arguments) : null;
    }

    window.location.href = toProxyUrl(String(url));

    return null;
  };

  document.addEventListener('click', function (event) {
    var target = event.target;

    while (target && target.tagName !== 'A') {
      target = target.parentElement;
    }

    if (!target) return;

    var rawHref = target.getAttribute('data-quick-ops-raw-href');
    var href = rawHref || target.getAttribute('href');

    if (!href || isSpecialUrl(href)) return;

    var nextUrl = toProxyUrl(href);

    if (target.getAttribute('href') !== nextUrl) {
      target.setAttribute('href', nextUrl);
    }

    var targetAttr = target.getAttribute('target');

    if (targetAttr && targetAttr.toLowerCase() === '_blank') {
      target.setAttribute('target', '_self');
    }

    event.preventDefault();
    event.stopPropagation();

    window.location.href = nextUrl;
  }, true);

  document.addEventListener('submit', function (event) {
    var form = event.target;

    if (!form || form.tagName !== 'FORM') return;

    var method = (form.getAttribute('method') || 'get').toLowerCase();
    var rawAction = form.getAttribute('data-quick-ops-raw-action');
    var action = rawAction || form.getAttribute('action') || window.location.href;

    if (!action || isSpecialUrl(action)) return;

    if (method !== 'get') {
      patchForm(form);
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    var formData = new FormData(form);
    var actionUrl = normalizeUrl(action);
    var targetUrl;

    try {
      targetUrl = new URL(actionUrl);
    } catch (e) {
      window.location.href = toProxyUrl(actionUrl);
      return;
    }

    formData.forEach(function (value, key) {
      targetUrl.searchParams.set(key, String(value));
    });

    window.location.href = toProxyUrl(targetUrl.href);
  }, true);

  document.addEventListener('DOMContentLoaded', function () {
    patchStaticLinks();

    var observer = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var mutation = mutations[i];

        for (var j = 0; j < mutation.addedNodes.length; j++) {
          var node = mutation.addedNodes[j];

          if (!node || node.nodeType !== 1) continue;

          if (node.tagName === 'A') {
            patchAnchor(node);
          } else if (node.tagName === 'FORM') {
            patchForm(node);
          } else if (node.querySelectorAll) {
            var anchors = node.querySelectorAll('a[href]');

            for (var a = 0; a < anchors.length; a++) {
              patchAnchor(anchors[a]);
            }

            var forms = node.querySelectorAll('form');

            for (var f = 0; f < forms.length; f++) {
              patchForm(forms[f]);
            }
          }
        }
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  });

  patchStaticLinks();
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
        const absoluteUrl = new URL(publicPath, `${targetUrl.protocol}//${targetUrl.host}/`).href;
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
          if (isHtml) {
            const html = body.toString('utf8');
            const patchedHtml = this.injectNavigationPatch(html);

            patchedHeaders['content-type'] = proxyRes.headers['content-type'] || 'text/html; charset=utf-8';

            res.writeHead(proxyRes.statusCode || 200, patchedHeaders);
            res.end(patchedHtml);
            return;
          }

          if (isScript) {
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

  private patchRequestHeaders(req: http.IncomingMessage, targetUrl: URL): http.OutgoingHttpHeaders {
    const headers: http.OutgoingHttpHeaders = {
      ...req.headers,
    };

    headers.host = targetUrl.host;
    headers['accept-encoding'] = 'identity';

    if (headers.origin && typeof headers.origin === 'string') {
      try {
        const originUrl = new URL(headers.origin);

        if (originUrl.hostname === '127.0.0.1' || originUrl.hostname === 'localhost') {
          headers.origin = this.getOrigin(targetUrl);
        }
      } catch {
        delete headers.origin;
      }
    }

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

    return headers;
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
      const headers = this.patchRequestHeaders(req, targetUrl);

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

        const location = proxyRes.headers.location;

        if (location) {
          const redirectUrl = new URL(location, targetUrlStr as string).href;

          this.rememberTargetRoute(redirectUrl, {
            isPage: this.isLikelyPageUrl(new URL(redirectUrl)),
          });

          patchedHeaders.location = `/?url=${encodeURIComponent(redirectUrl)}`;

          res.writeHead(proxyRes.statusCode || 302, patchedHeaders);
          res.end();
          return;
        }

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