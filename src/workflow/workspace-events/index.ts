import * as path from 'path';
import * as vscode from 'vscode';
import type { ETIRuntime, ETIRuntimeProvide } from '@core/eti/eti.type';
import {
  WORKSPACE_EVENTS,
  type WorkspaceDocumentFilterOptions,
  type WorkspaceEventContext,
  type WorkspaceEventHandler,
  type WorkspaceEventMap,
  type WorkspaceEventName,
} from './type';

type AnyWorkspaceEventHandler = (context: WorkspaceEventContext) => void | Promise<void>;

interface LocalHandlerItem {
  eventName: WorkspaceEventName;
  handler: AnyWorkspaceEventHandler;
  options?: WorkspaceDocumentFilterOptions;
}

/**
 * @description Workspace Events 工作流 Core
 *
 * 作用：
 * 1. 统一注册 VSCode workspace / window 原生事件
 * 2. 通过 provide() 向 ETI 暴露可监听事件
 * 3. 通过 inject() 接收 plugin.on 注册的监听回调
 * 4. 原生事件触发后，统一 emit 给 plugin 和本地业务监听
 */
export default class WorkspaceEventsWorkflow implements ETIRuntime, vscode.Disposable {
  public readonly runtimeId = 'workspace-events';

  /**
   * @description 暴露给业务模块使用的事件常量
   *
   * 使用：
   * workspaceEventsWorkflow.events.DID_SAVE_TEXT_DOCUMENT
   */
  public readonly events = WORKSPACE_EVENTS;

  private initialized = false;

  private readonly disposables: vscode.Disposable[] = [];

  /**
   * @description inject 注入进来的 ETI plugin 监听器
   */
  private injectedEvents: Record<string, Function[]> = {};

  /**
   * @description 业务模块直接通过 workflow.on 注册的监听器
   */
  private readonly localHandlers = new Map<WorkspaceEventName, Set<LocalHandlerItem>>();

  /**
   * @description 向 ETI 暴露当前 Core 支持的事件
   *
   * Plugin 可以监听这些事件：
   *
   * plugin.init() {
   *   return {
   *     pluginId: 'xxx',
   *     on: [
   *       {
   *         name: WORKSPACE_EVENTS.DID_SAVE_TEXT_DOCUMENT,
   *         callback: async (context) => {}
   *       }
   *     ]
   *   }
   * }
   */
  public provide(): ETIRuntimeProvide {
    return {
      runtimeId: this.runtimeId,
      register: [
        {
          name: WORKSPACE_EVENTS.DID_SAVE_TEXT_DOCUMENT,
          callback: this.emitDidSaveTextDocument.bind(this),
        },
        {
          name: WORKSPACE_EVENTS.DID_CHANGE_TEXT_DOCUMENT,
          callback: this.emitDidChangeTextDocument.bind(this),
        },
        {
          name: WORKSPACE_EVENTS.DID_OPEN_TEXT_DOCUMENT,
          callback: this.emitDidOpenTextDocument.bind(this),
        },
        {
          name: WORKSPACE_EVENTS.DID_CLOSE_TEXT_DOCUMENT,
          callback: this.emitDidCloseTextDocument.bind(this),
        },
        {
          name: WORKSPACE_EVENTS.DID_CHANGE_ACTIVE_TEXT_EDITOR,
          callback: this.emitDidChangeActiveTextEditor.bind(this),
        },
        {
          name: WORKSPACE_EVENTS.DID_CHANGE_CONFIGURATION,
          callback: this.emitDidChangeConfiguration.bind(this),
        },
        {
          name: WORKSPACE_EVENTS.DID_CHANGE_WORKSPACE_FOLDERS,
          callback: this.emitDidChangeWorkspaceFolders.bind(this),
        },
      ],
    };
  }

  /**
   * @description 接收 ETI 注入的 plugin 监听器
   */
  public inject(events: Record<string, Function[]>): void {
    this.injectedEvents = events;
  }

