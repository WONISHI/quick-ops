import type * as vscode from 'vscode';

export type EditorHistoryCommand =
  | 'quickOps.switchPreviousEditor'
  | 'quickOps.switchNextEditor'
  | 'quickOps.switchPreviousEditorLocation'
  | 'quickOps.switchNextEditorLocation';

export interface EditorHistoryLocation {
  /**
   * @description VS Code 内部的行号，从 0 开始
   */
  line: number;

  /**
   * @description 当前行中的字符位置，从 0 开始
   */
  character: number;

  /**
   * @description 最近一次访问该位置的时间
   */
  visitedAt: number;
}

export interface EditorHistoryRecord {
  uri: string;
  fsPath?: string;
  scheme: string;
  fileName: string;
  viewColumn?: vscode.ViewColumn;
  visitedAt: number;

  /**
   * @description 文件内的访问位置，按最早到最近排序
   */
  locations: EditorHistoryLocation[];

  /**
   * @description 当前记忆的位置下标，用于文件间切换后恢复
   */
  activeLocationIndex: number;
}

export interface EditorHistoryOptions {
  /**
   * @description 最多记录多少个文件
   */
  maxFiles: number;

  /**
   * @description 每个文件最多记录多少个聚焦位置
   */
  maxLocationsPerFile: number;

  /**
   * @description 光标停止移动多久后记录当前位置
   */
  selectionDebounceMs: number;
}

export interface SwitchPreviousEditorOptions {
  preview?: boolean;
  viewColumn?: vscode.ViewColumn;
}
