import type * as vscode from 'vscode';

export type AnchorDirection = 'prev' | 'next';

export type AnchorMoveDirection = 'up' | 'down';

export type AnchorInsertPosition = 'before' | 'after';

export interface AnchorData {
  id: string;
  filePath: string;
  line: number;
  content: string;
  group: string;
  sort?: number;
  timestamp?: number;
  description?: string;
  pid?: string;
  items?: AnchorData[];
}

export interface AnchorConfig {
  groups: string[];
  children: string[];
  anchors: AnchorData[];
}

export type AnchorCreateInput = Omit<
  AnchorData,
  'id' | 'timestamp' | 'items'
>;

export type AnchorChildCreateInput = Omit<
  AnchorData,
  'id' | 'timestamp' | 'items' | 'pid'
>;

export interface AnchorUpdateInput {
  line?: number;
  content?: string;
  description?: string;
}

export interface AnchorEditorContext {
  editor: vscode.TextEditor;
  doc: vscode.TextDocument;
  rootPath: string;
  relativePath: string;
  lineIndex: number;
  uiLineNumber: number;
  text: string;
}

export interface AnchorQuickPickItem extends vscode.QuickPickItem {
  anchorId?: string;
  rawDescription?: string;
}

export interface AnchorMindMapNode {
  name: string;
  id?: string;
  data?: AnchorData;
  children?: AnchorMindMapNode[];
}

export interface AnchorWebviewMessage {
  command:
    | 'ready'
    | 'refresh'
    | 'jump'
    | 'toggleFullscreen'
    | 'anchorAction';
  data?: {
    filePath: string;
    line: number;
  };
  action?: 'delete' | 'edit';
  anchorId?: string;
}

export interface AnchorServiceState {
  anchors: AnchorData[];
  flotAnchors: AnchorData[];
  groups: string[];
  itemGroups: string[];
}