import type * as vscode from 'vscode';

export type ExternalPreviewType = 'markdown' | 'pdf' | 'excel' | 'word';

export type FileNavigationCommand =
  | 'quick-ops.revealInExplorer'
  | 'quick-ops.openInNewTab'
  | 'quick-ops.openExternalPreview';

export interface FileNavigationCommandItem {
  command: FileNavigationCommand;
  title: string;
  description?: string;
}

export interface ExternalPreviewOptions {
  uri: vscode.Uri;
}

export interface PreviewPanelOptions {
  uri: vscode.Uri;
  fileName: string;
  projectName: string;
}

export interface MarkdownImageAssets {
  [key: string]: string;
}

export interface WebviewMessage {
  command?: string;
  type?: string;
  content?: string;
  text?: string;
  url?: string;
}

export interface InitPdfDataMessage {
  type: 'initPdfData';
  contentBase64: string;
}

export interface InitExcelDataMessage {
  type: 'initExcelData';
  fsPath: string;
  fileName: string;
  contentBase64: string;
}

export interface InitDocDataMessage {
  type: 'initDocData';
  fsPath: string;
  fileName: string;
  extension: string;
  contentBase64: string;
}

export interface InitLocalFileErrorMessage {
  type: 'initLocalFileError';
  message: string;
}

export interface InitDocErrorMessage {
  type: 'initDocError';
  fileName: string;
  message: string;
}