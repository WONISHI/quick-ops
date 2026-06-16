import * as vscode from 'vscode';

export interface DiagnosticSummary {
  errors: number;
  warnings: number;
}

export interface RecentProject {
  name: string;
  customName?: string;
  fsPath: string;
  timestamp: number;
  branch?: string;
  platform?: 'github' | 'gitlab';
  customDomain?: string;
  status?: string;
  diagnostics?: DiagnosticSummary;
}

export interface MetadataPatchItem {
  path: string;
  status?: string;
  diagnostics: DiagnosticSummary;
}

export interface IndexedFileItem {
  name: string;
  fullPath: string;
  uriString: string;
  relativePath: string;
  isFolder: boolean;
  ext: string;
  uri: vscode.Uri;
}
