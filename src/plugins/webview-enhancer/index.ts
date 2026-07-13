import * as vscode from 'vscode';
import type { WebviewCreatedPayload, WebviewIcon } from '@plugins/webview-enhancer/type';
import { WORKSPACE_EVENTS } from '@workflow/workspace-events/type';
import type { WorkspaceOn, WebviewAppearancePluginInitOptions } from '@plugins/webview-enhancer/type';

const ACTIVE_WEBVIEW_FULLSCREEN_CONTEXT = 'quickOps.activeWebview.fullscreen';
const TOGGLE_WEBVIEW_FULLSCREEN_COMMAND = 'quickOps.webview.toggleFullscreen';

export class WebviewAppearancePlugin {
  public readonly use = ['on'] as const;

  private workspaceOn?: WorkspaceOn;

  private readonly fullscreenPanels = new Set<vscode.WebviewPanel>();

  private readonly disposables: vscode.Disposable[] = [];

  private globalListenersRegistered = false;

  private commandRegistered = false;

  public init({ on }: WebviewAppearancePluginInitOptions = {}) {
    this.workspaceOn = on;

    this.registerCommandsOnce();

    return {
      pluginId: 'webview-appearance-plugin',
      on: [
        {
          name: 'webview:created',
          callback: this.handleWebviewCreated.bind(this),
        },
        {
          name: 'webview:disposed',
          callback: this.handleWebviewDisposed.bind(this),
        },
      ],
    };
  }

  /**
   * @description 注册 editor/title 按钮点击命令
   */
  private registerCommandsOnce(): void {
    if (this.commandRegistered) return;

    this.commandRegistered = true;

    this.disposables.push(
      vscode.commands.registerCommand(TOGGLE_WEBVIEW_FULLSCREEN_COMMAND, async () => {
        await this.toggleFullscreen();
      }),
    );
  }

  /**
   * @description 执行 Webview 放大 / 还原
   */
  private async toggleFullscreen(): Promise<void> {
    try {
      await vscode.commands.executeCommand('workbench.action.toggleMaximizeEditorGroup');
    } catch (error) {
      console.warn('[WebviewAppearancePlugin] toggle maximize failed, trying fallback.', error);

      await vscode.commands.executeCommand('workbench.action.minimizeOtherEditors');
    }
  }

  private handleWebviewCreated(payload: WebviewCreatedPayload): void {
    const { panel } = payload;

    if (!panel) return;

    this.applyWebviewIcon(payload);

    this.registerGlobalListenersOnce();
    this.registerFullscreenPanel(payload);
    this.refreshFullscreenContext();
  }

  private handleWebviewDisposed(payload: WebviewCreatedPayload): void {
    const { panel } = payload;

    if (!panel) return;

    this.fullscreenPanels.delete(panel);
    this.refreshFullscreenContext();
  }

  private applyWebviewIcon(payload: WebviewCreatedPayload): void {
    const { panel, options } = payload;

    if (!panel) return;
    if (!options?.icon) return;
    if (!options.extensionUri) return;

    panel.iconPath = this.resolveIconPath(options.extensionUri, options.icon);
  }

  private registerFullscreenPanel(payload: WebviewCreatedPayload): void {
    const { panel, options } = payload;

    if (!panel) return;

    if (!options?.fullscreen) {
      return;
    }

    this.fullscreenPanels.add(panel);

    this.disposables.push(
      panel.onDidChangeViewState(() => {
        this.refreshFullscreenContext();
      }),

      panel.onDidDispose(() => {
        this.fullscreenPanels.delete(panel);
        this.refreshFullscreenContext();
      }),
    );
  }

  private registerGlobalListenersOnce(): void {
    if (this.globalListenersRegistered) return;

    if (!this.workspaceOn) {
      console.warn('[WebviewAppearancePlugin] workspace-events on is not injected.');
      return;
    }

    this.globalListenersRegistered = true;

    this.disposables.push(
      this.workspaceOn(WORKSPACE_EVENTS.DID_CHANGE_ACTIVE_TEXT_EDITOR, () => {
        this.refreshFullscreenContext();
      }),

      this.workspaceOn(WORKSPACE_EVENTS.DID_CHANGE_TABS, () => {
        this.refreshFullscreenContext();
      }),

      this.workspaceOn(WORKSPACE_EVENTS.DID_CHANGE_TAB_GROUPS, () => {
        this.refreshFullscreenContext();
      }),
    );
  }

  private refreshFullscreenContext(): void {
    const isActiveFullscreenWebview = Array.from(this.fullscreenPanels).some((panel) => {
      return panel.active && panel.visible;
    });

    void vscode.commands.executeCommand('setContext', ACTIVE_WEBVIEW_FULLSCREEN_CONTEXT, isActiveFullscreenWebview);
  }

  private resolveIconPath(extensionUri: vscode.Uri, icon: WebviewIcon): vscode.Uri | { light: vscode.Uri; dark: vscode.Uri } {
    if (typeof icon === 'string') {
      return vscode.Uri.joinPath(extensionUri, icon);
    }

    return {
      light: vscode.Uri.joinPath(extensionUri, icon.light),
      dark: vscode.Uri.joinPath(extensionUri, icon.dark),
    };
  }

  public dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }

    this.disposables.length = 0;
    this.fullscreenPanels.clear();
    this.globalListenersRegistered = false;
    this.commandRegistered = false;
    this.workspaceOn = undefined;

    void vscode.commands.executeCommand('setContext', ACTIVE_WEBVIEW_FULLSCREEN_CONTEXT, false);
  }
}

export default WebviewAppearancePlugin;