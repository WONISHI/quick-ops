import * as path from 'path';
import * as vscode from 'vscode';
import type { ETIRuntime, ETIRuntimeProvide } from '@core/eti/eti.type';
import { WORKSPACE_EVENTS } from './type';
import type {
  AnyWorkspaceEventHandler,
  LocalHandlerItem,
  WorkspaceDocumentFilterOptions,
  WorkspaceEventContext,
  WorkspaceEventHandler,
  WorkspaceEventMap,
  WorkspaceEventName,
} from './type';

/**
 * @description Workspace Events 工作流 Runtime
 *
 * 作用：
 * 1. 统一注册 VSCode workspace / window / debug / tasks 原生事件
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
   * @description 向 ETI 暴露当前 Runtime 支持的事件
   */
  public provide(): ETIRuntimeProvide {
    return {
      runtimeId: this.runtimeId,
      register: this.getRegisterEvents().map((eventName) => {
        return {
          name: eventName,
          callback: (payload: any) => {
            return this.emit(eventName, payload);
          },
        };
      }),
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
      /**
       * TextDocument
       */
      vscode.workspace.onDidSaveTextDocument((doc) => {
        void this.emit(WORKSPACE_EVENTS.DID_SAVE_TEXT_DOCUMENT, doc);
      }),

      vscode.workspace.onWillSaveTextDocument((event) => {
        void this.emit(WORKSPACE_EVENTS.WILL_SAVE_TEXT_DOCUMENT, event);
      }),

      vscode.workspace.onDidChangeTextDocument((event) => {
        void this.emit(WORKSPACE_EVENTS.DID_CHANGE_TEXT_DOCUMENT, event);
      }),

      vscode.workspace.onDidOpenTextDocument((doc) => {
        void this.emit(WORKSPACE_EVENTS.DID_OPEN_TEXT_DOCUMENT, doc);
      }),

      vscode.workspace.onDidCloseTextDocument((doc) => {
        void this.emit(WORKSPACE_EVENTS.DID_CLOSE_TEXT_DOCUMENT, doc);
      }),

      /**
       * Window / Editor
       */
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        void this.emit(WORKSPACE_EVENTS.DID_CHANGE_ACTIVE_TEXT_EDITOR, editor);
      }),

      vscode.window.onDidChangeVisibleTextEditors((editors) => {
        void this.emit(WORKSPACE_EVENTS.DID_CHANGE_VISIBLE_TEXT_EDITORS, editors);
      }),

      vscode.window.onDidChangeTextEditorSelection((event) => {
        void this.emit(WORKSPACE_EVENTS.DID_CHANGE_TEXT_EDITOR_SELECTION, event);
      }),

      vscode.window.onDidChangeTextEditorVisibleRanges((event) => {
        void this.emit(WORKSPACE_EVENTS.DID_CHANGE_TEXT_EDITOR_VISIBLE_RANGES, event);
      }),

      vscode.window.onDidChangeTextEditorOptions((event) => {
        void this.emit(WORKSPACE_EVENTS.DID_CHANGE_TEXT_EDITOR_OPTIONS, event);
      }),

      vscode.window.onDidChangeWindowState((event) => {
        void this.emit(WORKSPACE_EVENTS.DID_CHANGE_WINDOW_STATE, event);
      }),

      /**
       * Tabs
       */
      vscode.window.tabGroups.onDidChangeTabs((event) => {
        void this.emit(WORKSPACE_EVENTS.DID_CHANGE_TABS, event);
      }),

      vscode.window.tabGroups.onDidChangeTabGroups((event) => {
        void this.emit(WORKSPACE_EVENTS.DID_CHANGE_TAB_GROUPS, event);
      }),

      /**
       * Workspace
       */
      vscode.workspace.onDidChangeConfiguration((event) => {
        void this.emit(WORKSPACE_EVENTS.DID_CHANGE_CONFIGURATION, event);
      }),

      vscode.workspace.onDidChangeWorkspaceFolders((event) => {
        void this.emit(WORKSPACE_EVENTS.DID_CHANGE_WORKSPACE_FOLDERS, event);
      }),

      /**
       * File operations
       */
      vscode.workspace.onDidCreateFiles((event) => {
        void this.emit(WORKSPACE_EVENTS.DID_CREATE_FILES, event);
      }),

      vscode.workspace.onDidDeleteFiles((event) => {
        void this.emit(WORKSPACE_EVENTS.DID_DELETE_FILES, event);
      }),

      vscode.workspace.onDidRenameFiles((event) => {
        void this.emit(WORKSPACE_EVENTS.DID_RENAME_FILES, event);
      }),

      vscode.workspace.onWillCreateFiles((event) => {
        void this.emit(WORKSPACE_EVENTS.WILL_CREATE_FILES, event);
      }),

      vscode.workspace.onWillDeleteFiles((event) => {
        void this.emit(WORKSPACE_EVENTS.WILL_DELETE_FILES, event);
      }),

      vscode.workspace.onWillRenameFiles((event) => {
        void this.emit(WORKSPACE_EVENTS.WILL_RENAME_FILES, event);
      }),

      /**
       * Terminal
       */
      vscode.window.onDidOpenTerminal((terminal) => {
        void this.emit(WORKSPACE_EVENTS.DID_OPEN_TERMINAL, terminal);
      }),

      vscode.window.onDidCloseTerminal((terminal) => {
        void this.emit(WORKSPACE_EVENTS.DID_CLOSE_TERMINAL, terminal);
      }),

      vscode.window.onDidChangeActiveTerminal((terminal) => {
        void this.emit(WORKSPACE_EVENTS.DID_CHANGE_ACTIVE_TERMINAL, terminal);
      }),

      vscode.window.onDidChangeTerminalState((event) => {
        void this.emit(WORKSPACE_EVENTS.DID_CHANGE_TERMINAL_STATE, event);
      }),

      /**
       * Debug
       */
      vscode.debug.onDidStartDebugSession((session) => {
        void this.emit(WORKSPACE_EVENTS.DID_START_DEBUG_SESSION, session);
      }),

      vscode.debug.onDidTerminateDebugSession((session) => {
        void this.emit(WORKSPACE_EVENTS.DID_TERMINATE_DEBUG_SESSION, session);
      }),

      vscode.debug.onDidChangeActiveDebugSession((session) => {
        void this.emit(WORKSPACE_EVENTS.DID_CHANGE_ACTIVE_DEBUG_SESSION, session);
      }),

      vscode.debug.onDidReceiveDebugSessionCustomEvent((event) => {
        void this.emit(WORKSPACE_EVENTS.DID_RECEIVE_DEBUG_SESSION_CUSTOM_EVENT, event);
      }),

      vscode.debug.onDidChangeBreakpoints((event) => {
        void this.emit(WORKSPACE_EVENTS.DID_CHANGE_BREAKPOINTS, event);
      }),

      /**
       * Tasks
       */
      vscode.tasks.onDidStartTask((event) => {
        void this.emit(WORKSPACE_EVENTS.DID_START_TASK, event);
      }),

      vscode.tasks.onDidEndTask((event) => {
        void this.emit(WORKSPACE_EVENTS.DID_END_TASK, event);
      }),

      vscode.tasks.onDidStartTaskProcess((event) => {
        void this.emit(WORKSPACE_EVENTS.DID_START_TASK_PROCESS, event);
      }),

      vscode.tasks.onDidEndTaskProcess((event) => {
        void this.emit(WORKSPACE_EVENTS.DID_END_TASK_PROCESS, event);
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
  public on<T extends WorkspaceEventName>(eventName: T, handler: WorkspaceEventHandler<T>, options?: WorkspaceDocumentFilterOptions): vscode.Disposable {
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

  /**
   * @description 统一触发 workspace/window/debug/tasks 事件
   *
   * 触发顺序：
   * 1. injectedEvents：ETI plugin 的 on 监听
   * 2. localHandlers：业务模块 workflow.on 监听
   */
  private async emit<T extends WorkspaceEventName>(eventName: T, payload: WorkspaceEventMap[T]): Promise<void> {
    const documents = this.getDocumentsFromPayload(eventName, payload);

    const context: WorkspaceEventContext<T> = {
      eventName,
      payload,
      document: documents[0],
      documents,
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

  private getRegisterEvents(): WorkspaceEventName[] {
    return Object.values(WORKSPACE_EVENTS) as WorkspaceEventName[];
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

    if (!context.documents?.length) {
      return false;
    }

    return context.documents.some((doc) => {
      return this.matchDocument(doc, options);
    });
  }

  /**
   * @description 从不同事件 payload 中提取关联文档
   */
  private getDocumentsFromPayload<T extends WorkspaceEventName>(eventName: T, payload: WorkspaceEventMap[T]): vscode.TextDocument[] {
    switch (eventName) {
      case WORKSPACE_EVENTS.DID_SAVE_TEXT_DOCUMENT:
      case WORKSPACE_EVENTS.DID_OPEN_TEXT_DOCUMENT:
      case WORKSPACE_EVENTS.DID_CLOSE_TEXT_DOCUMENT:
        return [payload as vscode.TextDocument];

      case WORKSPACE_EVENTS.WILL_SAVE_TEXT_DOCUMENT:
        return [(payload as vscode.TextDocumentWillSaveEvent).document];

      case WORKSPACE_EVENTS.DID_CHANGE_TEXT_DOCUMENT:
        return [(payload as vscode.TextDocumentChangeEvent).document];

      case WORKSPACE_EVENTS.DID_CHANGE_ACTIVE_TEXT_EDITOR: {
        const editor = payload as vscode.TextEditor | undefined;
        return editor ? [editor.document] : [];
      }

      case WORKSPACE_EVENTS.DID_CHANGE_VISIBLE_TEXT_EDITORS:
        return Array.from(payload as readonly vscode.TextEditor[]).map((editor) => editor.document);

      case WORKSPACE_EVENTS.DID_CHANGE_TEXT_EDITOR_SELECTION:
        return [(payload as vscode.TextEditorSelectionChangeEvent).textEditor.document];

      case WORKSPACE_EVENTS.DID_CHANGE_TEXT_EDITOR_VISIBLE_RANGES:
        return [(payload as vscode.TextEditorVisibleRangesChangeEvent).textEditor.document];

      case WORKSPACE_EVENTS.DID_CHANGE_TEXT_EDITOR_OPTIONS:
        return [(payload as vscode.TextEditorOptionsChangeEvent).textEditor.document];

      default:
        return [];
    }
  }

  private matchDocument(doc: vscode.TextDocument, options?: WorkspaceDocumentFilterOptions): boolean {
    const fileOnly = options?.fileOnly !== false;

    if (fileOnly && doc.uri.scheme !== 'file') {
      return false;
    }

    if (options?.extensions?.length) {
      const ext = path.extname(doc.uri.fsPath).toLowerCase();
      const extensions = this.normalizeExtensions(options.extensions);

      if (!extensions.includes(ext)) {
        return false;
      }
    }

    if (options?.filter && !options.filter(doc)) {
      return false;
    }

    return true;
  }

  private normalizeExtensions(extensions: string[]): string[] {
    return extensions.map((item) => {
      const ext = item.trim().toLowerCase();

      if (!ext) {
        return ext;
      }

      if (ext.startsWith('.')) {
        return ext;
      }

      return `.${ext}`;
    });
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