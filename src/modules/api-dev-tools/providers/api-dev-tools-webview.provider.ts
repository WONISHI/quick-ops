import * as vscode from 'vscode';
import ReactWebviewHtmlWorkflow from '@/workflow/react-webview-html';
import { ExtensionContextProvider } from '@common/providers/extension-context.provider';
import { API_DEV_TOOLS_VIEW_TYPE, API_DEV_TOOLS_WEBVIEW_ROUTE } from '@modules/api-dev-tools/api-dev-tools.constant';
import { ApiDevToolsService } from '@modules/api-dev-tools/api-dev-tools.service';
import type { ApiDevToolsRequestPayload, ApiDevToolsWebviewMessage, ApiDocsPayload } from '@modules/api-dev-tools/api-dev-tools.type';

export class ApiDevToolsWebviewProvider implements vscode.WebviewViewProvider {
  public static inject = [ExtensionContextProvider, ApiDevToolsService];

  public static readonly viewType = API_DEV_TOOLS_VIEW_TYPE;

  private view?: vscode.WebviewView;
  private readonly reactWebviewHtmlWorkflow = new ReactWebviewHtmlWorkflow();

  constructor(
    private readonly extensionContextProvider: ExtensionContextProvider,
    private readonly apiDevToolsService: ApiDevToolsService,
  ) {}

  public async resolveWebviewView(webviewView: vscode.WebviewView, _context: vscode.WebviewViewResolveContext, _token: vscode.CancellationToken): Promise<void> {
    const context = this.extensionContextProvider.getContext();

    this.view = webviewView;

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
        this.view = undefined;
      }
    });
  }

  public dispose(): void {
    this.view = undefined;
    this.apiDevToolsService.dispose();
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
        const response = await this.apiDevToolsService.executeApiRequest(message.payload as ApiDevToolsRequestPayload);

        this.postMessage({
          type: 'apiResponse',
          payload: response,
        });
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
