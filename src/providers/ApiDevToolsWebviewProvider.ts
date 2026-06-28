import * as vscode from 'vscode';
import * as http from 'http';
import * as os from 'os';
import type { AddressInfo } from 'net';
import { getReactWebviewHtml } from '../utils/WebviewHelper';

interface ApiDevToolsRequestPayload {
  requestId: string;
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
  timeout?: number;
}

interface ApiDevToolsResponsePayload {
  requestId: string;
  ok: boolean;
  url: string;
  status: number;
  statusText: string;
  duration: number;
  size: number;
  headers: Record<string, string>;
  body: string;
  error?: string;
}

interface ApiDocsPayload {
  html?: string;
  fileName?: string;
}

export class ApiDevToolsWebviewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  public static readonly viewType = 'quickOpsApiDevTools';

  private view?: vscode.WebviewView;
  private docServer?: http.Server;
  private docShareHtml = '';
  private readonly stateKey = 'quickOps.apiDevTools.state';

  constructor(private readonly context: vscode.ExtensionContext) {}

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };

    webviewView.webview.html = getReactWebviewHtml(
      this.context.extensionUri,
      webviewView.webview,
      '/api-fox'
    );

    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message?.type) {
        case 'apiDevToolsReady': {
          this.postState();
          break;
        }

        case 'saveApiDevToolsState': {
          await this.context.globalState.update(this.stateKey, message.state || null);
          break;
        }

        case 'clearApiDevToolsState': {
          await this.context.globalState.update(this.stateKey, undefined);
          await this.stopApiDocsShare();
          this.postState();
          break;
        }

        case 'sendApiRequest': {
          await this.sendApiRequest(message.payload as ApiDevToolsRequestPayload);
          break;
        }

        case 'shareApiDocs': {
          await this.shareApiDocs(message.payload as ApiDocsPayload);
          break;
        }

        case 'updateApiDocsShare': {
          this.updateApiDocsShare(message.payload as ApiDocsPayload);
          break;
        }

        case 'stopApiDocsShare': {
          await this.stopApiDocsShare();
          break;
        }

        case 'exportApiDocsHtml': {
          await this.exportApiDocsHtml(message.payload as ApiDocsPayload);
          break;
        }

        case 'openExternalUrl': {
          await this.openExternalUrl(message.payload as { url?: string });
          break;
        }
      }
    });
  }

  public dispose(): void {
    this.closeDocServer();
  }

  private postState(): void {
    this.view?.webview.postMessage({
      type: 'apiDevToolsState',
      state: this.context.globalState.get(this.stateKey),
    });
  }

  private async sendApiRequest(payload: ApiDevToolsRequestPayload): Promise<void> {
    const response = await this.executeApiRequest(payload);
    this.postResponse(response);
  }

  private async executeApiRequest(payload: ApiDevToolsRequestPayload): Promise<ApiDevToolsResponsePayload> {
    const requestId = String(payload?.requestId || Date.now());
    const method = String(payload?.method || 'GET').toUpperCase();
    const url = String(payload?.url || '').trim();
    const headers = this.normalizeHeaders(payload?.headers || {});
    const timeout = this.normalizeTimeout(payload?.timeout);
    const start = Date.now();

    if (!url) {
      return {
        requestId,
        ok: false,
        url,
        status: 0,
        statusText: 'Invalid URL',
        duration: 0,
        size: 0,
        headers: {},
        body: '',
        error: '请求地址不能为空',
      };
    }

    const controller = new AbortController();
    const timer = timeout > 0 ? setTimeout(() => controller.abort(), timeout) : undefined;

    try {
      const hasBody = !['GET', 'HEAD'].includes(method) && typeof payload?.body === 'string';

      const response = await fetch(url, {
        method,
        headers,
        body: hasBody ? payload.body : undefined,
        redirect: 'follow',
        signal: controller.signal,
      });

      const responseBody = await response.text();
      const responseHeaders: Record<string, string> = {};

      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      return {
        requestId,
        ok: response.ok,
        url: response.url || url,
        status: response.status,
        statusText: response.statusText,
        duration: Date.now() - start,
        size: Buffer.byteLength(responseBody || '', 'utf8'),
        headers: responseHeaders,
        body: responseBody,
      };
    } catch (error: any) {
      const isAbort = error?.name === 'AbortError';

      return {
        requestId,
        ok: false,
        url,
        status: 0,
        statusText: isAbort ? 'Timeout' : 'Request Failed',
        duration: Date.now() - start,
        size: 0,
        headers: {},
        body: '',
        error: isAbort ? `请求超时：${timeout}ms` : error?.message || String(error),
      };
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  private postResponse(payload: ApiDevToolsResponsePayload): void {
    this.view?.webview.postMessage({
      type: 'apiResponse',
      payload,
    });
  }

  private async shareApiDocs(payload: ApiDocsPayload): Promise<void> {
    const html = String(payload?.html || '').trim();

    if (!html) {
      vscode.window.showWarningMessage('没有可分享的接口文档内容。');
      return;
    }

    this.docShareHtml = html;
    this.closeDocServer();

    const server = http.createServer((req, res) => {
      this.handleDocServerRequest(req, res).catch((error) => {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: error?.message || String(error) }));
      });
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '0.0.0.0', () => resolve());
    });

    this.docServer = server;

    const address = server.address() as AddressInfo | null;
    const port = address?.port;

    if (!port) {
      this.closeDocServer();
      vscode.window.showErrorMessage('接口文档分享服务启动失败。');
      return;
    }

    const urls = this.getLocalNetworkUrls(port);
    const url = urls[0] || `http://127.0.0.1:${port}`;

    await vscode.env.clipboard.writeText(url);

    this.view?.webview.postMessage({
      type: 'apiDocsShared',
      payload: {
        url,
        urls,
        port,
      },
    });

    vscode.window.showInformationMessage(`接口文档已开启局域网分享，地址已复制：${url}`);
  }

  private updateApiDocsShare(payload: ApiDocsPayload): void {
    const html = String(payload?.html || '').trim();

    if (!html) return;

    this.docShareHtml = html;
  }

  private async handleDocServerRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const method = String(req.method || 'GET').toUpperCase();
    const requestUrl = req.url || '/';

    if (method === 'OPTIONS') {
      res.writeHead(204, this.getCorsHeaders());
      res.end();
      return;
    }

    if (requestUrl.startsWith('/__api_send')) {
      if (method !== 'POST') {
        res.writeHead(405, { ...this.getCorsHeaders(), 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: 'Method Not Allowed' }));
        return;
      }

      const rawBody = await this.readRequestBody(req);
      const payload = JSON.parse(rawBody || '{}') as ApiDevToolsRequestPayload;
      const result = await this.executeApiRequest(payload);

      res.writeHead(200, {
        ...this.getCorsHeaders(),
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify(result));
      return;
    }

    if (requestUrl !== '/' && !requestUrl.startsWith('/#')) {
      res.writeHead(404, { ...this.getCorsHeaders(), 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }

    res.writeHead(200, {
      ...this.getCorsHeaders(),
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    });
    res.end(this.docShareHtml || '<!doctype html><html><body>暂无接口文档</body></html>');
  }

  private readRequestBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];

      req.on('data', (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });

      req.on('end', () => {
        resolve(Buffer.concat(chunks).toString('utf8'));
      });

      req.on('error', reject);
    });
  }

  private getCorsHeaders(): Record<string, string> {
    return {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    };
  }

  private async stopApiDocsShare(): Promise<void> {
    const hadServer = !!this.docServer;

    this.closeDocServer();
    this.docShareHtml = '';

    if (hadServer) {
      this.view?.webview.postMessage({ type: 'apiDocsShareStopped' });
      vscode.window.showInformationMessage('已关闭接口文档分享。');
    }
  }

  private async exportApiDocsHtml(payload: ApiDocsPayload): Promise<void> {
    const html = String(payload?.html || '').trim();

    if (!html) {
      vscode.window.showWarningMessage('没有可导出的接口文档内容。');
      return;
    }

    const safeFileName = this.normalizeFileName(payload?.fileName || 'q-ops-api-docs.html');
    const defaultUri = vscode.workspace.workspaceFolders?.[0]
      ? vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, safeFileName)
      : vscode.Uri.joinPath(this.context.globalStorageUri, safeFileName);

    const targetUri = await vscode.window.showSaveDialog({
      defaultUri,
      filters: {
        HTML: ['html', 'htm'],
      },
      saveLabel: '导出接口文档',
      title: '导出接口文档 HTML',
    });

    if (!targetUri) return;

    await vscode.workspace.fs.writeFile(targetUri, Buffer.from(html, 'utf8'));

    this.view?.webview.postMessage({
      type: 'apiDocsExported',
      payload: {
        path: targetUri.fsPath || targetUri.toString(),
      },
    });

    const action = await vscode.window.showInformationMessage('接口文档 HTML 已导出。', '打开文件');

    if (action === '打开文件') {
      vscode.env.openExternal(targetUri);
    }
  }

  private async openExternalUrl(payload: { url?: string }): Promise<void> {
    const url = String(payload?.url || '').trim();

    if (!url) {
      vscode.window.showWarningMessage('链接不能为空。');
      return;
    }

    const action = await vscode.window.showInformationMessage(
      '是否在外部浏览器打开分享链接？',
      '打开',
      '取消'
    );

    if (action !== '打开') return;

    await vscode.env.openExternal(vscode.Uri.parse(url));
  }

  private closeDocServer(): void {
    if (!this.docServer) return;

    try {
      this.docServer.close();
    } catch {
      // ignore
    }

    this.docServer = undefined;
  }

  private getLocalNetworkUrls(port: number): string[] {
    const result: string[] = [];
    const networkInterfaces = os.networkInterfaces();

    Object.values(networkInterfaces).forEach((items) => {
      items?.forEach((item) => {
        if (item.family !== 'IPv4' || item.internal) return;
        result.push(`http://${item.address}:${port}`);
      });
    });

    result.push(`http://127.0.0.1:${port}`);

    return Array.from(new Set(result));
  }

  private normalizeFileName(fileName: string): string {
    const cleanName =
      String(fileName || 'q-ops-api-docs.html')
        .trim()
        .replace(/[\\/:*?"<>|]/g, '-') || 'q-ops-api-docs.html';

    return /\.html?$/i.test(cleanName) ? cleanName : `${cleanName}.html`;
  }

  private normalizeTimeout(value: unknown): number {
    const timeout = Number(value);

    if (!Number.isFinite(timeout) || timeout <= 0) {
      return 30000;
    }

    return Math.min(Math.max(timeout, 1000), 10 * 60 * 1000);
  }

  private normalizeHeaders(headers: Record<string, string>): Record<string, string> {
    const result: Record<string, string> = {};

    Object.entries(headers || {}).forEach(([key, value]) => {
      const name = String(key || '').trim();
      const headerValue = String(value ?? '').trim();

      if (!name || !headerValue) return;

      result[name] = headerValue;
    });

    return result;
  }
}
