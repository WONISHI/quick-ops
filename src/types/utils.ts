import * as vscode from 'vscode';
import type { ExportResult } from '../utils/parse';

export const fileTypes = ['vue', 'jsx', 'tsx', 'css', 'less', 'scss', 'html', 'js', 'ts'] as const;
export const HttpStatusCode = [100, 101, 102, 200, 201, 202, 204, 301, 302, 304, 400, 401, 403, 404, 409, 429, 500, 501, 502, 503, 504] as const;

export type FileType = (typeof fileTypes)[number];
export type HttpCode = (typeof HttpStatusCode)[number];

export type ExportNameType = ExportResult | string;

export interface FileEntry {}

export type ActionTextEditor = vscode.TextEditor | null;

export interface ActionEditorInfoOption {
  editor: vscode.TextEditor;
  document: vscode.TextDocument;
  cursorPos: vscode.Position;
  lineText: string;
  text: string;
  offset: number;
}

export interface HttpTemplate {
  code: HttpCode;
  status: boolean;
  data: any;
  [key: string]: any;
}

export interface HttpOptions {
  template: HttpTemplate;
  structure: any;
}
