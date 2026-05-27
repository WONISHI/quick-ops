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

  private rememberTargetRoute(targetUrlStr: string, options?: { isPage?: boolean }): void {
    try {
      const targetUrl = new URL(targetUrlStr);

      if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') {
        return;
      }

      const targetOrigin = this.getOrigin(targetUrl);
      const isPage = options && options.isPage === true ? true : this.isLikelyPageUrl(targetUrl);

      /**
       * 只有页面主请求才能切换 currentTargetOrigin。
       * 页面从 ant.design 切到 cn.bing.com 时，必须清空旧缓存。
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
       * 避免资源域名污染 / 映射。
       */
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

      if (!parentTarget) {
        return null;
      }

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
     * /?url=https://cn.bing.com/
     */
    const directTarget = reqUrl.searchParams.get('url');

    if (directTarget) {
      const targetUrl = new URL(directTarget);
      const isPage = this.isLikelyPageUrl(targetUrl);

      this.rememberTargetRoute(directTarget, { isPage });

      return directTarget;
    }

    /**
     * 优先使用 referer 里的真实页面地址。
     *
     * 这样：
     *   http://127.0.0.1:port/hp/api/v1/carousel
     *
     * 会根据 referer:
     *   http://127.0.0.1:port/?url=https://cn.bing.com/
     *
     * 还原成：
     *   https://cn.bing.com/hp/api/v1/carousel
     */
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

  private patchResponseHeaders(headers: http.IncomingHttpHeaders): http.OutgoingHttpHeaders {
    const nextHeaders: http.OutgoingHttpHeaders = { ...headers };

    delete nextHeaders['x-frame-options'];
    delete nextHeaders['content-security-policy'];
    delete nextHeaders['content-security-policy-report-only'];
    delete nextHeaders['strict-transport-security'];

    delete nextHeaders['content-length'];
    delete nextHeaders['content-encoding'];

    /**
     * 统一让代理资源允许被当前页面访问。
     */
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
      (_match: string, attrName: string, wrappedValue: string, doubleValue: string, singleValue: string) => {
        const rawValue = typeof doubleValue === 'string' ? doubleValue : singleValue;

        if (!rawValue) {
          return ` ${attrName}=${wrappedValue}`;
        }

        const nextValue = this.createProxyUrl(rawValue, baseUrl);
        const quote = wrappedValue.startsWith("'") ? "'" : '"';

        return ` ${attrName}=${quote}${nextValue}${quote}`;
      }
    );
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

  function getRealPageUrl() {
    try {
      var rawSearch = window.location.search || window.location.href.split('?')[1] || '';
      if (rawSearch.indexOf('#') > -1) {
        rawSearch = rawSearch.split('#')[0];
      }
      var params = new URLSearchParams(rawSearch);
      var realUrl = params.get('url');

      if (realUrl) return realUrl;
    } catch (e) {}

    return window.location.href;
  }

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
      return new URL(url, getRealPageUrl()).href;
    } catch (e) {
      return url;
    }
  }

  function toProxyUrl(url) {
    var rawStr = String(url || '');
    if (isSpecialUrl(rawStr)) return rawStr;
    
    if (isProxyUrl(rawStr)) return rawStr;

    try {
      var realPageUrl = getRealPageUrl();
      var realOrigin = new URL(realPageUrl).origin;
      
      var absoluteUrl;
      if (rawStr.indexOf('/') === 0 && rawStr.indexOf('//') !== 0) {
        absoluteUrl = realOrigin + rawStr;
      } else {
        absoluteUrl = new URL(rawStr, realPageUrl).href;
      }

      if (!proxyOrigin) return absoluteUrl;
      return proxyOrigin + '/?url=' + encodeURIComponent(absoluteUrl);
    } catch (e) {
      return rawStr;
    }
  }

  function shouldPatchAttr(attrName) {
    return attrName === 'src' || attrName === 'href' || attrName === 'action';
  }

  function patchElementAttr(element, attrName) {
    if (!element || !element.getAttribute || !shouldPatchAttr(attrName)) return;

    var value = element.getAttribute(attrName);

    if (!value || isSpecialUrl(value)) return;

    var nextValue = toProxyUrl(value);

    if (nextValue && value !== nextValue) {
      element.setAttribute('data-quick-ops-raw-' + attrName, normalizeUrl(value));
      element.setAttribute(attrName, nextValue);
    }
  }

  function patchElement(element) {
    if (!element || !element.getAttribute) return;

    patchElementAttr(element, 'src');
    patchElementAttr(element, 'href');
    patchElementAttr(element, 'action');

    var target = element.getAttribute('target');

    if (target && target.toLowerCase() === '_blank') {
      element.setAttribute('target', '_self');
    }
  }

  function patchTree(root) {
    if (!root || !root.querySelectorAll) {
      patchElement(root);
      return;
    }

    patchElement(root);

    var nodes = root.querySelectorAll('[src],[href],[action]');

    for (var i = 0; i < nodes.length; i++) {
      patchElement(nodes[i]);
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

  if (window.fetch) {
    var rawFetch = window.fetch;

    window.fetch = function (input, init) {
      try {
        if (typeof input === 'string') {
          input = toProxyUrl(input);
        } else if (input && input.url) {
          input = new Request(toProxyUrl(input.url), input);
        }
      } catch (e) {}

      return rawFetch.call(this, input, init);
    };
  }

  if (window.XMLHttpRequest) {
    var rawOpenXHR = window.XMLHttpRequest.prototype.open;

    window.XMLHttpRequest.prototype.open = function (method, url) {
      if (url && typeof url === 'string' && !isSpecialUrl(url)) {
        arguments[1] = toProxyUrl(url);
      }

      return rawOpenXHR.apply(this, arguments);
    };
  }

  var rawSetAttribute = Element.prototype.setAttribute;

  Element.prototype.setAttribute = function (name, value) {
    if (name && value && shouldPatchAttr(String(name).toLowerCase()) && !isSpecialUrl(String(value))) {
      value = toProxyUrl(String(value));
    }

    return rawSetAttribute.call(this, name, value);
  };

  var scriptSrcDescriptor = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src');

  if (scriptSrcDescriptor && scriptSrcDescriptor.set) {
    Object.defineProperty(HTMLScriptElement.prototype, 'src', {
      get: scriptSrcDescriptor.get,
      set: function (value) {
        return scriptSrcDescriptor.set.call(this, toProxyUrl(String(value || '')));
      }
    });
  }

  var linkHrefDescriptor = Object.getOwnPropertyDescriptor(HTMLLinkElement.prototype, 'href');

  if (linkHrefDescriptor && linkHrefDescriptor.set) {
    Object.defineProperty(HTMLLinkElement.prototype, 'href', {
      get: linkHrefDescriptor.get,
      set: function (value) {
        return linkHrefDescriptor.set.call(this, toProxyUrl(String(value || '')));
      }
    });
  }

  var rawAppendChild = Node.prototype.appendChild;

  Node.prototype.appendChild = function (node) {
    patchTree(node);

    return rawAppendChild.call(this, node);
  };

  var rawInsertBefore = Node.prototype.insertBefore;

  Node.prototype.insertBefore = function (node, referenceNode) {
    patchTree(node);

    return rawInsertBefore.call(this, node, referenceNode);
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

    target.setAttribute('href', nextUrl);

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
    var action = rawAction || form.getAttribute('action') || getRealPageUrl();

    if (!action || isSpecialUrl(action)) return;

    if (method !== 'get') {
      form.setAttribute('action', toProxyUrl(action));
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
    patchTree(document.documentElement);

    var observer = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var mutation = mutations[i];

        for (var j = 0; j < mutation.addedNodes.length; j++) {
          var node = mutation.addedNodes[j];

          if (!node || node.nodeType !== 1) continue;

          patchTree(node);
        }
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  });

  patchTree(document.documentElement);
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

  private safeWriteHead(res: http.ServerResponse, statusCode: number, headers?: http.OutgoingHttpHeaders): boolean {
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
    body?: string | Buffer
  ): void {
    if (!this.safeWriteHead(res, statusCode, headers)) {
      return;
    }

    this.safeEnd(res, body);
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
    const isCss = this.isCssLikeUrl(targetUrl);

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

    if (isHtml || isCss || isScript) {
      this.collectResponseBody(
        proxyRes,
        (body) => {
          if (res.writableEnded || res.destroyed) return;

          if (isHtml) {
            const html = body.toString('utf8');
            const rewrittenHtml = this.rewriteHtmlResourceUrls(html, targetUrl);
            const patchedHtml = this.injectNavigationPatch(rewrittenHtml);

            patchedHeaders['content-type'] = proxyRes.headers['content-type'] || 'text/html; charset=utf-8';

            this.safeSend(res, proxyRes.statusCode || 200, patchedHeaders, patchedHtml);
            return;
          }

          if (isScript) {
            const charset = String(proxyRes.headers['content-type'] || '').toLowerCase().includes('charset=')
              ? undefined
              : '; charset=utf-8';

            const text = body.toString('utf8');
            const patchedText = this.patchWebpackPublicPath(text, targetUrl);

            patchedHeaders['content-type'] = proxyRes.headers['content-type'] || `application/javascript${charset || ''}`;

            this.safeSend(res, proxyRes.statusCode || 200, patchedHeaders, patchedText);
            return;
          }

          this.safeSend(res, proxyRes.statusCode || 200, patchedHeaders, body);
        },
        (error) => {
          // 渲染中途发生读取错误，同样降级抛给浏览器原地址
          console.warn(`[QuickOps Proxy Fallback] Body read failed, redirecting to: ${targetUrl.href}`);
          this.safeSend(res, 302, { location: targetUrl.href }, '');
        }
      );

      return;
    }

    if (!this.safeWriteHead(res, proxyRes.statusCode || 200, patchedHeaders)) {
      proxyRes.resume();
      return;
    }

    proxyRes.pipe(res);
  }

  private patchRequestHeaders(req: http.IncomingMessage, targetUrl: URL): http.OutgoingHttpHeaders {
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
      ''
    );
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    let targetUrlStr: string | null = null;

    try {
      if (req.method === 'OPTIONS') {
        this.handleOptionsRequest(res);
        return;
      }

      targetUrlStr = this.resolveTargetUrl(req);

      // 💡 降级策略 1：如果是根本无法通过内部路由推断出的请求，但它携带了绝对路径，直接抛 302 让浏览器请求
      if (!targetUrlStr) {
        if (req.url && (req.url.startsWith('http://') || req.url.startsWith('https://'))) {
           this.safeSend(res, 302, { location: req.url }, '');
           return;
        }

        console.warn('[QuickOps Proxy Missing Target]', { requestUrl: req.url });
        this.safeSend(res, 400, { 'content-type': 'text/plain; charset=utf-8' }, 'Missing target URL');
        return;
      }

      const targetUrl = new URL(targetUrlStr);
      const requestModule = targetUrl.protocol === 'https:' ? https : http;
      const headers = this.patchRequestHeaders(req, targetUrl);

      // UA 兜底
      if (!headers['user-agent']) {
        headers['user-agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
      }

      const options: http.RequestOptions | https.RequestOptions = {
        protocol: targetUrl.protocol,
        hostname: targetUrl.hostname,
        port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
        path: `${targetUrl.pathname}${targetUrl.search}`,
        method: req.method,
        headers,
        family: 4, // 强制 IPv4 防黑洞
        timeout: 15000, // 15秒防死等
      };

      const proxyReq = requestModule.request(options, (proxyRes) => {
        if (res.writableEnded || res.destroyed) {
          proxyRes.resume();
          return;
        }

        // 💡 降级策略 2：如果目标服务器抛出 502/503/504 等服务器错误，直接返回 302 丢给浏览器自行处理
        if (proxyRes.statusCode && proxyRes.statusCode >= 502 && proxyRes.statusCode <= 504) {
          console.warn(`[QuickOps Proxy Fallback] Upstream returned ${proxyRes.statusCode}, redirecting to: ${targetUrlStr}`);
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
        console.warn(`[QuickOps Proxy Timeout Fallback] Target took too long, redirecting to: ${targetUrlStr}`);
        // 触发 timeout 后主动销毁并创建 error 抛下去，最后被下面 catch 捕获并重定向
        proxyReq.destroy(new Error('ProxyTimeout'));
      });

      proxyReq.on('error', (error) => {
        if (res.headersSent || res.writableEnded || res.destroyed) {
          return;
        }

        // 💡 降级策略 3：拦截到任何底层网络连接报错（502 本质），强制抛出 302 丢给外部真实网络
        console.warn(`[QuickOps Proxy Fallback] Request failed: ${error.message}. Redirecting to: ${targetUrlStr}`);
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
      console.error('[QuickOps Proxy Internal Error]', { message, targetUrlStr });

      // 💡 降级策略 4：哪怕是代理自身代码崩溃了，只要有真实地址，依然让浏览器 302 逃逸
      if (targetUrlStr && !res.headersSent && !res.writableEnded && !res.destroyed) {
        this.safeSend(res, 302, { location: targetUrlStr }, '');
      } else if (!res.headersSent) {
        this.safeSend(res, 500, { 'content-type': 'text/plain; charset=utf-8' }, `Proxy Internal Error: ${message}`);
      }
    }
  }
}