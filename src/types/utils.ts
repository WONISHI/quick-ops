import * as vscode from 'vscode';
import type { ExportResult } from '../utils/parse';

export const fileTypes = ['vue', 'jsx', 'tsx', 'css', 'less', 'scss', 'html', 'js', 'ts'] as const;

export type FileType = (typeof fileTypes)[number];

export type ExportNameType = ExportResult | string;

export interface FileEntry {}

export type ActionTextEditor = vscode.TextEditor | null;

export interface ActionEditorInfoOption {
  editor: vscode.TextEditor;
  document: vscode.TextDocument;
  cursorPos: vscode.Position;
  lineText: string;
  text:string;
  offset:number;
}
