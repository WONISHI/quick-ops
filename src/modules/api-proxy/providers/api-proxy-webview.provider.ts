import * as vscode from 'vscode';
import ReactWebviewHtmlWorkflow from '@/workflow/react-webview-html';
import { ExtensionContextProvider } from '@common/providers/extension-context.provider';
import { ApiProxyService } from '@modules/api-proxy/api-proxy.service';
import {
  API_PROXY_EDITOR_VIEW_TYPE,
  API_PROXY_EDITOR_WEBVIEW_ROUTE,
  API_PROXY_LIST_VIEW_TYPE,
  API_PROXY_LIST_WEBVIEW_ROUTE,
} from '@modules/api-proxy/constants/api-proxy.constant';
import type { ApiProxyLogItem, ApiProxyWebviewMessage } from '@modules/api-proxy/api-proxy.type';

export class ApiProxyWebviewProvider implements vscode.WebviewViewProvider {
  public static inject = [ExtensionContextProvider, ApiProxyService];

  public static readonly listViewType = API_PROXY_LIST_VIEW_TYPE;
  public static readonly editorViewType = API_PROXY_EDITOR_VIEW_TYPE;

  private readonly views = new Map<string, vscode.WebviewView>();
  private readonly reactWebviewHtmlWorkflow = new ReactWebviewHtmlWorkflow();
  private editorPanel?: vscode.WebviewPanel;
  private activeRuleId = '';

  private readonly handleLogsChanged = (_logs: ApiProxyLogItem[]) => {
    this.postState();
  };

  constructor(
    private readonly extensionContextProvider: ExtensionContextProvider,
    private readonly apiProxyService: ApiProxyService,
  ) {
    this.apiProxyService.on('logsChanged', this.handleLogsChanged);
  }

  public async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
    const context = this.extensionContextProvider.getContext();
    const routeName = webviewView.viewType === API_PROXY_EDITOR_VIEW_TYPE ? API_PROXY_EDITOR_WEBVIEW_ROUTE : API_PROXY_LIST_WEBVIEW_ROUTE;

    this.views.set(webviewView.viewType, webviewView);

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [context.extensionUri],
    };

    webviewView.webview.html = await this.reactWebviewHtmlWorkflow.createReactWebviewHtml({
      extensionUri: context.extensionUri,
      webview: webviewView.webview,
      routeName,
    });

    webviewView.webview.onDidReceiveMessage(async (message: ApiProxyWebviewMessage) => {
      await this.handleMessage(message);
    });

    webviewView.onDidDispose(() => {
      this.views.delete(webviewView.viewType);
    });
  }

  public dispose(): void {
    this.apiProxyService.off('logsChanged', this.handleLogsChanged);
    this.views.clear();
    this.apiProxyService.dispose();
  }

  private postState(): void {
    this.postMessage({
      type: 'apiProxyState',
      rules: this.apiProxyService.getRules(),
      logs: this.apiProxyService.getLogs(),
      server: this.apiProxyService.getServerState(),
      activeRuleId: this.activeRuleId,
    });
  }

  private async openEditorPanel(ruleId = ''): Promise<void> {
    const context = this.extensionContextProvider.getContext();

    this.activeRuleId = ruleId;

    if (this.editorPanel) {
      this.editorPanel.reveal(vscode.ViewColumn.One, false);
      this.postState();
      return;
    }

    const panel = vscode.window.createWebviewPanel(ApiProxyWebviewProvider.editorViewType, '接口代理配置', vscode.ViewColumn.One, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [context.extensionUri],
    });

    this.editorPanel = panel;

    panel.webview.html = await this.reactWebviewHtmlWorkflow.createReactWebviewHtml({
      extensionUri: context.extensionUri,
      webview: panel.webview,
      routeName: API_PROXY_EDITOR_WEBVIEW_ROUTE,
    });

    panel.webview.onDidReceiveMessage(async (message: ApiProxyWebviewMessage) => {
      await this.handleMessage(message);
    });

    panel.onDidDispose(() => {
      if (this.editorPanel === panel) {
        this.editorPanel = undefined;
      }
    });

    this.postState();
  }

  private postMessage(message: Record<string, unknown>): void {
    this.views.forEach((view) => {
      void view.webview.postMessage(message);
    });

    void this.editorPanel?.webview.postMessage(message);
  }

  private async handleMessage(message: ApiProxyWebviewMessage): Promise<void> {
    switch (message?.type) {
      case 'apiProxyReady':
        this.postState();
        break;

      case 'saveApiProxyRules':
        await this.apiProxyService.saveRules(message.rules || []);
        this.postState();
        break;

      case 'startApiProxyServer':
        await this.apiProxyService.startServer(Number(message.port || 0));
        this.postState();
        break;

      case 'stopApiProxyServer':
        await this.apiProxyService.stopServer();
        this.postState();
        break;

      case 'clearApiProxyLogs':
        this.apiProxyService.clearLogs();
        this.postState();
        break;

      case 'openApiProxyEditor':
        await this.openEditorPanel(String(message.ruleId || ''));
        break;

      default:
        break;
    }
  }
}
