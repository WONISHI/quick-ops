import type * as vscode from 'vscode';

export type EditorHistoryCommand = 'quick-ops.switchPreviousEditor';

export interface EditorHistoryRecord {
  uri: string;
  fsPath?: string;
  scheme: string;
  fileName: string;
  viewColumn?: vscode.ViewColumn;
  visitedAt: number;
}

export interface EditorHistoryOptions {
  maxSize: number;
}

export interface SwitchPreviousEditorOptions {
  preview?: boolean;
  viewColumn?: vscode.ViewColumn;
}