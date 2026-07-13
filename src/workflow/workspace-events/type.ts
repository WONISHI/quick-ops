import * as vscode from 'vscode';

export const WORKSPACE_EVENTS = {
  /**
   * TextDocument
   */
  DID_SAVE_TEXT_DOCUMENT: 'workspace:didSaveTextDocument',
  WILL_SAVE_TEXT_DOCUMENT: 'workspace:willSaveTextDocument',
  DID_CHANGE_TEXT_DOCUMENT: 'workspace:didChangeTextDocument',
  DID_OPEN_TEXT_DOCUMENT: 'workspace:didOpenTextDocument',
  DID_CLOSE_TEXT_DOCUMENT: 'workspace:didCloseTextDocument',

  /**
   * Window / Editor
   */
  DID_CHANGE_ACTIVE_TEXT_EDITOR: 'window:didChangeActiveTextEditor',
  DID_CHANGE_VISIBLE_TEXT_EDITORS: 'window:didChangeVisibleTextEditors',
  DID_CHANGE_TEXT_EDITOR_SELECTION: 'window:didChangeTextEditorSelection',
  DID_CHANGE_TEXT_EDITOR_VISIBLE_RANGES: 'window:didChangeTextEditorVisibleRanges',
  DID_CHANGE_TEXT_EDITOR_OPTIONS: 'window:didChangeTextEditorOptions',
  DID_CHANGE_WINDOW_STATE: 'window:didChangeWindowState',

  /**
   * Tabs
   */
  DID_CHANGE_TABS: 'window:didChangeTabs',
  DID_CHANGE_TAB_GROUPS: 'window:didChangeTabGroups',

  /**
   * Workspace
   */
  DID_CHANGE_CONFIGURATION: 'workspace:didChangeConfiguration',
  DID_CHANGE_WORKSPACE_FOLDERS: 'workspace:didChangeWorkspaceFolders',

  /**
   * File operations
   */
  DID_CREATE_FILES: 'workspace:didCreateFiles',
  DID_DELETE_FILES: 'workspace:didDeleteFiles',
  DID_RENAME_FILES: 'workspace:didRenameFiles',
  WILL_CREATE_FILES: 'workspace:willCreateFiles',
  WILL_DELETE_FILES: 'workspace:willDeleteFiles',
  WILL_RENAME_FILES: 'workspace:willRenameFiles',

  /**
   * Terminal
   */
  DID_OPEN_TERMINAL: 'window:didOpenTerminal',
  DID_CLOSE_TERMINAL: 'window:didCloseTerminal',
  DID_CHANGE_ACTIVE_TERMINAL: 'window:didChangeActiveTerminal',
  DID_CHANGE_TERMINAL_STATE: 'window:didChangeTerminalState',

  /**
   * Debug
   */
  DID_START_DEBUG_SESSION: 'debug:didStartDebugSession',
  DID_TERMINATE_DEBUG_SESSION: 'debug:didTerminateDebugSession',
  DID_CHANGE_ACTIVE_DEBUG_SESSION: 'debug:didChangeActiveDebugSession',
  DID_RECEIVE_DEBUG_SESSION_CUSTOM_EVENT: 'debug:didReceiveDebugSessionCustomEvent',
  DID_CHANGE_BREAKPOINTS: 'debug:didChangeBreakpoints',

  /**
   * Tasks
   */
  DID_START_TASK: 'tasks:didStartTask',
  DID_END_TASK: 'tasks:didEndTask',
  DID_START_TASK_PROCESS: 'tasks:didStartTaskProcess',
  DID_END_TASK_PROCESS: 'tasks:didEndTaskProcess',
} as const;

export type WorkspaceEventName = (typeof WORKSPACE_EVENTS)[keyof typeof WORKSPACE_EVENTS];

export interface WorkspaceEventMap {
  /**
   * TextDocument
   */
  [WORKSPACE_EVENTS.DID_SAVE_TEXT_DOCUMENT]: vscode.TextDocument;
  [WORKSPACE_EVENTS.WILL_SAVE_TEXT_DOCUMENT]: vscode.TextDocumentWillSaveEvent;
  [WORKSPACE_EVENTS.DID_CHANGE_TEXT_DOCUMENT]: vscode.TextDocumentChangeEvent;
  [WORKSPACE_EVENTS.DID_OPEN_TEXT_DOCUMENT]: vscode.TextDocument;
  [WORKSPACE_EVENTS.DID_CLOSE_TEXT_DOCUMENT]: vscode.TextDocument;