  /**
   * @description 初始化 VSCode 原生监听
   *
   * 可以重复调用，内部只会注册一次。
   */
  public init(context?: vscode.ExtensionContext): void {
    if (this.initialized) return;

    this.initialized = true;

    this.disposables.push(
      vscode.workspace.onDidSaveTextDocument((doc) => {
        void this.emitDidSaveTextDocument(doc);
      }),

      vscode.workspace.onDidChangeTextDocument((event) => {
        void this.emitDidChangeTextDocument(event);
      }),

      vscode.workspace.onDidOpenTextDocument((doc) => {
        void this.emitDidOpenTextDocument(doc);
      }),

      vscode.workspace.onDidCloseTextDocument((doc) => {
        void this.emitDidCloseTextDocument(doc);
      }),

      vscode.window.onDidChangeActiveTextEditor((editor) => {
        void this.emitDidChangeActiveTextEditor(editor);
      }),

      vscode.workspace.onDidChangeConfiguration((event) => {
        void this.emitDidChangeConfiguration(event);
      }),

      vscode.workspace.onDidChangeWorkspaceFolders((event) => {
        void this.emitDidChangeWorkspaceFolders(event);
      }),
    );

    if (context) {
      context.subscriptions.push(this);
    }
  }

  /**
   * @description 业务模块直接监听 workflow 事件
   *
   * 这个不是 ETI plugin 监听。
   * 这是给普通模块直接使用的。
   */
  public on<T extends WorkspaceEventName>(
    eventName: T,
    handler: WorkspaceEventHandler<T>,
    options?: WorkspaceDocumentFilterOptions,
  ): vscode.Disposable {
    const item: LocalHandlerItem = {
      eventName,
      handler: handler as AnyWorkspaceEventHandler,
      options,
    };

    const handlers = this.getLocalHandlers(eventName);

    handlers.add(item);

    return {
      dispose: () => {
        handlers.delete(item);
      },
    };
  }

  private async emitDidSaveTextDocument(payload: WorkspaceEventMap[typeof WORKSPACE_EVENTS.DID_SAVE_TEXT_DOCUMENT]): Promise<void> {
    await this.emit(WORKSPACE_EVENTS.DID_SAVE_TEXT_DOCUMENT, payload);
  }

  private async emitDidChangeTextDocument(payload: WorkspaceEventMap[typeof WORKSPACE_EVENTS.DID_CHANGE_TEXT_DOCUMENT]): Promise<void> {
    await this.emit(WORKSPACE_EVENTS.DID_CHANGE_TEXT_DOCUMENT, payload);
  }

  private async emitDidOpenTextDocument(payload: WorkspaceEventMap[typeof WORKSPACE_EVENTS.DID_OPEN_TEXT_DOCUMENT]): Promise<void> {
    await this.emit(WORKSPACE_EVENTS.DID_OPEN_TEXT_DOCUMENT, payload);
  }

  private async emitDidCloseTextDocument(payload: WorkspaceEventMap[typeof WORKSPACE_EVENTS.DID_CLOSE_TEXT_DOCUMENT]): Promise<void> {
    await this.emit(WORKSPACE_EVENTS.DID_CLOSE_TEXT_DOCUMENT, payload);
  }

  private async emitDidChangeActiveTextEditor(payload: WorkspaceEventMap[typeof WORKSPACE_EVENTS.DID_CHANGE_ACTIVE_TEXT_EDITOR]): Promise<void> {
    await this.emit(WORKSPACE_EVENTS.DID_CHANGE_ACTIVE_TEXT_EDITOR, payload);
  }

  private async emitDidChangeConfiguration(payload: WorkspaceEventMap[typeof WORKSPACE_EVENTS.DID_CHANGE_CONFIGURATION]): Promise<void> {
    await this.emit(WORKSPACE_EVENTS.DID_CHANGE_CONFIGURATION, payload);
  }

  private async emitDidChangeWorkspaceFolders(payload: WorkspaceEventMap[typeof WORKSPACE_EVENTS.DID_CHANGE_WORKSPACE_FOLDERS]): Promise<void> {
    await this.emit(WORKSPACE_EVENTS.DID_CHANGE_WORKSPACE_FOLDERS, payload);
  }

