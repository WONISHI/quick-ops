import * as http from 'http';
import * as os from 'os';
import { channel } from 'diagnostics_channel';
import type { AddressInfo } from 'net';
import * as vscode from 'vscode';
import { ExtensionContextProvider } from '@common/providers/extension-context.provider';
import { API_DEV_TOOLS_STATE_KEY } from '@/modules/api-dev-tools/constants/api-dev-tools.constant';
import type {
  ApiDevToolsFormDataItemPayload,
  ApiDevToolsRequestDetailPayload,
  ApiDevToolsRequestPayload,
  ApiDevToolsResponsePayload,
  ApiDocsExportPayload,
  ApiDocsPayload,
  ApiDocsSharePayload,
  UndiciRequestCreateMessage,
} from '@modules/api-dev-tools/api-dev-tools.type';

export class ApiDevToolsService {
  public static inject = [ExtensionContextProvider];

  private docServer?: http.Server;
  private docShareHtml = '';
  private readonly apiRequestControllers = new Map<string, AbortController>();
  private readonly stoppedApiRequestIds = new Set<string>();

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
    const canSendBody = !['GET', 'HEAD'].includes(method);
    const multipartBody = canSendBody ? this.createMultipartBody(payload?.formData) : undefined;
    const body = canSendBody && !multipartBody && typeof payload?.body === 'string' ? payload.body : undefined;
    const requestBody = multipartBody || body;
    const requestBodyText = multipartBody ? this.createMultipartBodySummary(payload?.formData) : body;

    if (multipartBody) {
      this.deleteHeader(headers, 'Content-Type');
    }

