import * as vscode from 'vscode';
import ReactWebviewHtmlWorkflow from '@/workflow/react-webview-html';
import { ExtensionContextProvider } from '@common/providers/extension-context.provider';
import {
  API_DEV_TOOLS_LOADING_CONTEXT,
  API_DEV_TOOLS_VIEW_TITLE_ACTION_MESSAGE,
  API_DEV_TOOLS_VIEW_TYPE,
  API_DEV_TOOLS_WEBVIEW_ROUTE,
} from '@/modules/api-dev-tools/constants/api-dev-tools.constant';
import { ApiDevToolsService } from '@modules/api-dev-tools/api-dev-tools.service';
import type { ApiDevToolsRequestPayload, ApiDevToolsViewTitleAction, ApiDevToolsWebviewMessage, ApiDocsPayload } from '@modules/api-dev-tools/api-dev-tools.type';

export class ApiDevToolsWebviewProvider implements vscode.WebviewViewProvider {
  public static inject = [ExtensionContextProvider, ApiDevToolsService];

  public static readonly viewType = API_DEV_TOOLS_VIEW_TYPE;

  private view?: vscode.WebviewView;
  private activeRequestId = '';
  private requestLoading = false;
  private readonly reactWebviewHtmlWorkflow = new ReactWebviewHtmlWorkflow();

  constructor(
    private readonly extensionContextProvider: ExtensionContextProvider,
    private readonly apiDevToolsService: ApiDevToolsService,
  ) {}

  public async resolveWebviewView(webviewView: vscode.WebviewView, _context: vscode.WebviewViewResolveContext, _token: vscode.CancellationToken): Promise<void> {
    const context = this.extensionContextProvider.getContext();

    this.view = webviewView;

    await this.setRequestLoading(this.requestLoading, true);

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [context.extensionUri],
    };

    webviewView.webview.html = await this.reactWebviewHtmlWorkflow.createReactWebviewHtml({
      extensionUri: context.extensionUri,
      webview: webviewView.webview,
      routeName: API_DEV_TOOLS_WEBVIEW_ROUTE,
    });

    webviewView.webview.onDidReceiveMessage(async (message) => {
      try {
        await this.handleMessage(message as ApiDevToolsWebviewMessage);
      } catch (error) {
        console.error('[ApiDevToolsWebviewProvider] handleMessage failed:', error);

        vscode.window.showErrorMessage(`API 调试工具操作失败：${this.toErrorMessage(error)}`);
      }
    });

    webviewView.onDidDispose(() => {
      if (this.view === webviewView) {
        if (this.activeRequestId) {
          this.apiDevToolsService.stopApiRequest(this.activeRequestId);
        }

        this.activeRequestId = '';
        this.view = undefined;

        void this.setRequestLoading(false, true);
      }
    });
  }

  public dispose(): void {
    if (this.activeRequestId) {
      this.apiDevToolsService.stopApiRequest(this.activeRequestId);
    }

    this.activeRequestId = '';
    this.view = undefined;

    void this.setRequestLoading(false, true);

    this.apiDevToolsService.dispose();
  }

  /**
   * @description 执行 API DevTools 原生 View 标题栏操作
   */
  public async executeViewTitleAction(action: ApiDevToolsViewTitleAction): Promise<void> {
    if (!this.view) {
      await vscode.commands.executeCommand(`${ApiDevToolsWebviewProvider.viewType}.focus`);
    }

    this.view?.show(true);

    this.postMessage({
      type: API_DEV_TOOLS_VIEW_TITLE_ACTION_MESSAGE,
      action,
    });
  }

  /**
   * @description 中断当前 API 请求
   */
  public async stopApiRequest(): Promise<void> {
    const requestId = this.activeRequestId;

    if (!requestId) {
      await this.setRequestLoading(false);
      return;
    }

    const stopped = this.apiDevToolsService.stopApiRequest(requestId);

    if (!stopped) {
      this.activeRequestId = '';
      await this.setRequestLoading(false);
    }
  }

  private async handleMessage(message: ApiDevToolsWebviewMessage): Promise<void> {
    switch (message?.type) {
      case 'apiDevToolsReady':
        this.postState();
        break;

      case 'saveApiDevToolsState':
        await this.apiDevToolsService.saveState(message.state);
        break;

      case 'clearApiDevToolsState': {
        await this.apiDevToolsService.clearState();

        const hadServer = this.apiDevToolsService.stopApiDocsShare();

        if (hadServer) {
          this.postMessage({
            type: 'apiDocsShareStopped',
          });
        }

        this.postState();
        break;
      }

      case 'sendApiRequest': {
        const rawPayload = message.payload as ApiDevToolsRequestPayload;
        const payload: ApiDevToolsRequestPayload = {
          ...rawPayload,
          requestId: String(rawPayload?.requestId || Date.now()),
        };

        const requestId = payload.requestId;

        this.activeRequestId = requestId;

        await this.setRequestLoading(true);

        try {
          const response = await this.apiDevToolsService.executeApiRequest(payload);

          this.postMessage({
            type: 'apiResponse',
            payload: response,
          });
        } finally {
          if (this.activeRequestId === requestId) {
            this.activeRequestId = '';
            await this.setRequestLoading(false);
          }
        }

        break;
      }

      case 'shareApiDocs': {
        const result = await this.apiDevToolsService.shareApiDocs(message.payload as ApiDocsPayload);

        if (result) {
          this.postMessage({
            type: 'apiDocsShared',
            payload: result,
          });
        }

        break;
      }

      case 'updateApiDocsShare':
        this.apiDevToolsService.updateApiDocsShare(message.payload as ApiDocsPayload);
        break;

      case 'stopApiDocsShare': {
        const hadServer = this.apiDevToolsService.stopApiDocsShare();

        if (hadServer) {
          this.postMessage({
            type: 'apiDocsShareStopped',
          });
        }

        break;
      }

      case 'exportApiDocsHtml': {
        const result = await this.apiDevToolsService.exportApiDocsHtml(message.payload as ApiDocsPayload);

        if (result) {
          this.postMessage({
            type: 'apiDocsExported',
            payload: result,
          });
        }

        break;
      }

      case 'openExternalUrl':
        await this.apiDevToolsService.openExternalUrl(message.payload as { url?: string });
        break;

      default:
        console.warn('[ApiDevToolsWebviewProvider] unknown message:', message);
        break;
    }
  }

  /**
   * @description 同步 API 请求加载状态到 VS Code Context
   */
  private async setRequestLoading(loading: boolean, force = false): Promise<void> {
    if (!force && this.requestLoading === loading) {
      return;
    }

    this.requestLoading = loading;

    await vscode.commands.executeCommand('setContext', API_DEV_TOOLS_LOADING_CONTEXT, loading);
  }

  private postState(): void {
    this.postMessage({
      type: 'apiDevToolsState',
      state: this.apiDevToolsService.getState(),
    });
  }

  private postMessage(message: Record<string, unknown>): void {
    if (!this.view) return;

    void this.view.webview.postMessage(message);
  }

  private toErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;

    return String(error);
  }
}
