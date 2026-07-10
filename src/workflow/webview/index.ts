import * as vscode from 'vscode';
import { WEBVIEW_CORE_EVENTS } from '@/workflow/webview/type';
import type { ETICore, ETICoreProvide } from '@core/eti/eti.type';
import type { WebviewCreateOptions, WebviewCoreEventContext } from '@/workflow/webview/type';

/**
 * @description Webview 工作流 Core
 *
 * 用途：
 * - 统一创建 WebviewPanel
 * - 统一处理 Webview 生命周期
 * - 统一触发 ETI Plugin 生命周期事件
 *
 * Plugin 可以监听：
 * - webview:beforeCreate
 * - webview:created
 * - webview:beforeDispose
 * - webview:disposed
 * - webview:message
 */
export default class WebviewCore implements ETICore {
  public readonly coreId = 'webview';

  private readonly panels = new Map<string, vscode.WebviewPanel>();

  private events: Record<string, Function[]> = {};

  /**
   * @description 注册 Webview 工作流事件
   *
   * 这些 name 可以被 Plugin 的 on 监听。
   */
  public provide(): ETICoreProvide {
    return {
      coreId: this.coreId,
      register: [
        {
          name: WEBVIEW_CORE_EVENTS.BEFORE_CREATE,
          callback: this.emitBeforeCreate.bind(this),
        },
        {
          name: WEBVIEW_CORE_EVENTS.CREATED,
          callback: this.emitCreated.bind(this),
        },
        {
          name: WEBVIEW_CORE_EVENTS.BEFORE_DISPOSE,
          callback: this.emitBeforeDispose.bind(this),
        },
        {
          name: WEBVIEW_CORE_EVENTS.DISPOSED,
          callback: this.emitDisposed.bind(this),
        },
        {
          name: WEBVIEW_CORE_EVENTS.MESSAGE,
          callback: this.emitMessage.bind(this),
        },
      ],
    };
  }

  /**
   * @description ETI 注入 Plugin 监听事件
   */
  public inject(events: Record<string, Function[]>): void {
    this.events = events;
  }

  /**
   * @description 创建 WebviewPanel
   */
  public async createWebview<TMessage = any>(options: WebviewCreateOptions<TMessage>): Promise<vscode.WebviewPanel> {
    const key = options.key || options.viewType;
    const revealIfExists = options.revealIfExists !== false;

    const existingPanel = this.panels.get(key);

    if (existingPanel && revealIfExists) {
      existingPanel.reveal(options.column || vscode.ViewColumn.Beside);
      return existingPanel;
    }

    await this.emitBeforeCreate({
      key,
      viewType: options.viewType,
      title: options.title,
      options,
    });

    const panel = vscode.window.createWebviewPanel(options.viewType, options.title, options.column || vscode.ViewColumn.Beside, {
      enableScripts: true,
      retainContextWhenHidden: true,
      ...options.options,
    });

    if (options.iconPath) {
      panel.iconPath = options.iconPath;
    }

    if (options.htmlFactory) {
      panel.webview.html = options.htmlFactory(panel.webview, panel);
    } else if (options.html) {
      panel.webview.html = options.html;
    }

    this.panels.set(key, panel);

    panel.webview.onDidReceiveMessage(async (message: TMessage) => {
      await this.emitMessage({
        key,
        viewType: options.viewType,
        title: options.title,
        panel,
        message,
        options,
      });

      await options.onDidReceiveMessage?.(message, panel);
    });

    panel.onDidDispose(async () => {
      await this.emitBeforeDispose({
        key,
        viewType: options.viewType,
        title: options.title,
        panel,
        options,
      });

      this.panels.delete(key);

      await options.onDidDispose?.(panel);

      await this.emitDisposed({
        key,
        viewType: options.viewType,
        title: options.title,
        panel,
        options,
      });
    });

    await this.emitCreated({
      key,
      viewType: options.viewType,
      title: options.title,
      panel,
      options,
    });

    return panel;
  }

  /**
   * @description 获取已创建的 WebviewPanel
   */
  public getPanel(key: string): vscode.WebviewPanel | undefined {
    return this.panels.get(key);
  }

  /**
   * @description 判断 WebviewPanel 是否存在
   */
  public hasPanel(key: string): boolean {
    return this.panels.has(key);
  }

  /**
   * @description 主动销毁指定 WebviewPanel
   */
  public async disposePanel(key: string): Promise<void> {
    const panel = this.panels.get(key);

    if (!panel) return;

    panel.dispose();
  }

  /**
   * @description 销毁所有 WebviewPanel
   */
  public async dispose(): Promise<void> {
    for (const panel of this.panels.values()) {
      panel.dispose();
    }

    this.panels.clear();
  }

  private async emitBeforeCreate(context: WebviewCoreEventContext): Promise<void> {
    await this.emit(WEBVIEW_CORE_EVENTS.BEFORE_CREATE, context);
  }

  private async emitCreated(context: WebviewCoreEventContext): Promise<void> {
    await this.emit(WEBVIEW_CORE_EVENTS.CREATED, context);
  }

  private async emitBeforeDispose(context: WebviewCoreEventContext): Promise<void> {
    await this.emit(WEBVIEW_CORE_EVENTS.BEFORE_DISPOSE, context);
  }

  private async emitDisposed(context: WebviewCoreEventContext): Promise<void> {
    await this.emit(WEBVIEW_CORE_EVENTS.DISPOSED, context);
  }

  private async emitMessage(context: WebviewCoreEventContext): Promise<void> {
    await this.emit(WEBVIEW_CORE_EVENTS.MESSAGE, context);
  }

  private async emit(name: string, context: WebviewCoreEventContext): Promise<void> {
    const callbacks = this.events[name] || [];

    for (const callback of callbacks) {
      await callback(context);
    }
  }
}
