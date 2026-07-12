import * as vscode from 'vscode';
import { WEBVIEW_CORE_EVENTS } from '@/workflow/webview/type';
import type { ETIRuntime, ETIRuntimeProvide } from '@core/eti/eti.type';
import type { WebviewCreateOptions, WebviewWorkflowEventContext } from '@/workflow/webview/type';

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
export default class WebviewWorkflow implements ETIRuntime {
  /**
   * @description WebviewWorkflow 单例实例
   *
   * 解决问题：
   * - ETI 注入 events 的 WebviewWorkflow 实例
   * - 业务调用 createWebview 的 WebviewWorkflow 实例
   * 不是同一个，导致 this.events 为空
   */
  private static instance: WebviewWorkflow | null = null;

  public readonly runtimeId = 'webview';

  private readonly panels = new Map<string, vscode.WebviewPanel>();

  /**
   * @description 存储每个 Webview 调用 createWebview 时传入的参数
   */
  private readonly createOptionsMap = new Map<string, WebviewCreateOptions<any>>();

  private events: Record<string, Function[]> = {};

  /**
   * @description 单例构造
   *
   * 注意：
   * - 不改成 private constructor
   * - 兼容你原来外部 new WebviewWorkflow() 的写法
   * - 多次 new WebviewWorkflow() 时，都会返回同一个实例
   */
  constructor() {
    if (WebviewWorkflow.instance) {
      return WebviewWorkflow.instance;
    }

    WebviewWorkflow.instance = this;
  }

  /**
   * @description 注册 Webview 工作流事件
   *
   * 这些 name 可以被 Plugin 的 on 监听。
   */
  public provide(): ETIRuntimeProvide {
    return {
      runtimeId: this.runtimeId,
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

    /**
     * @description 保存本次 createWebview 调用参数
     *
     * 放在 existingPanel 判断前面：
     * - 即使 Webview 已存在，只 reveal
     * - 也能记录本次调用参数
     */
    this.createOptionsMap.set(key, options);

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
      createOptionsMap: this.createOptionsMap,
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
        createOptionsMap: this.createOptionsMap,
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
        createOptionsMap: this.createOptionsMap,
      });

      this.panels.delete(key);

      /**
       * @description Webview 销毁时，同步移除创建参数缓存
       */
      this.createOptionsMap.delete(key);

      await options.onDidDispose?.(panel);

      await this.emitDisposed({
        key,
        viewType: options.viewType,
        title: options.title,
        panel,
        options,
        createOptionsMap: this.createOptionsMap,
      });
    });

    await this.emitCreated({
      key,
      viewType: options.viewType,
      title: options.title,
      panel,
      options,
      createOptionsMap: this.createOptionsMap,
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
   * @description 获取指定 Webview 最近一次 createWebview 的参数
   */
  public getCreateOptions<TMessage = any>(key: string): WebviewCreateOptions<TMessage> | undefined {
    return this.createOptionsMap.get(key) as WebviewCreateOptions<TMessage> | undefined;
  }

  /**
   * @description 获取所有 Webview 的 createWebview 参数
   */
  public getAllCreateOptions(): Map<string, WebviewCreateOptions<any>> {
    return this.createOptionsMap;
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
    this.createOptionsMap.clear();
  }

  private async emitBeforeCreate(context: WebviewWorkflowEventContext): Promise<void> {
    await this.emit(WEBVIEW_CORE_EVENTS.BEFORE_CREATE, context);
  }

  private async emitCreated(context: WebviewWorkflowEventContext): Promise<void> {
    await this.emit(WEBVIEW_CORE_EVENTS.CREATED, context);
  }

  private async emitBeforeDispose(context: WebviewWorkflowEventContext): Promise<void> {
    await this.emit(WEBVIEW_CORE_EVENTS.BEFORE_DISPOSE, context);
  }

  private async emitDisposed(context: WebviewWorkflowEventContext): Promise<void> {
    await this.emit(WEBVIEW_CORE_EVENTS.DISPOSED, context);
  }

  private async emitMessage(context: WebviewWorkflowEventContext): Promise<void> {
    await this.emit(WEBVIEW_CORE_EVENTS.MESSAGE, context);
  }

  private async emit(name: string, context: WebviewWorkflowEventContext): Promise<void> {
    const callbacks = this.events[name] || [];

    for (const callback of callbacks) {
      await callback(context);
    }
  }
}
