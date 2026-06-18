import type * as vscode from 'vscode';

export type MaybePromise<T = void> = T | Promise<T>;

export type Nullable<T> = T | null;

export type Optional<T> = T | undefined;

export type AnyRecord = Record<string, any>;

export type UnknownRecord = Record<string, unknown>;

export type Primitive = string | number | boolean | bigint | symbol | null | undefined;

export interface DisposableLike {
  dispose(): void | Promise<void>;
}

export interface Initializable {
  init(context?: vscode.ExtensionContext): MaybePromise<void>;
}

export interface Destroyable {
  dispose?(): MaybePromise<void>;
  onModuleDestroy?(): MaybePromise<void>;
}

export type VscodeCommandHandler<TArgs extends any[] = any[]> = (
  ...args: TArgs
) => MaybePromise<unknown>;

export interface QuickOpsCommand<TArgs extends any[] = any[]> {
  command: string;
  handler: VscodeCommandHandler<TArgs>;
  thisArg?: unknown;
}

export interface QuickOpsShellConfig {
  label: string;
  command: string;
  cwd?: string;
}

export interface QuickOpsConfig {
  general: {
    debug: boolean;
    excludeConfigFiles: boolean;
    anchorViewMode: string;
    mindMapPosition: string;
  };

  logger: {
    template: string;
    dateFormat: string;
  };

  utils: {
    uuidLength: number;
  };

  git: {
    ignoreList: string[];
  };

  shells: QuickOpsShellConfig[];

  project: {
    marks: Record<string, unknown>;
    alias: Record<string, string>;
  };

  snippets: unknown[];
}

export type ConfigurationChangeListener = (
  config: Readonly<QuickOpsConfig>,
) => void;

export interface PathInfo {
  uri: vscode.Uri;
  fsPath: string;
  name: string;
  ext: string;
  isFile: boolean;
  isDirectory: boolean;
}

export interface FileStatInfo {
  uri: vscode.Uri;
  type: vscode.FileType;
  ctime: number;
  mtime: number;
  size: number;
}

export interface WebviewResourceOptions {
  webview: vscode.Webview;
  extensionUri: vscode.Uri;
  paths: string[];
}

export interface QuickPickOption<T = unknown> extends vscode.QuickPickItem {
  value: T;
}

export interface CommandRegisterOptions<TArgs extends any[] = any[]> {
  command: string;
  handler: VscodeCommandHandler<TArgs>;
  thisArg?: unknown;
}

export interface EventRegisterOptions {
  disposable: vscode.Disposable;
}