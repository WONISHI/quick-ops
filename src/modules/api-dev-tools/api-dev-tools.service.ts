import * as http from 'http';
import * as os from 'os';
import type { AddressInfo } from 'net';
import * as vscode from 'vscode';
import { ExtensionContextProvider } from '@common/providers/extension-context.provider';
import { API_DEV_TOOLS_STATE_KEY } from '@modules/api-dev-tools/api-dev-tools.constant';
import type { ApiDevToolsRequestPayload, ApiDevToolsResponsePayload, ApiDocsExportPayload, ApiDocsPayload, ApiDocsSharePayload } from '@modules/api-dev-tools/api-dev-tools.type';

export class ApiDevToolsService {
  public static inject = [ExtensionContextProvider];

  private docServer?: http.Server;
  private docShareHtml = '';

  constructor(private readonly extensionContextProvider: ExtensionContextProvider) {}

  public getState<T = unknown>(): T | undefined {
    return this.getContext().globalState.get<T>(API_DEV_TOOLS_STATE_KEY);
  }

  public async saveState(state: unknown): Promise<void> {
    await this.getContext().globalState.update(API_DEV_TOOLS_STATE_KEY, state ?? null);
  }

  public async clearState(): Promise<void> {
    await this.getContext().globalState.update(API_DEV_TOOLS_STATE_KEY, undefined);
  }

  public async executeApiRequest(payload: ApiDevToolsRequestPayload): Promise<ApiDevToolsResponsePayload> {
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
    const timer =
      timeout > 0
        ? setTimeout(() => {
            controller.abort();
          }, timeout)
        : undefined;

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
    } catch (error: unknown) {
      const isAbort = typeof error === 'object' && error !== null && 'name' in error && String((error as { name?: unknown }).name || '') === 'AbortError';

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
        error: isAbort ? `请求超时：${timeout}ms` : this.toErrorMessage(error),
      };
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  public async shareApiDocs(payload: ApiDocsPayload): Promise<ApiDocsSharePayload | undefined> {
    const html = String(payload?.html || '').trim();

    if (!html) {
      vscode.window.showWarningMessage('没有可分享的接口文档内容。');
      return undefined;
    }

    this.docShareHtml = html;
    this.closeDocServer();

    const server = http.createServer((req, res) => {
      void this.handleDocServerRequest(req, res).catch((error: unknown) => {
        res.writeHead(500, {
          'Content-Type': 'application/json; charset=utf-8',
        });
        res.end(
          JSON.stringify({
            ok: false,
            error: this.toErrorMessage(error),
          }),
        );
      });
    });

    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '0.0.0.0', () => {
          resolve();
        });
      });
    } catch (error) {
      try {
        server.close();
      } catch {
        // ignore
      }

      vscode.window.showErrorMessage(`接口文档分享服务启动失败：${this.toErrorMessage(error)}`);
      return undefined;
    }

    this.docServer = server;

    const address = server.address() as AddressInfo | null;
    const port = address?.port;

    if (!port) {
      this.closeDocServer();
      vscode.window.showErrorMessage('接口文档分享服务启动失败。');
      return undefined;
    }

    const urls = this.getLocalNetworkUrls(port);
    const url = urls[0] || `http://127.0.0.1:${port}`;

    await vscode.env.clipboard.writeText(url);

    vscode.window.showInformationMessage(`接口文档已开启局域网分享，地址已复制：${url}`);

    return {
      url,
      urls,
      port,
    };
  }

  public updateApiDocsShare(payload: ApiDocsPayload): void {
    const html = String(payload?.html || '').trim();

    if (!html) return;

    this.docShareHtml = html;
  }

  public stopApiDocsShare(): boolean {
    const hadServer = Boolean(this.docServer);

    this.closeDocServer();
    this.docShareHtml = '';

    if (hadServer) {
      vscode.window.showInformationMessage('已关闭接口文档分享。');
    }

    return hadServer;
  }

  public async exportApiDocsHtml(payload: ApiDocsPayload): Promise<ApiDocsExportPayload | undefined> {
    const html = String(payload?.html || '').trim();

    if (!html) {
      vscode.window.showWarningMessage('没有可导出的接口文档内容。');
      return undefined;
    }

    const context = this.getContext();
    const safeFileName = this.normalizeFileName(payload?.fileName || 'q-ops-api-docs.html');
    const defaultUri = vscode.workspace.workspaceFolders?.[0]
      ? vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, safeFileName)
      : vscode.Uri.joinPath(context.globalStorageUri, safeFileName);

    const targetUri = await vscode.window.showSaveDialog({
      defaultUri,
      filters: {
        HTML: ['html', 'htm'],
      },
      saveLabel: '导出接口文档',
      title: '导出接口文档 HTML',
    });

    if (!targetUri) return undefined;

    await vscode.workspace.fs.writeFile(targetUri, Buffer.from(html, 'utf8'));

    const action = await vscode.window.showInformationMessage('接口文档 HTML 已导出。', '打开文件');

    if (action === '打开文件') {
      await vscode.env.openExternal(targetUri);
    }

    return {
      path: targetUri.fsPath || targetUri.toString(),
    };
  }

  public async openExternalUrl(payload: { url?: string }): Promise<void> {
    const url = String(payload?.url || '').trim();

    if (!url) {
      vscode.window.showWarningMessage('链接不能为空。');
      return;
    }

    const action = await vscode.window.showInformationMessage('是否在外部浏览器打开分享链接？', '打开', '取消');

    if (action !== '打开') return;

    await vscode.env.openExternal(vscode.Uri.parse(url));
  }

  public dispose(): void {
    this.closeDocServer();
    this.docShareHtml = '';
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
        res.writeHead(405, {
          ...this.getCorsHeaders(),
          'Content-Type': 'application/json; charset=utf-8',
        });
        res.end(
          JSON.stringify({
            ok: false,
            error: 'Method Not Allowed',
          }),
        );
        return;
      }

      let payload: ApiDevToolsRequestPayload;

      try {
        const rawBody = await this.readRequestBody(req);
        payload = JSON.parse(rawBody || '{}') as ApiDevToolsRequestPayload;
      } catch (error) {
        res.writeHead(400, {
          ...this.getCorsHeaders(),
          'Content-Type': 'application/json; charset=utf-8',
        });
        res.end(
          JSON.stringify({
            ok: false,
            error: `请求数据格式错误：${this.toErrorMessage(error)}`,
          }),
        );
        return;
      }

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
      res.writeHead(404, {
        ...this.getCorsHeaders(),
        'Content-Type': 'text/plain; charset=utf-8',
      });
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

  private closeDocServer(): void {
    if (!this.docServer) return;

    const server = this.docServer;

    this.docServer = undefined;

    try {
      server.close();
    } catch {
      // ignore
    }
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

  private getContext(): vscode.ExtensionContext {
    return this.extensionContextProvider.getContext();
  }

  private toErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;

    return String(error);
  }
}
