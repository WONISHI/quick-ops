import * as vscode from 'vscode';

declare module 'vscode' {
  interface ExtensionContext {
    resolveFile: (...args: string[]) => string;
  }
}