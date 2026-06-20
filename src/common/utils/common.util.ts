import * as vscode from 'vscode';
import * as path from 'path';
import type {
  DisposableLike,
  MaybePromise,
  PathInfo,
  QuickPickOption,
  VscodeCommandHandler,
  WebviewResourceOptions,
} from '../types/common.type';

export function isNil(value: unknown): value is null | undefined {
  return value === null || value === undefined;
}

export function isNotNil<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

export function isString(value: unknown): value is string {
  return typeof value === 'string';
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isFunction<T extends (...args: any[]) => any = (...args: any[]) => any>(
  value: unknown,
): value is T {
  return typeof value === 'function';
}

export function isPromiseLike<T = unknown>(value: unknown): value is PromiseLike<T> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'then' in value &&
    typeof (value as PromiseLike<T>).then === 'function'
  );
}

export function noop(): void {
  // noop
}

export async function safeCall<T>(
  fn: () => MaybePromise<T>,
  fallback: T,
  onError?: (error: unknown) => void,
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    onError?.(error);
    return fallback;
  }
}

export async function safeDispose(disposable?: DisposableLike | null): Promise<void> {
  if (!disposable) return;

  try {
    await disposable.dispose();
  } catch (error) {
    console.error('[QuickOps] dispose failed:', error);
  }
}

export async function safeDisposeAll(
  disposables: Array<DisposableLike | null | undefined>,
): Promise<void> {
  for (let i = disposables.length - 1; i >= 0; i--) {
    await safeDispose(disposables[i]);
  }

  disposables.length = 0;
}

export function registerCommand<TArgs extends any[] = any[]>(
  context: vscode.ExtensionContext,
  command: string,
  handler: VscodeCommandHandler<TArgs>,
  thisArg?: unknown,
): vscode.Disposable {
  const disposable = vscode.commands.registerCommand(command, handler, thisArg);
  context.subscriptions.push(disposable);
  return disposable;
}

export function registerCommands(
  context: vscode.ExtensionContext,
  commands: Array<{
    command: string;
    handler: VscodeCommandHandler;
    thisArg?: unknown;
  }>,
): vscode.Disposable[] {
  return commands.map(item =>
    registerCommand(context, item.command, item.handler, item.thisArg),
  );
}

export function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

export function normalizeUriPath(uri: vscode.Uri): string {
  return normalizePath(uri.fsPath);
}

export function getFileName(filePath: string): string {
  return path.basename(filePath);
}

export function getFileExt(filePath: string): string {
  return path.extname(filePath);
}

export function getDirName(filePath: string): string {
  return path.dirname(filePath);
}

export function joinPath(...paths: string[]): string {
  return normalizePath(path.join(...paths));
}

export function toUri(filePath: string): vscode.Uri {
  return vscode.Uri.file(filePath);
}

export function getWorkspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

export function getWorkspaceRootUri(): vscode.Uri | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri;
}

export function getRelativePath(
  targetPath: string,
  rootPath = getWorkspaceRoot(),
): string {
  if (!rootPath) return normalizePath(targetPath);

  return normalizePath(path.relative(rootPath, targetPath));
}

export async function pathExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDirectory(uri: vscode.Uri): Promise<void> {
  if (await pathExists(uri)) return;

  await vscode.workspace.fs.createDirectory(uri);
}

export async function readTextFile(uri: vscode.Uri): Promise<string> {
  const buffer = await vscode.workspace.fs.readFile(uri);
  return Buffer.from(buffer).toString('utf-8');
}

export async function writeTextFile(uri: vscode.Uri, content: string): Promise<void> {
  const dirUri = vscode.Uri.file(path.dirname(uri.fsPath));

  await ensureDirectory(dirUri);
  await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf-8'));
}

export async function readJsonFile<T = unknown>(
  uri: vscode.Uri,
  fallback: T,
): Promise<T> {
  try {
    const content = await readTextFile(uri);
    return JSON.parse(content) as T;
  } catch {
    return fallback;
  }
}

