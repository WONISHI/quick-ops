import * as vscode from 'vscode';
import ReactWebviewHtmlWorkflow from '@/workflow/react-webview-html';
import { ExtensionContextProvider } from '@common/providers/extension-context.provider';

/**
 * @description Live Preview DevTools WebviewView Provider
 *
 * 负责：
 * - 在侧边栏承载 Chrome DevTools 页面
 * - 接收 EmbeddedBrowserService 生成的 DevTools URL
 * - 支持重新加载和外部浏览器打开
 */
export class DevToolsWebviewProvider implements vscode.WebviewViewProvider {
  public static inject = [ExtensionContextProvider];

  public static readonly viewType = 'quickOps.devtoolsView';
  public static readonly viewContainerId = 'quickOpsDevTools';

  private view?: vscode.WebviewView;
  private devToolsUrl = '';

  private readonly reactWebviewHtmlWorkflow = new ReactWebviewHtmlWorkflow();

  constructor(private readonly extensionContextProvider: ExtensionContextProvider) {}

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
      routeName: '/devtools',
    });

    webviewView.webview.onDidReceiveMessage(async (message) => {
      if (message.type === 'ready') {
        this.postInit();
        return;
      }

      if (message.type === 'openExternalDevTools' && message.url) {
        await vscode.env.openExternal(vscode.Uri.parse(String(message.url)));
        return;
      }

      if (message.type === 'reloadDevTools') {
        this.postInit();
      }
    });

    webviewView.onDidDispose(() => {
      if (this.view === webviewView) {
        this.view = undefined;
      }
    });
  }

  public async open(devToolsUrl: string): Promise<void> {
    this.devToolsUrl = String(devToolsUrl || '').trim();

    await this.focusPanel();

    if (this.view) {
      this.postInit();
      return;
    }

    setTimeout(() => {
      this.postInit();
    }, 120);
  }

  public clear(): void {
    this.devToolsUrl = '';
    this.postInit();
  }

  public dispose(): void {
    this.clear();
    this.view = undefined;
  }

  private postInit(): void {
    if (!this.view) return;

    void this.view.webview.postMessage({
      type: 'init',
      devToolsUrl: this.devToolsUrl,
    });
  }

  private async focusPanel(): Promise<void> {
    await vscode.commands.executeCommand(`workbench.view.extension.${DevToolsWebviewProvider.viewContainerId}`).then(
      () => undefined,
      async () => {
        await vscode.commands.executeCommand(`${DevToolsWebviewProvider.viewType}.focus`).then(
          () => undefined,
          () => undefined,
        );
      },
    );
  }
}
