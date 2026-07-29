import * as vscode from 'vscode';

export interface MarkStyle {
  backgroundColor: string;
  color?: string;
  fontWeight?: string;
  borderRadius?: string;
}

export type DecorationPair = {
  text: vscode.TextEditorDecorationType;
};