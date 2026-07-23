import type * as vscode from 'vscode';

export type CodeSnippetLanguageScope = string | string[];

export type CodeSnippetDependencyScope =
  | 'vue'
  | 'vue2'
  | 'vue3'
  | 'react'
  | string;

export interface CodeSnippetItem {
  prefix: string | string[];
  body: string | string[];
  description?: string;
  origin?: string;
  params?: Record<string, any>;
  scope?: [CodeSnippetLanguageScope?, CodeSnippetDependencyScope?];
  style?: string;
}

export interface CodeSnippetInputInfo {
  wordBefore: string;
  wordAfter: string;
  startPosition: vscode.Position;
}

export interface CodeSnippetLoadResult {
  snippets: CodeSnippetItem[];
  source: 'extension' | 'workspace';
}

export interface CodeSnippetCompletionOptions {
  document: vscode.TextDocument;
  position: vscode.Position;
}

export type CodeSnippetCommand = 'quick-ops.reloadCodeSnippets';