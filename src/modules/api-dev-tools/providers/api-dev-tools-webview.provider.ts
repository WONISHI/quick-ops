import * as vscode from 'vscode';
import WebviewWorkflow from '@/workflow/webview';
import ReactWebviewHtmlWorkflow from '@/workflow/react-webview-html';
import { ExtensionContextProvider } from '@common/providers/extension-context.provider';
import {
  API_DEV_TOOLS_FLOATING_CONTEXT,
  API_DEV_TOOLS_LOADING_CONTEXT,
  API_DEV_TOOLS_WELCOME_VISIBLE_CONTEXT,
  API_DEV_TOOLS_VIEW_TITLE_ACTION_MESSAGE,
  API_DEV_TOOLS_VIEW_TYPE,
  API_DEV_TOOLS_WEBVIEW_ROUTE,
} from '@/modules/api-dev-tools/constants/api-dev-tools.constant';
import { ApiDevToolsService } from '@modules/api-dev-tools/api-dev-tools.service';
import type { ApiDevToolsRequestPayload, ApiDevToolsViewTitleAction, ApiDevToolsWebviewMessage, ApiDocsPayload } from '@modules/api-dev-tools/api-dev-tools.type';
import type { WebviewEnhancerOptions } from '@plugins/webview-enhancer/type';

export class ApiDevToolsWebviewProvider implements vscode.WebviewViewProvider {
  public static inject = [ExtensionContextProvider, ApiDevToolsService];

  public static readonly viewType = API_DEV_TOOLS_VIEW_TYPE;

  private view?: vscode.WebviewView;
  private floatingPanel?: vscode.WebviewPanel;
  private activeRequestId = '';
  private requestLoading = false;
  private readonly webviewWorkflow = new WebviewWorkflow();
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
      await this.handleIncomingMessage(message);
    });

    webviewView.onDidDispose(() => {
      if (this.view === webviewView) {
        if (!this.floatingPanel && this.activeRequestId) {
          this.apiDevToolsService.stopApiRequest(this.activeRequestId);
        }

        this.view = undefined;

        if (!this.floatingPanel) {
          this.activeRequestId = '';
          void this.setRequestLoading(false, true);
        }
      }
    });
  }

  /**
   * @description 在浮动编辑器窗口中打开 API DevTools
   *
   * WebviewView 不能直接移动到浮动编辑器窗口，因此创建同一路由的
   * WebviewPanel，并交给 WebviewAppearancePlugin 执行浮动窗口迁移。
   */
  public async openFloatingEditor(): Promise<void> {
    if (this.floatingPanel) {
      this.floatingPanel.reveal(this.floatingPanel.viewColumn || vscode.ViewColumn.Active, false);
      return;
    }

    const context = this.extensionContextProvider.getContext();
    let panel: vscode.WebviewPanel;

    panel = await this.webviewWorkflow.createWebview<unknown, WebviewEnhancerOptions>({
      key: 'quickOpsApiDevToolsFloatingEditor',
      viewType: 'quickOpsApiDevToolsFloatingEditor',
      title: 'Q-ops Api',
      column: vscode.ViewColumn.Active,
      extensionUri: context.extensionUri,
      icon: 'resources/favicon/api-dev.svg',
      floating: true,
      revealIfExists: false,
      options: {
        enableScripts: true,
        retainContextWhenHidden: true,
        enableFindWidget: true,
        localResourceRoots: [context.extensionUri],
      },
      htmlFactory: async (webview) => {
        let html = await this.reactWebviewHtmlWorkflow.createReactWebviewHtml({
          extensionUri: context.extensionUri,
          webview,
          routeName: API_DEV_TOOLS_WEBVIEW_ROUTE,
        });

        html = html.replace('</head>', '<script>window.__IS_FLOATING__=true</script></head>');

        return html;
      },
      onDidReceiveMessage: async (message) => {
        await this.handleIncomingMessage(message);
      },
      onDidDispose: () => {
        if (this.floatingPanel === panel) {
          this.floatingPanel = undefined;
          void vscode.commands.executeCommand('setContext', API_DEV_TOOLS_FLOATING_CONTEXT, false);
          void vscode.commands.executeCommand('setContext', API_DEV_TOOLS_WELCOME_VISIBLE_CONTEXT, false);

          this.view?.webview.postMessage({
            type: 'floatingEditorStateChanged',
            open: false,
          });
        }

        if (!this.view) {
          if (this.activeRequestId) {
            this.apiDevToolsService.stopApiRequest(this.activeRequestId);
          }

          this.activeRequestId = '';
          void this.setRequestLoading(false, true);
        }
      },
    });

    this.floatingPanel = panel;

    void vscode.commands.executeCommand('setContext', API_DEV_TOOLS_FLOATING_CONTEXT, true);
    void vscode.commands.executeCommand('setContext', API_DEV_TOOLS_WELCOME_VISIBLE_CONTEXT, true);

    this.view?.webview.postMessage({
      type: 'floatingEditorStateChanged',
      open: true,
    });

    /**
     * 等待新建的 WebviewPanel 成为活动编辑器后再执行浮动迁移。
     */
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    try {
      await vscode.commands.executeCommand('quickOps.webview.moveToFloatingWindow');
    } catch (error) {
      console.warn('[ApiDevToolsWebviewProvider] open floating editor failed:', error);
      vscode.window.showWarningMessage('无法将 API DevTools 移至浮动编辑器窗口。');
    }
  }

  public dispose(): void {
    if (this.activeRequestId) {
      this.apiDevToolsService.stopApiRequest(this.activeRequestId);
    }

    this.activeRequestId = '';
    this.view = undefined;
    this.floatingPanel?.dispose();
    this.floatingPanel = undefined;

    void this.setRequestLoading(false, true);

    this.apiDevToolsService.dispose();
  }

  /**
   * @description 执行 API DevTools 原生 View 标题栏操作
   */
  public async executeViewTitleAction(action: ApiDevToolsViewTitleAction): Promise<void> {
    if (this.floatingPanel?.visible) {
      void this.floatingPanel.webview.postMessage({
        type: API_DEV_TOOLS_VIEW_TITLE_ACTION_MESSAGE,
        action,
      });
      return;
    }

    if (!this.view) {
      await vscode.commands.executeCommand(`${ApiDevToolsWebviewProvider.viewType}.focus`);
    }

    this.view?.show(true);

    if (!this.view) return;

    void this.view.webview.postMessage({
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

      case 'stopApiRequest':
        if (this.activeRequestId) {
          this.apiDevToolsService.stopApiRequest(this.activeRequestId);
          this.activeRequestId = '';
          await this.setRequestLoading(false);
        }
        break;

      default:
        console.warn('[ApiDevToolsWebviewProvider] unknown message:', message);
        break;
    }
  }

  private async handleIncomingMessage(message: unknown): Promise<void> {
    try {
      await this.handleMessage(message as ApiDevToolsWebviewMessage);
    } catch (error) {
      console.error('[ApiDevToolsWebviewProvider] handleMessage failed:', error);

      vscode.window.showErrorMessage(`API 调试工具操作失败：${this.toErrorMessage(error)}`);
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
    if (this.view) {
      void this.view.webview.postMessage(message);
    }

    if (this.floatingPanel) {
      void this.floatingPanel.webview.postMessage(message);
    }
  }

  private toErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;

    return String(error);
  }
}