  /**
   * @description 统一触发 workspace 事件
   *
   * 触发顺序：
   * 1. injectedEvents：ETI plugin 的 on 监听
   * 2. localHandlers：业务模块 workflow.on 监听
   */
  private async emit<T extends WorkspaceEventName>(eventName: T, payload: WorkspaceEventMap[T]): Promise<void> {
    const context: WorkspaceEventContext<T> = {
      eventName,
      payload,
      document: this.getDocumentFromPayload(eventName, payload),
    };

    await this.emitInjectedHandlers(eventName, context);
    await this.emitLocalHandlers(eventName, context);
  }

  /**
   * @description 触发 ETI plugin 注入的监听
   */
  private async emitInjectedHandlers<T extends WorkspaceEventName>(eventName: T, context: WorkspaceEventContext<T>): Promise<void> {
    const callbacks = this.injectedEvents[eventName] || [];

    for (const callback of callbacks) {
      try {
        await callback(context);
      } catch (error) {
        console.error(`[WorkspaceEventsWorkflow] injected handler failed: ${eventName}`, error);
      }
    }
  }

  /**
   * @description 触发业务模块直接注册的监听
   */
  private async emitLocalHandlers<T extends WorkspaceEventName>(eventName: T, context: WorkspaceEventContext<T>): Promise<void> {
    const handlers = this.localHandlers.get(eventName);

    if (!handlers?.size) return;

    for (const item of handlers) {
      if (!this.matchContextDocument(context, item.options)) {
        continue;
      }

      try {
        await item.handler(context as WorkspaceEventContext);
      } catch (error) {
        console.error(`[WorkspaceEventsWorkflow] local handler failed: ${eventName}`, error);
      }
    }
  }

  private getLocalHandlers(eventName: WorkspaceEventName): Set<LocalHandlerItem> {
    let handlers = this.localHandlers.get(eventName);

    if (!handlers) {
      handlers = new Set<LocalHandlerItem>();
      this.localHandlers.set(eventName, handlers);
    }

    return handlers;
  }

  /**
   * @description 判断本地监听是否命中文档过滤条件
   *
   * 注意：
   * ETI plugin 监听不做过滤。
   * 如果 plugin 需要过滤，可以在 plugin callback 内自己判断。
   */
  private matchContextDocument(context: WorkspaceEventContext, options?: WorkspaceDocumentFilterOptions): boolean {
    if (!options) {
      return true;
    }

    if (!context.document) {
      return false;
    }

    return this.matchDocument(context.document, options);
  }

  private getDocumentFromPayload<T extends WorkspaceEventName>(eventName: T, payload: WorkspaceEventMap[T]): vscode.TextDocument | undefined {
    switch (eventName) {
      case WORKSPACE_EVENTS.DID_SAVE_TEXT_DOCUMENT:
      case WORKSPACE_EVENTS.DID_OPEN_TEXT_DOCUMENT:
      case WORKSPACE_EVENTS.DID_CLOSE_TEXT_DOCUMENT:
        return payload as vscode.TextDocument;

      case WORKSPACE_EVENTS.DID_CHANGE_TEXT_DOCUMENT:
        return (payload as vscode.TextDocumentChangeEvent).document;

      case WORKSPACE_EVENTS.DID_CHANGE_ACTIVE_TEXT_EDITOR:
        return (payload as vscode.TextEditor | undefined)?.document;

      default:
        return undefined;
    }
  }

  private matchDocument(doc: vscode.TextDocument, options?: WorkspaceDocumentFilterOptions): boolean {
    const fileOnly = options?.fileOnly !== false;

    if (fileOnly && doc.uri.scheme !== 'file') {
      return false;
    }

    if (options?.extensions?.length) {
      const ext = path.extname(doc.uri.fsPath).toLowerCase();

      const extensions = options.extensions.map((item) => {
        if (item.startsWith('.')) {
          return item.toLowerCase();
        }

        return `.${item.toLowerCase()}`;
      });

      if (!extensions.includes(ext)) {
        return false;
      }
    }

    if (options?.filter && !options.filter(doc)) {
      return false;
    }

    return true;
  }

  public dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }

    this.disposables.length = 0;
    this.localHandlers.clear();
    this.injectedEvents = {};
    this.initialized = false;
  }
}

export { WORKSPACE_EVENTS };

export type {
  WorkspaceDocumentFilterOptions,
  WorkspaceEventContext,
  WorkspaceEventHandler,
  WorkspaceEventMap,
  WorkspaceEventName,
};