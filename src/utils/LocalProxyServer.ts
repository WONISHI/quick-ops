import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';

type ProxyRewriteMode = 'runtime' | 'static' | 'raw';

export class LocalProxyServer {
  private server: http.Server | null = null;

  public port: number = 0;

  private currentTargetOrigin = '';

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

      this.server.on('error', (error) => {
        reject(error);
      });

      this.server.listen(0, '127.0.0.1', () => {
        const address = this.server && this.server.address();

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

  private getProxyOrigin(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  private isBlockedTelemetryUrl(rawUrl: string): boolean {
    try {
      const url = new URL(rawUrl, this.getProxyOrigin());
      const host = url.hostname.toLowerCase();
      const pathname = url.pathname.toLowerCase();

      return (
        pathname === '/cdn-cgi/rum' ||
        pathname.startsWith('/cdn-cgi/rum?') ||
        (host === 'cloudflareinsights.com' && pathname === '/cdn-cgi/rum') ||
        (host.endsWith('.cloudflareinsights.com') && pathname === '/cdn-cgi/rum')
      );
    } catch {
      return false;
    }
  }

  private writeNoContentResponse(res: http.ServerResponse): void {
    if (!this.canWriteResponse(res)) return;

    try {
      if (!res.headersSent) {
        res.writeHead(204, {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
          'access-control-allow-headers': '*',
          'access-control-max-age': '86400',
        });
      }

      res.end();
    } catch {
      // ignore
    }
  }

  private getRewriteMode(targetUrlStr: string): ProxyRewriteMode {
    try {
      const url = new URL(targetUrlStr);
      const host = url.hostname.toLowerCase();

      /**
       * Ant Design Vue 文档站：
       * Vue / VitePress / SSR 页面，不注入 runtime patch。
       */
      if (host === 'www.antdv.com' || host === 'antdv.com') {
        return 'static';
      }

      /**
       * Ant Design React 文档站：
       * Umi / Webpack 页面，需要 runtime patch 修复动态 chunk。
       */
      if (host === 'ant.design' || host === 'www.ant.design') {
        return 'runtime';
      }

      /**
       * 默认保留 runtime 逻辑。
       */
      return 'runtime';
    } catch {
      return 'runtime';
    }
  }

  private canWriteResponse(res: http.ServerResponse): boolean {
    return !res.writableEnded && !res.destroyed;
  }

  private writeTextResponse(res: http.ServerResponse, statusCode: number, message: string): void {
    if (!this.canWriteResponse(res)) return;

    try {
      if (!res.headersSent) {
        res.writeHead(statusCode, {
          'content-type': 'text/plain; charset=utf-8',
        });
      }

      res.end(message);
    } catch {
      // response 可能已经被 pipe 或 end，忽略二次写入错误
    }
  }

  private writeProxyError(res: http.ServerResponse, statusCode: number, message: string): void {
    this.writeTextResponse(res, statusCode, message);
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

      /**
       * 精确路径映射：
       * /assets/index.js => https://www.antdv.com/assets/index.js
       */
      this.routeTargetMap.set(routePath, targetUrl.href);

      /**
       * 目录路径映射：
       * /assets/ => https://www.antdv.com/assets/
       */
      this.routeBaseMap.set(routeDir, new URL('./', targetUrl.href).href);

      /**
       * 根目录兜底：
       * /umi.xxx.js、/xxx-async.js 等根目录 chunk。
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

  private toProxyUrl(targetUrlStr: string): string {
    const targetUrl = new URL(targetUrlStr);

    this.rememberTargetRoute(targetUrl.href);

    const proxyPath = targetUrl.pathname || '/';

    /**
     * 保留 pathname。
     *
     * https://www.antdv.com/assets/index.js
     * =>
     * http://127.0.0.1:port/assets/index.js?url=https%3A%2F%2Fwww.antdv.com%2Fassets%2Findex.js
     */
    return `${this.getProxyOrigin()}${proxyPath}?url=${encodeURIComponent(targetUrl.href)}`;
  }

  private isSkippableResourceUrl(rawUrl: string): boolean {
    const url = String(rawUrl || '').trim();

    if (!url) return true;

    return (
      url.startsWith('#') ||
      /^data:/i.test(url) ||
      /^blob:/i.test(url) ||
      /^mailto:/i.test(url) ||
      /^tel:/i.test(url) ||
      /^javascript:/i.test(url) ||
      /^vscode-webview-resource:/i.test(url) ||
      /^vscode-resource:/i.test(url) ||
      /^vscode-webview:/i.test(url)
    );
  }

  private resolveResourceUrl(rawUrl: string, baseUrl: string): string | null {
    const value = String(rawUrl || '').trim();

    if (this.isSkippableResourceUrl(value)) return null;

    try {
      if (value.startsWith('//')) {
        const base = new URL(baseUrl);
        return `${base.protocol}${value}`;
      }

      return new URL(value, baseUrl).href;
    } catch {
      return null;
    }
  }

  private resolveTargetUrl(req: http.IncomingMessage): string | null {
    const reqUrl = new URL(req.url || '/', `http://${req.headers.host}`);

    /**
     * 本地无效上报接口，直接交给 handleRequest 返回 204。
     */
    if (reqUrl.pathname === '/__quick_ops_blocked__' || this.isBlockedTelemetryUrl(reqUrl.href)) {
      return `${this.getProxyOrigin()}${reqUrl.pathname}${reqUrl.search}`;
    }

    /**
     * 标准入口：
     *
     * /components/overview-cn/?url=https://www.antdv.com/components/overview-cn/
     */
    const directTarget = reqUrl.searchParams.get('url');

    if (directTarget) {
      this.rememberTargetRoute(directTarget);
      return directTarget;
    }

    /**
     * 优先使用 referer 中的真实页面地址。
     *
     * 这是修复 antdv / element-plus / ant.design 串站的关键：
     * /assets/index.js 这类路径很多站点都有，如果先走全局 routeBaseMap，
     * 很容易把 https://www.antdv.com/assets/index.js 错解析成 https://ant.design/assets/index.js。
     */
    const referer = req.headers.referer || req.headers.referrer;

    if (referer && !Array.isArray(referer)) {
      try {
        const refUrl = new URL(referer);
        const parentTarget = refUrl.searchParams.get('url');

        if (parentTarget) {
          const resolved = new URL(req.url || '/', parentTarget).href;

          this.rememberTargetRoute(resolved);

          return resolved;
        }
      } catch {
        // ignore and fallback to known routes
      }
    }

    /**
     * 无 referer 或 referer 不完整时，再走已知路由兜底。
     */
    const knownRouteTarget = this.resolveTargetByKnownRoute(reqUrl);

    if (knownRouteTarget) {
      this.rememberTargetRoute(knownRouteTarget);
      return knownRouteTarget;
    }

    if (referer && !Array.isArray(referer)) {
      try {
        const refUrl = new URL(referer);

        if (this.currentTargetOrigin) {
          return new URL(refUrl.pathname + refUrl.search, `${this.currentTargetOrigin}/`).href;
        }
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

  private patchResponseHeaders(headers: http.IncomingHttpHeaders): http.OutgoingHttpHeaders {
    const nextHeaders: http.OutgoingHttpHeaders = { ...headers };

    delete nextHeaders['x-frame-options'];
    delete nextHeaders['content-security-policy'];
    delete nextHeaders['content-security-policy-report-only'];
    delete nextHeaders['strict-transport-security'];

    /**
     * HTML/CSS 会被改写，所以删除长度和编码。
     */
    delete nextHeaders['content-length'];
    delete nextHeaders['content-encoding'];

    nextHeaders['access-control-allow-origin'] = '*';
    nextHeaders['access-control-allow-methods'] = 'GET,POST,PUT,PATCH,DELETE,OPTIONS';
    nextHeaders['access-control-allow-headers'] = '*';

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

  private isCssResponse(headers: http.IncomingHttpHeaders, targetUrl: URL): boolean {
    const contentType = String(headers['content-type'] || '').toLowerCase();
    const pathname = targetUrl.pathname.toLowerCase();

    return contentType.includes('text/css') || pathname.endsWith('.css');
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

  private rewriteHtmlResourceAttrs(html: string, baseUrl: string): string {
    return html.replace(
      /\s(src|href|poster|action)\s*=\s*(['"])([^'"]*)\2/gi,
      (match, attr: string, quote: string, value: string) => {
        const absoluteUrl = this.resolveResourceUrl(value, baseUrl);

        if (!absoluteUrl) return match;

        return ` ${attr}=${quote}${this.toProxyUrl(absoluteUrl)}${quote}`;
      }
    );
  }

  private rewriteSrcset(html: string, baseUrl: string): string {
    return html.replace(
      /\s(srcset)\s*=\s*(['"])([^'"]*)\2/gi,
      (match, attr: string, quote: string, value: string) => {
        const rewritten = value
          .split(',')
          .map((item) => {
            const trimmed = item.trim();

            if (!trimmed) return trimmed;

            const parts = trimmed.split(/\s+/);
            const rawUrl = parts.shift() || '';
            const absoluteUrl = this.resolveResourceUrl(rawUrl, baseUrl);

            if (!absoluteUrl) return trimmed;

            return [this.toProxyUrl(absoluteUrl), ...parts].join(' ');
          })
          .join(', ');

        return ` ${attr}=${quote}${rewritten}${quote}`;
      }
    );
  }

  private rewriteStyleUrls(content: string, baseUrl: string): string {
    return content.replace(
      /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi,
      (match, quote: string, value: string) => {
        const absoluteUrl = this.resolveResourceUrl(value, baseUrl);

        if (!absoluteUrl) return match;

        return `url(${quote}${this.toProxyUrl(absoluteUrl)}${quote})`;
      }
    );
  }

  private rewriteCssImports(css: string, baseUrl: string): string {
    return css.replace(
      /@import\s+(['"])([^'"]+)\1/gi,
      (match, quote: string, value: string) => {
        const absoluteUrl = this.resolveResourceUrl(value, baseUrl);

        if (!absoluteUrl) return match;

        return `@import ${quote}${this.toProxyUrl(absoluteUrl)}${quote}`;
      }
    );
  }

  /**
   * runtime 模式脚本。
   *
   * 只给 ant.design / Umi / Webpack 这类页面使用。
   * antdv.com 不会执行这里。
   */
  private createRuntimeProxyPatchScript(targetUrlStr: string): string {
    const safeTarget = JSON.stringify(targetUrlStr);
    const safeProxyOrigin = JSON.stringify(this.getProxyOrigin());

    return `
<script>
(function() {
  var targetBase = ${safeTarget};
  var proxyOrigin = ${safeProxyOrigin};

  function isCrossFrameAccessError(value) {
    var text = '';

    try {
      if (value && value.message) {
        text = String(value.message);
      } else {
        text = String(value || '');
      }
    } catch (e) {
      text = '';
    }

    return (
      /Blocked a frame with origin/i.test(text) ||
      /cross-origin frame/i.test(text) ||
      /Failed to read a named property/i.test(text) ||
      /Permission denied to access property/i.test(text)
    );
  }

  window.addEventListener('error', function(event) {
    if (isCrossFrameAccessError(event && (event.error || event.message))) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return false;
    }
  }, true);

  window.addEventListener('unhandledrejection', function(event) {
    if (isCrossFrameAccessError(event && event.reason)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return false;
    }
  }, true);

  var rawOnError = window.onerror;

  window.onerror = function(message, source, lineno, colno, error) {
    if (isCrossFrameAccessError(error || message)) {
      return true;
    }

    if (typeof rawOnError === 'function') {
      return rawOnError.apply(this, arguments);
    }

    return false;
  };

  function shouldSkip(rawUrl) {
    var url = String(rawUrl || '').trim();

    return (
      !url ||
      url.indexOf('#') === 0 ||
      /^data:/i.test(url) ||
      /^blob:/i.test(url) ||
      /^mailto:/i.test(url) ||
      /^tel:/i.test(url) ||
      /^javascript:/i.test(url) ||
      /^vscode-webview-resource:/i.test(url) ||
      /^vscode-resource:/i.test(url) ||
      /^vscode-webview:/i.test(url)
    );
  }

  function isBlockedTelemetryUrl(rawUrl) {
    try {
      var url = new URL(String(rawUrl || ''), targetBase);
      var host = url.hostname.toLowerCase();
      var pathname = url.pathname.toLowerCase();

      return (
        pathname === '/cdn-cgi/rum' ||
        host === 'cloudflareinsights.com' && pathname === '/cdn-cgi/rum' ||
        /\.cloudflareinsights\.com$/i.test(host) && pathname === '/cdn-cgi/rum'
      );
    } catch (e) {
      return false;
    }
  }

  function toBlockedProxyUrl(rawUrl) {
    try {
      var absoluteUrl = new URL(String(rawUrl || ''), targetBase).href;
      return proxyOrigin + '/__quick_ops_blocked__?url=' + encodeURIComponent(absoluteUrl);
    } catch (e) {
      return proxyOrigin + '/__quick_ops_blocked__';
    }
  }

  function toProxyUrl(rawUrl) {
    if (shouldSkip(rawUrl)) return rawUrl;

    if (isBlockedTelemetryUrl(rawUrl)) return toBlockedProxyUrl(rawUrl);

    try {
      var raw = String(rawUrl || '');

      if (raw.indexOf(proxyOrigin) === 0) {
        return raw;
      }

      var absoluteUrl;

      if (raw.indexOf('//') === 0) {
        absoluteUrl = new URL(targetBase).protocol + raw;
      } else {
        absoluteUrl = new URL(raw, targetBase).href;
      }

      var urlObj = new URL(absoluteUrl);
      var path = urlObj.pathname || '/';

      return proxyOrigin + path + '?url=' + encodeURIComponent(urlObj.href);
    } catch (e) {
      return rawUrl;
    }
  }

  function patchUrlProperty(proto, prop) {
    try {
      var descriptor = Object.getOwnPropertyDescriptor(proto, prop);

      if (!descriptor || !descriptor.set || !descriptor.get) return;

      Object.defineProperty(proto, prop, {
        configurable: true,
        enumerable: descriptor.enumerable,
        get: function() {
          return descriptor.get.call(this);
        },
        set: function(value) {
          return descriptor.set.call(this, toProxyUrl(value));
        }
      });
    } catch (e) {
      // ignore
    }
  }

  patchUrlProperty(HTMLScriptElement.prototype, 'src');
  patchUrlProperty(HTMLLinkElement.prototype, 'href');
  patchUrlProperty(HTMLImageElement.prototype, 'src');

  if (window.HTMLIFrameElement) {
    patchUrlProperty(HTMLIFrameElement.prototype, 'src');
  }

  if (window.HTMLSourceElement) {
    patchUrlProperty(HTMLSourceElement.prototype, 'src');
  }

  if (window.HTMLVideoElement) {
    patchUrlProperty(HTMLVideoElement.prototype, 'poster');
  }

  var rawSetAttribute = Element.prototype.setAttribute;

  Element.prototype.setAttribute = function(name, value) {
    var attrName = String(name || '').toLowerCase();

    if (
      attrName === 'src' ||
      attrName === 'href' ||
      attrName === 'poster' ||
      attrName === 'action'
    ) {
      value = toProxyUrl(value);
    }

    return rawSetAttribute.call(this, name, value);
  };

  var rawFetch = window.fetch;

  if (rawFetch) {
    window.fetch = function(input, init) {
      try {
        var rawUrl = typeof input === 'string' ? input : input && input.url;

        if (isBlockedTelemetryUrl(rawUrl)) {
          return Promise.resolve(new Response('', { status: 204, statusText: 'No Content' }));
        }

        if (typeof input === 'string') {
          input = toProxyUrl(input);
        } else if (input && input.url) {
          input = new Request(toProxyUrl(input.url), input);
        }
      } catch (e) {
        // ignore
      }

      return rawFetch.call(this, input, init);
    };
  }

  var rawOpen = XMLHttpRequest.prototype.open;

  XMLHttpRequest.prototype.open = function(method, url) {
    if (typeof url === 'string') {
      url = isBlockedTelemetryUrl(url) ? toBlockedProxyUrl(url) : toProxyUrl(url);
      arguments[1] = url;
    }

    return rawOpen.apply(this, arguments);
  };

  var rawSendBeacon = navigator.sendBeacon;

  if (rawSendBeacon) {
    navigator.sendBeacon = function(url, data) {
      if (isBlockedTelemetryUrl(url)) {
        return true;
      }

      return rawSendBeacon.call(navigator, toProxyUrl(url), data);
    };
  }

  window.__QUICK_OPS_PROXY_URL__ = toProxyUrl;
})();
</script>`;
  }

  private createNavigationScript(targetUrlStr: string): string {
    const safeTarget = JSON.stringify(targetUrlStr);

    return `
<script>
(function() {
  var targetStr = ${safeTarget};

  function notifyParent(url, isSpa) {
    window.parent.postMessage({
      type: 'inner-nav',
      url: url,
      isSpa: !!isSpa
    }, '*');
  }

  var rawOpen = window.open;

  window.open = function(url) {
    if (url) {
      notifyParent(new URL(url, targetStr).href, false);
      return null;
    }

    return rawOpen.apply(window, arguments);
  };

  document.addEventListener('click', function(e) {
    var target = e.target;

    if (!target || !target.closest) return;

    var a = target.closest('a');

    if (!a) return;

    var href = a.getAttribute('href');

    if (
      !href ||
      href.indexOf('javascript:') === 0 ||
      href.indexOf('#') === 0 ||
      href.indexOf('mailto:') === 0 ||
      href.indexOf('tel:') === 0
    ) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    notifyParent(new URL(href, targetStr).href, false);
  }, true);

  document.addEventListener('submit', function(e) {
    var form = e.target;

    if (!form || !form.getAttribute) return;

    e.preventDefault();
    e.stopPropagation();

    var formData = new FormData(form);
    var params = new URLSearchParams();

    formData.forEach(function(value, key) {
      params.append(key, value);
    });

    var actionUrl = form.getAttribute('action') || '';
    var fullAction = new URL(actionUrl, targetStr);
    var method = String(form.method || 'get').toLowerCase();

    if (method !== 'post') {
      var existingParams = new URLSearchParams(fullAction.search);

      params.forEach(function(value, key) {
        existingParams.set(key, value);
      });

      fullAction.search = existingParams.toString();

      notifyParent(fullAction.href, false);
      return;
    }

    form.target = '_self';
    form.submit();
  }, true);
})();
</script>`;
  }

  private injectScripts(html: string, targetUrlStr: string): string {
    const runtimePatchScript = this.createRuntimeProxyPatchScript(targetUrlStr);
    const navigationScript = this.createNavigationScript(targetUrlStr);

    if (/<head[^>]*>/i.test(html)) {
      html = html.replace(/<head([^>]*)>/i, `<head$1>\n${runtimePatchScript}`);
    } else {
      html = `${runtimePatchScript}\n${html}`;
    }

    if (/<\/body>/i.test(html)) {
      html = html.replace(/<\/body>/i, `${navigationScript}\n</body>`);
    } else {
      html += navigationScript;
    }

    return html;
  }

  private rewriteHtml(htmlBuffer: Buffer, targetUrlStr: string): Buffer {
    const mode = this.getRewriteMode(targetUrlStr);

    if (mode === 'raw') {
      return htmlBuffer;
    }

    let html = htmlBuffer.toString('utf8');

    /**
     * Cloudflare Web Analytics/RUM 在代理环境下只会产生 CORS/404 噪音，直接移除。
     */
    html = html.replace(/<script\b[^>]*src=["'][^"']*(?:cloudflareinsights\.com|\/cdn-cgi\/rum)[^"']*["'][^>]*>\s*<\/script>/gi, '');

    /**
     * antdv.com / VitePress SSR：不能改写 HTML 结构。
     *
     * Vue hydration 会严格按服务端 HTML 节点顺序补水。
     * 对 script/link/href/src 做静态替换虽然通常可用，但在 antdv 这类页面里
     * 会触发 nextSibling 为 null 的补水异常。
     *
     * 所以 static 模式只移除遥测脚本，不改写资源标签。
     * /assets/... 这类请求会通过 referer 里的 ?url= 自动还原到真实站点。
     */
    if (mode === 'static') {
      return Buffer.from(html, 'utf8');
    }

    /**
     * runtime 模式才做静态资源改写 + 注入运行时代理补丁。
     */
    html = this.rewriteHtmlResourceAttrs(html, targetUrlStr);
    html = this.rewriteSrcset(html, targetUrlStr);
    html = this.rewriteStyleUrls(html, targetUrlStr);

    html = this.injectScripts(html, targetUrlStr);

    return Buffer.from(html, 'utf8');
  }

  private rewriteCss(cssBuffer: Buffer, targetUrlStr: string): Buffer {
    let css = cssBuffer.toString('utf8');

    css = this.rewriteStyleUrls(css, targetUrlStr);
    css = this.rewriteCssImports(css, targetUrlStr);

    return Buffer.from(css, 'utf8');
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    let targetUrlStr: string | null = null;

    try {
      targetUrlStr = this.resolveTargetUrl(req);

      if (req.method === 'OPTIONS') {
        this.writeNoContentResponse(res);
        return;
      }

      if (targetUrlStr && (targetUrlStr.startsWith(this.getProxyOrigin()) || this.isBlockedTelemetryUrl(targetUrlStr))) {
        this.writeNoContentResponse(res);
        return;
      }

      if (!targetUrlStr) {
        console.warn('[QuickOps Proxy Missing Target]', {
          requestUrl: req.url,
          referer: req.headers.referer,
          currentTargetOrigin: this.currentTargetOrigin,
          knownRouteCount: this.routeTargetMap.size,
          knownBaseCount: this.routeBaseMap.size,
        });

        this.writeProxyError(res, 400, 'Missing target URL');
        return;
      }

      const targetUrl = new URL(targetUrlStr);
      const requestModule = targetUrl.protocol === 'https:' ? https : http;

      const headers: http.OutgoingHttpHeaders = {
        ...req.headers,
      };

      headers.host = targetUrl.host;
      headers['accept-encoding'] = 'identity';

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

        const location = proxyRes.headers.location;

        if (location) {
          const redirectUrl = new URL(location, targetUrlStr as string).href;

          this.rememberTargetRoute(redirectUrl);

          patchedHeaders.location = this.toProxyUrl(redirectUrl);

          if (this.canWriteResponse(res)) {
            res.writeHead(proxyRes.statusCode || 302, patchedHeaders);
            res.end();
          }

          return;
        }

        const isHtml = this.isHtmlResponse(proxyRes.headers);
        const isCss = this.isCssResponse(proxyRes.headers, targetUrl);
        const isScript = this.isScriptLikeUrl(targetUrl);

        if (isScript && isHtml) {
          console.warn('[QuickOps Proxy MIME Warning]', {
            requestUrl: req.url,
            targetUrl: targetUrl.href,
            statusCode: proxyRes.statusCode,
            contentType: proxyRes.headers['content-type'],
            referer: req.headers.referer,
            currentTargetOrigin: this.currentTargetOrigin,
            mode: this.getRewriteMode(targetUrl.href),
          });
        }

        if (isHtml || isCss) {
          this.collectResponseBody(
            proxyRes,
            (body) => {
              if (!this.canWriteResponse(res)) return;

              let nextBody = body;

              if (isHtml) {
                patchedHeaders['content-type'] = 'text/html; charset=utf-8';
                nextBody = this.rewriteHtml(body, targetUrlStr as string);

                console.log('[QuickOps Proxy Mode]', {
                  targetUrl: targetUrlStr,
                  mode: this.getRewriteMode(targetUrlStr as string),
                });
              } else if (isCss) {
                patchedHeaders['content-type'] = patchedHeaders['content-type'] || 'text/css; charset=utf-8';
                nextBody = this.rewriteCss(body, targetUrlStr as string);
              }

              res.writeHead(proxyRes.statusCode || 200, patchedHeaders);
              res.end(nextBody);
            },
            (error) => {
              console.warn('[QuickOps Proxy Read Failed]', {
                requestUrl: req.url,
                targetUrl: targetUrlStr,
                message: error.message,
                headersSent: res.headersSent,
                writableEnded: res.writableEnded,
              });

              this.writeProxyError(res, 502, `Proxy Read Failed: ${error.message}`);
            }
          );

          return;
        }

        if (!this.canWriteResponse(res)) return;

        res.writeHead(proxyRes.statusCode || 200, patchedHeaders);

        proxyRes.on('error', (error) => {
          console.warn('[QuickOps Proxy Pipe Failed]', {
            requestUrl: req.url,
            targetUrl: targetUrlStr,
            message: error.message,
            headersSent: res.headersSent,
            writableEnded: res.writableEnded,
          });

          this.writeProxyError(res, 502, `Proxy Pipe Failed: ${error.message}`);
        });

        proxyRes.pipe(res);
      });

      proxyReq.on('error', (error) => {
        console.warn('[QuickOps Proxy Request Failed]', {
          requestUrl: req.url,
          targetUrl: targetUrlStr,
          message: error.message,
          headersSent: res.headersSent,
          writableEnded: res.writableEnded,
        });

        this.writeProxyError(res, 502, `Proxy Request Failed: ${error.message}`);
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

      this.writeProxyError(res, 500, `Proxy Internal Error: ${message}`);
    }
  }
}