  /**
   * Window / Editor
   */
  [WORKSPACE_EVENTS.DID_CHANGE_ACTIVE_TEXT_EDITOR]: vscode.TextEditor | undefined;
  [WORKSPACE_EVENTS.DID_CHANGE_VISIBLE_TEXT_EDITORS]: readonly vscode.TextEditor[];
  [WORKSPACE_EVENTS.DID_CHANGE_TEXT_EDITOR_SELECTION]: vscode.TextEditorSelectionChangeEvent;
  [WORKSPACE_EVENTS.DID_CHANGE_TEXT_EDITOR_VISIBLE_RANGES]: vscode.TextEditorVisibleRangesChangeEvent;
  [WORKSPACE_EVENTS.DID_CHANGE_TEXT_EDITOR_OPTIONS]: vscode.TextEditorOptionsChangeEvent;
  [WORKSPACE_EVENTS.DID_CHANGE_WINDOW_STATE]: vscode.WindowState;

  /**
   * Tabs
   */
  [WORKSPACE_EVENTS.DID_CHANGE_TABS]: vscode.TabChangeEvent;
  [WORKSPACE_EVENTS.DID_CHANGE_TAB_GROUPS]: vscode.TabGroupChangeEvent;

  /**
   * Workspace
   */
  [WORKSPACE_EVENTS.DID_CHANGE_CONFIGURATION]: vscode.ConfigurationChangeEvent;
  [WORKSPACE_EVENTS.DID_CHANGE_WORKSPACE_FOLDERS]: vscode.WorkspaceFoldersChangeEvent;

  /**
   * File operations
   */
  [WORKSPACE_EVENTS.DID_CREATE_FILES]: vscode.FileCreateEvent;
  [WORKSPACE_EVENTS.DID_DELETE_FILES]: vscode.FileDeleteEvent;
  [WORKSPACE_EVENTS.DID_RENAME_FILES]: vscode.FileRenameEvent;
  [WORKSPACE_EVENTS.WILL_CREATE_FILES]: vscode.FileWillCreateEvent;
  [WORKSPACE_EVENTS.WILL_DELETE_FILES]: vscode.FileWillDeleteEvent;
  [WORKSPACE_EVENTS.WILL_RENAME_FILES]: vscode.FileWillRenameEvent;

  /**
   * Terminal
   */
  [WORKSPACE_EVENTS.DID_OPEN_TERMINAL]: vscode.Terminal;
  [WORKSPACE_EVENTS.DID_CLOSE_TERMINAL]: vscode.Terminal;
  [WORKSPACE_EVENTS.DID_CHANGE_ACTIVE_TERMINAL]: vscode.Terminal | undefined;
  [WORKSPACE_EVENTS.DID_CHANGE_TERMINAL_STATE]: vscode.Terminal;

  /**
   * Debug
   */
  [WORKSPACE_EVENTS.DID_START_DEBUG_SESSION]: vscode.DebugSession;
  [WORKSPACE_EVENTS.DID_TERMINATE_DEBUG_SESSION]: vscode.DebugSession;
  [WORKSPACE_EVENTS.DID_CHANGE_ACTIVE_DEBUG_SESSION]: vscode.DebugSession | undefined;
  [WORKSPACE_EVENTS.DID_RECEIVE_DEBUG_SESSION_CUSTOM_EVENT]: vscode.DebugSessionCustomEvent;
  [WORKSPACE_EVENTS.DID_CHANGE_BREAKPOINTS]: vscode.BreakpointsChangeEvent;

  /**
   * Tasks
   */
  [WORKSPACE_EVENTS.DID_START_TASK]: vscode.TaskStartEvent;
  [WORKSPACE_EVENTS.DID_END_TASK]: vscode.TaskEndEvent;
  [WORKSPACE_EVENTS.DID_START_TASK_PROCESS]: vscode.TaskProcessStartEvent;
  [WORKSPACE_EVENTS.DID_END_TASK_PROCESS]: vscode.TaskProcessEndEvent;
}

export interface WorkspaceEventContext<T extends WorkspaceEventName = WorkspaceEventName> {
  /**
   * @description 当前事件名
   */
  eventName: T;

  /**
   * @description 原始事件数据
   */
  payload: WorkspaceEventMap[T];

  /**
   * @description 当前事件关联的主文档
   *
   * 不是所有事件都有 document。
   */
  document?: vscode.TextDocument;

  /**
   * @description 当前事件关联的文档列表
   *
   * 例如 visibleTextEditors 可能对应多个 document。
   */
  documents?: vscode.TextDocument[];
}

export interface WorkspaceDocumentFilterOptions {
  /**
   * @description 是否只处理 file 文档
   *
   * 默认 true
   */
  fileOnly?: boolean;

  /**
   * @description 支持的文件扩展名
   *
   * 示例：
   * ['.ts', '.tsx', '.vue']
   */
  extensions?: string[];

  /**
   * @description 自定义文档过滤
   */
  filter?: (doc: vscode.TextDocument) => boolean;
}

export type WorkspaceEventHandler<T extends WorkspaceEventName> = (context: WorkspaceEventContext<T>) => void | Promise<void>;

export type AnyWorkspaceEventHandler = (context: WorkspaceEventContext) => void | Promise<void>;

export interface LocalHandlerItem {
  eventName: WorkspaceEventName;
  handler: AnyWorkspaceEventHandler;
  options?: WorkspaceDocumentFilterOptions;
}
