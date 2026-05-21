import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';

export class LocalProxyServer {
  private server: http.Server | null = null;
  public port: number = 0;

  public start(): Promise<number> {
    return new Promise((resolve) => {
      this.server = http.createServer(this.handleRequest.bind(this));
      this.server.listen(0, '127.0.0.1', () => {
        this.port = (this.server?.address() as any).port;
        resolve(this.port);
      });
    });
  }

  public stop() {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    try {
      const reqUrl = new URL(req.url || '', `http://${req.headers.host}`);
      let targetUrlStr = reqUrl.searchParams.get('url');

      if (!targetUrlStr && req.headers.referer) {
        const refUrl = new URL(req.headers.referer);
        const parentTarget = refUrl.searchParams.get('url');
        if (parentTarget) {
          targetUrlStr = new URL(parentTarget).origin + req.url;
        }
      }

      if (!targetUrlStr) {
        res.writeHead(400);
        res.end('Missing target URL');
        return;
      }

      const targetUrl = new URL(targetUrlStr);
      const requestModule = targetUrl.protocol === 'https:' ? https : http;

      const headers = { ...req.headers };
      delete headers.host;
      delete headers['accept-encoding']; // 禁用压缩以注入 HTML

      const options: http.RequestOptions | https.RequestOptions = {
        hostname: targetUrl.hostname,
        port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
        path: targetUrl.pathname + targetUrl.search,
        method: req.method,
        headers: headers,
      };

      const proxyReq = requestModule.request(options, (proxyRes) => {
        const resHeaders = { ...proxyRes.headers };

        // 🌟 终极防御 1：死死锁住 301/302 重定向，强制包装回本地代理！
        if (resHeaders.location) {
          const redirectUrl = new URL(resHeaders.location, targetUrlStr).href;
          resHeaders.location = `http://127.0.0.1:${this.port}/?url=${encodeURIComponent(redirectUrl)}`;
          res.writeHead(proxyRes.statusCode || 302, resHeaders);
          res.end();
          return;
        }

        // 🌟 终极防御 2：剥离严格安全头，解决 HTTP 下的 Cookie 跨域丢失
        delete resHeaders['x-frame-options'];
        delete resHeaders['content-security-policy'];
        delete resHeaders['content-security-policy-report-only'];
        delete resHeaders['strict-transport-security'];
        
        if (resHeaders['set-cookie']) {
          resHeaders['set-cookie'] = resHeaders['set-cookie'].map(c => 
            c.replace(/;\s*Secure/ig, '').replace(/;\s*SameSite=None/ig, '')
          );
        }

        const isHtml = resHeaders['content-type']?.toLowerCase().includes('text/html');

        if (isHtml) {
          delete resHeaders['content-length'];
          res.writeHead(proxyRes.statusCode || 200, resHeaders);

          let body = '';
          proxyRes.on('data', (chunk) => body += chunk.toString('utf8'));

          proxyRes.on('end', () => {
            const baseOrigin = `${targetUrl.protocol}//${targetUrl.host}${targetUrl.pathname === '/' ? '' : targetUrl.pathname}`;
            
            const headInjection = `
              <base href="${baseOrigin}">
              <script>
                (function() {
                  const targetStr = "${targetUrlStr}";
                  
                  function notifyParent(url, isSpa) {
                    window.parent.postMessage({ type: 'inner-nav', url: url, isSpa: isSpa }, '*');
                  }

                  // 重写原生 window.open
                  window.open = function(url) {
                    if (url) notifyParent(new URL(url, targetStr).href, false);
                    return null;
                  };

                  // 暴力拦截所有 A 标签点击
                  document.addEventListener('click', function(e) {
                    const a = e.target.closest('a');
                    if (!a) return;
                    
                    const href = a.getAttribute('href');
                    if (!href || href.startsWith('javascript:') || href.startsWith('#')) return;

                    e.preventDefault();
                    e.stopPropagation();
                    
                    notifyParent(new URL(href, targetStr).href, false);
                  }, true);

                  // 暴力拦截搜索表单提交
                  document.addEventListener('submit', function(e) {
                    const form = e.target;
                    if (!form) return;
                    
                    e.preventDefault();
                    e.stopPropagation();
                    
                    const formData = new FormData(form);
                    const params = new URLSearchParams();
                    formData.forEach((value, key) => params.append(key, value));
                    
                    const actionUrl = form.getAttribute('action') || '';
                    const fullAction = new URL(actionUrl, targetStr);
                    
                    if (form.method.toLowerCase() !== 'post') {
                      const existingParams = new URLSearchParams(fullAction.search);
                      params.forEach((value, key) => existingParams.set(key, value));
                      fullAction.search = existingParams.toString();
                      
                      notifyParent(fullAction.href, false);
                    } else {
                      form.target = '_self';
                      form.submit();
                    }
                  }, true);
                })();
              </script>
            `;

            // 确保脚本第一时间执行
            if (body.match(/<head[^>]*>/i)) {
              body = body.replace(/(<head[^>]*>)/i, `$1\n${headInjection}\n`);
            } else if (body.match(/<html[^>]*>/i)) {
              body = body.replace(/(<html[^>]*>)/i, `$1\n<head>\n${headInjection}\n</head>\n`);
            } else {
              body = headInjection + body;
            }

            res.end(body);
          });
        } else {
          res.writeHead(proxyRes.statusCode || 200, resHeaders);
          proxyRes.pipe(res);
        }
      });

      proxyReq.on('error', (err) => {
        res.writeHead(502);
        res.end('Proxy Request Failed: ' + err.message);
      });

      if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
        req.pipe(proxyReq);
      } else {
        proxyReq.end();
      }
    } catch (err) {
      res.writeHead(500);
      res.end('Proxy Internal Error');
    }
  }
}