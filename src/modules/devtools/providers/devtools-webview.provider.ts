import * as vscode from 'vscode';
import { getReactWebviewHtml } from '../../../utils/WebviewHelper';
import { ExtensionContextProvider } from '../../../common/providers/extension-context.provider';

export class DevToolsWebviewProvider implements vscode.WebviewViewProvider {
  public static inject = [ExtensionContextProvider];

  public static readonly viewType = 'quickOps.devtoolsView';
  public static readonly viewContainerId = 'quickOpsDevTools';

  private view?: vscode.WebviewView;
  private devToolsUrl = '';

  constructor(private readonly extensionContextProvider: ExtensionContextProvider) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView;

    const context = this.extensionContextProvider.getContext();

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [context.extensionUri],
    };

    webviewView.webview.html = getReactWebviewHtml(
      context.extensionUri,
      webviewView.webview,
      '/devtools',
    );

    webviewView.webview.onDidReceiveMessage(async message => {
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
    this.view = undefined;
    this.devToolsUrl = '';
  }

  private postInit(): void {
    if (!this.view) return;

    this.view.webview.postMessage({
      type: 'init',
      devToolsUrl: this.devToolsUrl,
    });
  }

  private async focusPanel(): Promise<void> {
    await vscode.commands
      .executeCommand(
        `workbench.view.extension.${DevToolsWebviewProvider.viewContainerId}`,
      )
      .then(
        () => undefined,
        async () => {
          await vscode.commands
            .executeCommand(`${DevToolsWebviewProvider.viewType}.focus`)
            .then(
              () => undefined,
              () => undefined,
            );
        },
      );
  }
}