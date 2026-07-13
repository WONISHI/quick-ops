import * as vscode from 'vscode';

export const WORKSPACE_EVENTS = {
  DID_SAVE_TEXT_DOCUMENT: 'workspace:didSaveTextDocument',
  DID_CHANGE_TEXT_DOCUMENT: 'workspace:didChangeTextDocument',
  DID_OPEN_TEXT_DOCUMENT: 'workspace:didOpenTextDocument',
  DID_CLOSE_TEXT_DOCUMENT: 'workspace:didCloseTextDocument',
  DID_CHANGE_ACTIVE_TEXT_EDITOR: 'workspace:didChangeActiveTextEditor',
  DID_CHANGE_CONFIGURATION: 'workspace:didChangeConfiguration',
  DID_CHANGE_WORKSPACE_FOLDERS: 'workspace:didChangeWorkspaceFolders',
} as const;

export type WorkspaceEventName = (typeof WORKSPACE_EVENTS)[keyof typeof WORKSPACE_EVENTS];

export interface WorkspaceEventMap {
  [WORKSPACE_EVENTS.DID_SAVE_TEXT_DOCUMENT]: vscode.TextDocument;
  [WORKSPACE_EVENTS.DID_CHANGE_TEXT_DOCUMENT]: vscode.TextDocumentChangeEvent;
  [WORKSPACE_EVENTS.DID_OPEN_TEXT_DOCUMENT]: vscode.TextDocument;
  [WORKSPACE_EVENTS.DID_CLOSE_TEXT_DOCUMENT]: vscode.TextDocument;
  [WORKSPACE_EVENTS.DID_CHANGE_ACTIVE_TEXT_EDITOR]: vscode.TextEditor | undefined;
  [WORKSPACE_EVENTS.DID_CHANGE_CONFIGURATION]: vscode.ConfigurationChangeEvent;
  [WORKSPACE_EVENTS.DID_CHANGE_WORKSPACE_FOLDERS]: vscode.WorkspaceFoldersChangeEvent;
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
   * @description 当前事件关联的文档
   *
   * 不是所有事件都有 document。
   */
  document?: vscode.TextDocument;
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
