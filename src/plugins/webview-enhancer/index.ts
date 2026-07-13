import * as vscode from 'vscode';
import type { WebviewCreatedPayload, WebviewIcon } from '@plugins/webview-enhancer/type';

const ACTIVE_WEBVIEW_FULLSCREEN_CONTEXT = 'quickOps.activeWebview.fullscreen';

export class WebviewAppearancePlugin {
  /**
   * @description 记录配置了 fullscreen 的 WebviewPanel
   */
  private readonly fullscreenPanels = new Set<vscode.WebviewPanel>();

  /**
   * @description 插件内部创建的 disposable
   */
  private readonly disposables: vscode.Disposable[] = [];

  /**
   * @description 防止全局监听重复注册
   */
  private globalListenersRegistered = false;

  public init() {
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
   * @description Webview 创建完成后处理外观增强
   */
  private handleWebviewCreated(payload: WebviewCreatedPayload): void {
    const { panel } = payload;

    if (!panel) return;

    /**
     * 保留原来的图标逻辑
     */
    this.applyWebviewIcon(payload);

    /**
     * 新增 fullscreen 逻辑
     */
    this.registerGlobalListenersOnce();
    this.registerFullscreenPanel(payload);
    this.refreshFullscreenContext();
  }

  /**
   * @description Webview 销毁后清理 fullscreen 状态
   */
  private handleWebviewDisposed(payload: WebviewCreatedPayload): void {
    const { panel } = payload;

    if (!panel) return;

    this.fullscreenPanels.delete(panel);
    this.refreshFullscreenContext();
  }

  /**
   * @description 保留原来的 Webview 图标逻辑
   */
  private applyWebviewIcon(payload: WebviewCreatedPayload): void {
    const { panel, options } = payload;

    if (!panel) return;
    if (!options?.icon) return;
    if (!options.extensionUri) return;

    panel.iconPath = this.resolveIconPath(options.extensionUri, options.icon);
  }

  /**
   * @description 如果当前 Webview 配置了 fullscreen，则记录并监听它的激活状态
   */
  private registerFullscreenPanel(payload: WebviewCreatedPayload): void {
    const { panel, options } = payload;

    if (!panel) return;

    /**
     * 没配置 fullscreen 的 Webview 不参与 editor/title 按钮显示判断
     */
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

  /**
   * @description 注册全局监听，保证切换 tab / editor 时也能刷新 when context
   */
  private registerGlobalListenersOnce(): void {
    if (this.globalListenersRegistered) return;

    this.globalListenersRegistered = true;

    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => {
        this.refreshFullscreenContext();
      }),

      vscode.window.tabGroups.onDidChangeTabs(() => {
        this.refreshFullscreenContext();
      }),

      vscode.window.tabGroups.onDidChangeTabGroups(() => {
        this.refreshFullscreenContext();
      }),
    );
  }

  /**
   * @description 刷新当前激活 tab 是否是 fullscreen Webview
   */
  private refreshFullscreenContext(): void {
    const isActiveFullscreenWebview = Array.from(this.fullscreenPanels).some((panel) => {
      return panel.active && panel.visible;
    });

    void vscode.commands.executeCommand(ACTIVE_WEBVIEW_FULLSCREEN_CONTEXT, isActiveFullscreenWebview);
  }

  /**
   * @description 解析 Webview 图标路径
   */
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

    void vscode.commands.executeCommand(ACTIVE_WEBVIEW_FULLSCREEN_CONTEXT, false);
  }
}

export default WebviewAppearancePlugin;