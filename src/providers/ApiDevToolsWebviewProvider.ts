import * as vscode from 'vscode';
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

export class ApiDevToolsWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'quickOpsApiDevTools';

  private view?: vscode.WebviewView;
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
          this.postState();
          break;
        }

        case 'sendApiRequest': {
          await this.sendApiRequest(message.payload as ApiDevToolsRequestPayload);
          break;
        }
      }
    });
  }

  private postState(): void {
    this.view?.webview.postMessage({
      type: 'apiDevToolsState',
      state: this.context.globalState.get(this.stateKey),
    });
  }

  private async sendApiRequest(payload: ApiDevToolsRequestPayload): Promise<void> {
    const requestId = String(payload?.requestId || Date.now());
    const method = String(payload?.method || 'GET').toUpperCase();
    const url = String(payload?.url || '').trim();
    const headers = this.normalizeHeaders(payload?.headers || {});
    const timeout = this.normalizeTimeout(payload?.timeout);
    const start = Date.now();

    if (!url) {
      this.postResponse({
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
      });
      return;
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

      this.postResponse({
        requestId,
        ok: response.ok,
        url: response.url || url,
        status: response.status,
        statusText: response.statusText,
        duration: Date.now() - start,
        size: Buffer.byteLength(responseBody || '', 'utf8'),
        headers: responseHeaders,
        body: responseBody,
      });
    } catch (error: any) {
      const isAbort = error?.name === 'AbortError';

      this.postResponse({
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
      });
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