export async function writeJsonFile<T = unknown>(
  uri: vscode.Uri,
  data: T,
  space = 2,
): Promise<void> {
  await writeTextFile(uri, `${JSON.stringify(data, null, space)}\n`);
}

export async function getPathInfo(uri: vscode.Uri): Promise<PathInfo | undefined> {
  try {
    const stat = await vscode.workspace.fs.stat(uri);

    return {
      uri,
      fsPath: uri.fsPath,
      name: path.basename(uri.fsPath),
      ext: path.extname(uri.fsPath),
      isFile: stat.type === vscode.FileType.File,
      isDirectory: stat.type === vscode.FileType.Directory,
    };
  } catch {
    return undefined;
  }
}

export async function isFile(uri: vscode.Uri): Promise<boolean> {
  const info = await getPathInfo(uri);
  return info?.isFile ?? false;
}

export async function isDirectory(uri: vscode.Uri): Promise<boolean> {
  const info = await getPathInfo(uri);
  return info?.isDirectory ?? false;
}

export function createQuickPickOption<T>(
  label: string,
  value: T,
  options?: Omit<QuickPickOption<T>, 'label' | 'value'>,
): QuickPickOption<T> {
  return {
    label,
    value,
    ...options,
  };
}

export async function showQuickPickValue<T>(
  items: QuickPickOption<T>[],
  options?: vscode.QuickPickOptions,
): Promise<T | undefined> {
  const picked = await vscode.window.showQuickPick(items, options);
  return picked?.value;
}

export function getWebviewUri(options: WebviewResourceOptions): vscode.Uri {
  return options.webview.asWebviewUri(
    vscode.Uri.joinPath(options.extensionUri, ...options.paths),
  );
}

export function getNonce(length = 32): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';

  for (let i = 0; i < length; i++) {
    value += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return value;
}

export function delay(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

export function debounce<TArgs extends any[]>(
  fn: (...args: TArgs) => void,
  wait = 300,
): (...args: TArgs) => void {
  let timer: NodeJS.Timeout | undefined;

  return (...args: TArgs) => {
    if (timer) {
      clearTimeout(timer);
    }

    timer = setTimeout(() => {
      fn(...args);
    }, wait);
  };
}

export function throttle<TArgs extends any[]>(
  fn: (...args: TArgs) => void,
  wait = 300,
): (...args: TArgs) => void {
  let lastTime = 0;
  let timer: NodeJS.Timeout | undefined;

  return (...args: TArgs) => {
    const now = Date.now();
    const remaining = wait - (now - lastTime);

    if (remaining <= 0) {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }

      lastTime = now;
      fn(...args);
      return;
    }

    if (!timer) {
      timer = setTimeout(() => {
        lastTime = Date.now();
        timer = undefined;
        fn(...args);
      }, remaining);
    }
  };
}

export function uniqueBy<T>(
  list: T[],
  getKey: (item: T) => string | number,
): T[] {
  const map = new Map<string | number, T>();

  for (const item of list) {
    map.set(getKey(item), item);
  }

  return [...map.values()];
}

export function sortByName<T extends { name: string }>(
  list: T[],
  options?: {
    foldersFirst?: boolean;
    isFolder?: (item: T) => boolean;
  },
): T[] {
  return [...list].sort((a, b) => {
    if (options?.foldersFirst && options.isFolder) {
      const aIsFolder = options.isFolder(a);
      const bIsFolder = options.isFolder(b);

      if (aIsFolder !== bIsFolder) {
        return aIsFolder ? -1 : 1;
      }
    }

    return a.name.localeCompare(b.name);
  });
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function showErrorMessage(prefix: string, error: unknown): void {
  const message = toErrorMessage(error);
  vscode.window.showErrorMessage(`${prefix}: ${message}`);
}

export function logError(scope: string, error: unknown): void {
  console.error(`[${scope}]`, error);
}