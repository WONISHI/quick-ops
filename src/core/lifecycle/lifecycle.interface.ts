import type * as vscode from 'vscode';

export interface OnModuleInit {
  onModuleInit(context: vscode.ExtensionContext): void | Promise<void>;
}

export interface OnModuleDestroy {
  onModuleDestroy(): void | Promise<void>;
}