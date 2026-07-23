import type * as vscode from 'vscode';

export interface UIOption {
  value: string;
  description?: string;
}

export interface UIAttribute {
  name: string;
  description: string;
  type: 'boolean' | 'string' | 'number' | 'enum' | 'any' | string;
  default?: string;
  options?: UIOption[];
}

export interface UIEvent {
  name: string;
  description: string;
  parameters?: string;
}

export interface UISlot {
  name: string;
  description: string;
}

export interface UIMethod {
  name: string;
  description: string;
  parameters?: string;
}

export interface UIComponent {
  tags: string[];
  description: string;
  snippet: string;
  link?: string;
  attributes?: UIAttribute[];
  events?: UIEvent[];
  slots?: UISlot[];
  methods?: UIMethod[];
}

export interface UILibraryGroup {
  unversioned?: string;
  versions: Record<string, string>;
}

export interface ComponentCompletionContext {
  document: vscode.TextDocument;
  position: vscode.Position;
  lineTextBeforeCursor: string;
  multiLineTextBeforeCursor: string;
}

export interface ComponentIntellisenseState {
  components: UIComponent[];
  tagToComponentMap: Map<string, UIComponent>;
}

export type ComponentIntellisenseCommand = 'quick-ops.exportSnippets';