    const requestDetail: ApiDevToolsRequestDetailPayload = {
      method,
      url,
      headers: this.createFallbackRequestHeaders(url, headers, multipartBody ? undefined : body),
      body: requestBodyText,
      timeout,
    };
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
        request: requestDetail,
        error: '请求地址不能为空',
      };
    }

    const previousController = this.apiRequestControllers.get(requestId);

    if (previousController && !previousController.signal.aborted) {
      previousController.abort();
    }

    this.stoppedApiRequestIds.delete(requestId);

    const controller = new AbortController();

    this.apiRequestControllers.set(requestId, controller);

    const timer =
      timeout > 0
        ? setTimeout(() => {
            if (!controller.signal.aborted) {
              controller.abort();
            }
          }, timeout)
        : undefined;

    const requestCreateChannel = channel('undici:request:create');

    /**
     * @description 捕获当前 Node Fetch 最终创建的请求信息
     */
    const handleRequestCreate = (message: unknown) => {
      try {
        const captured = this.captureUndiciRequestDetail(message as UndiciRequestCreateMessage, method, url, requestBodyText, timeout);

        if (!captured) return;

        requestDetail.method = captured.method;
        requestDetail.url = captured.url;
        requestDetail.headers = captured.headers;
        requestDetail.body = captured.body;
        requestDetail.timeout = captured.timeout;
      } catch {
        // diagnostics_channel 回调不能向外抛错，捕获失败时继续使用兜底请求详情
      }
    };

    requestCreateChannel.subscribe(handleRequestCreate);

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: requestBody,
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
        request: requestDetail,
      };
    } catch (error: unknown) {
      const isAbort =
        controller.signal.aborted || (typeof error === 'object' && error !== null && 'name' in error && String((error as { name?: unknown }).name || '') === 'AbortError');

      const isStopped = this.stoppedApiRequestIds.has(requestId);

      return {
        requestId,
        ok: false,
        url,
        status: 0,
        statusText: isStopped ? 'Cancelled' : isAbort ? 'Timeout' : 'Request Failed',
        duration: Date.now() - start,
        size: 0,
        headers: {},
        body: '',
        request: requestDetail,
        error: isStopped ? '请求已中断' : isAbort ? `请求超时：${timeout}ms` : this.toErrorMessage(error),
      };
    } finally {
      requestCreateChannel.unsubscribe(handleRequestCreate);

      if (timer) {
        clearTimeout(timer);
      }

      if (this.apiRequestControllers.get(requestId) === controller) {
        this.apiRequestControllers.delete(requestId);
      }

      this.stoppedApiRequestIds.delete(requestId);
    }
  }

  /**
   * @description 中断指定 API 请求
   */
  public stopApiRequest(requestId: string): boolean {
    const id = String(requestId || '').trim();

    if (!id) return false;

    const controller = this.apiRequestControllers.get(id);

    if (!controller || controller.signal.aborted) {
      return false;
    }

    this.stoppedApiRequestIds.add(id);
    controller.abort();

    return true;
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
    this.apiRequestControllers.forEach((controller) => {
      if (!controller.signal.aborted) {
        controller.abort();
      }
    });

    this.apiRequestControllers.clear();
    this.stoppedApiRequestIds.clear();
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

  /**
   * @description 创建 multipart/form-data 请求体
   */
  private createMultipartBody(items: ApiDevToolsFormDataItemPayload[] | undefined): FormData | undefined {
    if (!Array.isArray(items) || items.length === 0) return undefined;

    const formData = new FormData();
    let hasValue = false;

    items.forEach((item) => {
      const key = String(item?.key || '').trim();

      if (!key) return;

      if (item.type === 'file') {
        const fileData = this.normalizeBase64FileData(item.fileData);

        if (!fileData) return;

        const buffer = Buffer.from(fileData, 'base64');
        const bytes = Uint8Array.from(buffer);
        const blob = new Blob([bytes], {
          type: String(item.mimeType || 'application/octet-stream'),
        });

        formData.append(key, blob, String(item.fileName || 'file'));
        hasValue = true;
        return;
      }

      formData.append(key, String(item.value ?? ''));
      hasValue = true;
    });

    return hasValue ? formData : undefined;
  }

  /**
   * @description 创建 multipart/form-data 请求详情摘要
   */
  private createMultipartBodySummary(items: ApiDevToolsFormDataItemPayload[] | undefined): string | undefined {
    if (!Array.isArray(items)) return undefined;

    const lines = items
      .map((item) => {
        const key = String(item?.key || '').trim();

        if (!key) return '';

        if (item.type === 'file') {
          return `${key}: [File] ${String(item.fileName || 'file')}`;
        }

        return `${key}: ${String(item.value ?? '')}`;
      })
      .filter(Boolean);

    return lines.length > 0 ? lines.join('\n') : undefined;
  }

  /**
   * @description 去掉 Data URL 前缀，仅保留 Base64 内容
   */
  private normalizeBase64FileData(value: unknown): string {
    const fileData = String(value || '').trim();
    const separatorIndex = fileData.indexOf(',');

    if (/^data:/i.test(fileData) && separatorIndex >= 0) {
      return fileData.slice(separatorIndex + 1);
    }

    return fileData;
  }

  /**
   * @description 捕获 Node Fetch 最终生成的请求详情
   */
  private captureUndiciRequestDetail(
    message: UndiciRequestCreateMessage,
    method: string,
    url: string,
    body: string | undefined,
    timeout: number,
  ): ApiDevToolsRequestDetailPayload | null {
    const request = message?.request;

    if (!request) return null;

    const requestMethod = String(request.method || '').toUpperCase();
    const requestUrl = this.getUndiciRequestUrl(request.origin, request.path);
    const targetUrl = this.normalizeRequestUrl(url);

    if (!requestUrl || !targetUrl || requestMethod !== method || requestUrl !== targetUrl) {
      return null;
    }

    const headers = this.parseUndiciHeaders(request.headers);
    const requestUrlObject = new URL(requestUrl);

    this.setHeaderIfMissing(headers, 'Host', requestUrlObject.host);
    this.setHeaderIfMissing(headers, 'Connection', 'keep-alive');

    if (body !== undefined && request.contentLength !== null && request.contentLength !== undefined) {
      this.setHeaderIfMissing(headers, 'Content-Length', String(request.contentLength));
    }

    return {
      method: requestMethod,
      url: requestUrl,
      headers,
      body,
      timeout,
    };
  }

  /**
   * @description 获取 Undici 请求的完整地址
   */
  private getUndiciRequestUrl(origin: unknown, path: unknown): string {
    try {
      return new URL(String(path || '/'), String(origin || '')).toString();
    } catch {
      return '';
    }
  }

  /**
   * @description 规范化请求地址
   */
  private normalizeRequestUrl(url: string): string {
    try {
      return new URL(url).toString();
    } catch {
      return '';
    }
  }

  /**
   * @description 解析 Undici 生成的请求头
   */
  private parseUndiciHeaders(rawHeaders: Array<string | Buffer> | string | undefined): Record<string, string> {
    const result: Record<string, string> = {};

    if (Array.isArray(rawHeaders)) {
      for (let index = 0; index < rawHeaders.length; index += 2) {
        const key = String(rawHeaders[index] || '').trim();
        const value = String(rawHeaders[index + 1] || '').trim();

        if (!key || !value) continue;

        result[key] = value;
      }

      return result;
    }

    String(rawHeaders || '')
      .split(/\r?\n/)
      .forEach((line) => {
        const separatorIndex = line.indexOf(':');

        if (separatorIndex <= 0) return;

        const key = line.slice(0, separatorIndex).trim();
        const value = line.slice(separatorIndex + 1).trim();

        if (!key || !value) return;

        result[key] = value;
      });

    return result;
  }

  /**
   * @description 创建无法捕获 Undici 信息时的请求头兜底数据
   */
  private createFallbackRequestHeaders(url: string, headers: Record<string, string>, body?: string): Record<string, string> {
    const result = { ...headers };
    const normalizedUrl = this.normalizeRequestUrl(url);

    if (!normalizedUrl) return result;

    const urlObject = new URL(normalizedUrl);

    this.setHeaderIfMissing(result, 'Host', urlObject.host);
    this.setHeaderIfMissing(result, 'Connection', 'keep-alive');
    this.setHeaderIfMissing(result, 'Accept', '*/*');
    this.setHeaderIfMissing(result, 'Accept-Language', '*');
    this.setHeaderIfMissing(result, 'Sec-Fetch-Mode', 'cors');
    this.setHeaderIfMissing(result, 'User-Agent', 'node');
    this.setHeaderIfMissing(result, 'Accept-Encoding', 'gzip, deflate');

    if (body !== undefined) {
      this.setHeaderIfMissing(result, 'Content-Length', String(Buffer.byteLength(body, 'utf8')));
    }

    return result;
  }

  /**
   * @description 在请求头不存在时写入默认值
   */
  private setHeaderIfMissing(headers: Record<string, string>, name: string, value: string): void {
    const targetName = name.toLowerCase();
    const exists = Object.keys(headers).some((key) => key.toLowerCase() === targetName);

    if (!exists && value) {
      headers[name] = value;
    }
  }

  /**
   * @description 按名称删除请求头，忽略大小写
   */
  private deleteHeader(headers: Record<string, string>, name: string): void {
    const targetName = name.toLowerCase();

    Object.keys(headers).forEach((key) => {
      if (key.toLowerCase() === targetName) {
        delete headers[key];
      }
    });
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
