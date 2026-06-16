import * as vscode from 'vscode';

type CacheItem<T> = {
  value: T;
  expiresAt: number;
};

export class ReadOnlyFileSystemProvider implements vscode.FileSystemProvider {
  private readonly changeEmitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  public readonly onDidChangeFile = this.changeEmitter.event;

  private readonly refreshTargetEmitter = new vscode.EventEmitter<{
    readonlyUri: vscode.Uri;
    targetUri: vscode.Uri;
    targetFsPath: string;
  }>();

  public readonly onDidRefreshReadonlyTarget = this.refreshTargetEmitter.event;

  private readonly watchedDocuments = new Set<string>();
  private readonly debounceTimers = new Map<string, NodeJS.Timeout>();

  private readonly targetUriCache = new Map<string, vscode.Uri | undefined>();
  private readonly statCache = new Map<string, CacheItem<vscode.FileStat>>();
  private readonly fileCache = new Map<string, CacheItem<Uint8Array>>();
  private readonly dirCache = new Map<string, CacheItem<[string, vscode.FileType][]>>();

  private readonly statInflight = new Map<string, Promise<vscode.FileStat>>();
  private readonly fileInflight = new Map<string, Promise<Uint8Array>>();
  private readonly dirInflight = new Map<string, Promise<[string, vscode.FileType][]>>();

  private readonly cacheTtl = 2500;

  public watch(uri: vscode.Uri): vscode.Disposable {
    const readonlyUri = this.normalizeReadonlyUri(uri);
    const readonlyUriKey = readonlyUri.toString();

    this.watchedDocuments.add(readonlyUriKey);

    return new vscode.Disposable(() => {
      this.watchedDocuments.delete(readonlyUriKey);

      const timer = this.debounceTimers.get(readonlyUriKey);

      if (timer) {
        clearTimeout(timer);
        this.debounceTimers.delete(readonlyUriKey);
      }
    });
  }

  public refresh(uri: vscode.Uri): void {
    const readonlyUri = this.normalizeReadonlyUri(uri);
    const readonlyUriKey = readonlyUri.toString();
    const targetUri = this.getTargetUri(readonlyUri);
    const oldTimer = this.debounceTimers.get(readonlyUriKey);

    if (oldTimer) {
      clearTimeout(oldTimer);
    }

    const timer = setTimeout(() => {
      this.debounceTimers.delete(readonlyUriKey);

      this.invalidateReadonlyUri(readonlyUri);

      if (targetUri) {
        this.invalidateTargetUri(targetUri);
      }

      this.changeEmitter.fire([
        {
          type: vscode.FileChangeType.Changed,
          uri: readonlyUri,
        },
      ]);

      if (targetUri && targetUri.scheme === 'file') {
        this.refreshTargetEmitter.fire({
          readonlyUri,
          targetUri,
          targetFsPath: targetUri.fsPath,
        });
      }
    }, 80);

    this.debounceTimers.set(readonlyUriKey, timer);
  }

  public refreshAllWatched(): void {
    Array.from(this.watchedDocuments).forEach((uriStr) => {
      this.refresh(vscode.Uri.parse(uriStr));
    });
  }

  public async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    const targetUri = this.getTargetUri(uri);

    if (!targetUri) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }

    const key = targetUri.toString();
    const cached = this.getCache(this.statCache, key);

    if (cached) {
      return cached;
    }

    const inflight = this.statInflight.get(key);

    if (inflight) {
      return inflight;
    }

    const task = (async () => {
      try {
        const stat = await vscode.workspace.fs.stat(targetUri);

        this.setCache(this.statCache, key, stat);

        return stat;
      } finally {
        this.statInflight.delete(key);
      }
    })();

    this.statInflight.set(key, task);

    return task;
  }

  public async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const targetUri = this.getTargetUri(uri);

    if (!targetUri) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }

    const key = targetUri.toString();
    const cached = this.getCache(this.fileCache, key);

    if (cached) {
      return cached;
    }

    const inflight = this.fileInflight.get(key);

    if (inflight) {
      return inflight;
    }

    const task = (async () => {
      try {
        const content = await vscode.workspace.fs.readFile(targetUri);

        this.setCache(this.fileCache, key, content);

        return content;
      } finally {
        this.fileInflight.delete(key);
      }
    })();

    this.fileInflight.set(key, task);

    return task;
  }

  public async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    const targetUri = this.getTargetUri(uri);

    if (!targetUri) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }

    const key = targetUri.toString();
    const cached = this.getCache(this.dirCache, key);

    if (cached) {
      return cached;
    }

    const inflight = this.dirInflight.get(key);

    if (inflight) {
      return inflight;
    }

    const task = (async () => {
      try {
        const entries = await vscode.workspace.fs.readDirectory(targetUri);
        const sorted = entries.slice().sort((a, b) => {
          const aIsDir = (a[1] & vscode.FileType.Directory) !== 0;
          const bIsDir = (b[1] & vscode.FileType.Directory) !== 0;

          if (aIsDir !== bIsDir) {
            return aIsDir ? -1 : 1;
          }

          return a[0].localeCompare(b[0]);
        });

        this.setCache(this.dirCache, key, sorted);

        return sorted;
      } finally {
        this.dirInflight.delete(key);
      }
    })();

    this.dirInflight.set(key, task);

    return task;
  }

  public createDirectory(): void {
    throw vscode.FileSystemError.NoPermissions('quickops-ro 是只读文件系统');
  }

  public writeFile(): void {
    throw vscode.FileSystemError.NoPermissions('quickops-ro 是只读文件系统');
  }

  public delete(): void {
    throw vscode.FileSystemError.NoPermissions('quickops-ro 是只读文件系统');
  }

  public rename(): void {
    throw vscode.FileSystemError.NoPermissions('quickops-ro 是只读文件系统');
  }

  public dispose(): void {
    this.watchedDocuments.clear();

    Array.from(this.debounceTimers.values()).forEach((timer) => clearTimeout(timer));
    this.debounceTimers.clear();

    this.targetUriCache.clear();

    this.statCache.clear();
    this.fileCache.clear();
    this.dirCache.clear();

    this.statInflight.clear();
    this.fileInflight.clear();
    this.dirInflight.clear();

    this.changeEmitter.dispose();
    this.refreshTargetEmitter.dispose();
  }

  private normalizeReadonlyUri(uri: vscode.Uri): vscode.Uri {
    return uri;
  }

  private getTargetUri(uri: vscode.Uri): vscode.Uri | undefined {
    const uriKey = uri.toString();

    if (this.targetUriCache.has(uriKey)) {
      return this.targetUriCache.get(uriKey);
    }

    const target = new URLSearchParams(uri.query).get('target');

    if (!target) {
      this.targetUriCache.set(uriKey, undefined);
      return undefined;
    }

    try {
      const targetUri = vscode.Uri.parse(target);

      this.targetUriCache.set(uriKey, targetUri);

      return targetUri;
    } catch {
      this.targetUriCache.set(uriKey, undefined);
      return undefined;
    }
  }

  private getCache<T>(cache: Map<string, CacheItem<T>>, key: string): T | undefined {
    const item = cache.get(key);

    if (!item) {
      return undefined;
    }

    if (item.expiresAt < Date.now()) {
      cache.delete(key);
      return undefined;
    }

    return item.value;
  }

  private setCache<T>(cache: Map<string, CacheItem<T>>, key: string, value: T): void {
    cache.set(key, {
      value,
      expiresAt: Date.now() + this.cacheTtl,
    });
  }

  private invalidateReadonlyUri(uri: vscode.Uri): void {
    const targetUri = this.getTargetUri(uri);

    if (targetUri) {
      this.invalidateTargetUri(targetUri);
    }

    this.targetUriCache.delete(uri.toString());
  }

  private invalidateTargetUri(uri: vscode.Uri): void {
    const key = uri.toString();

    this.statCache.delete(key);
    this.fileCache.delete(key);
    this.dirCache.delete(key);

    this.statInflight.delete(key);
    this.fileInflight.delete(key);
    this.dirInflight.delete(key);

    const parentPath = uri.path.replace(/\/[^/]*$/, '') || '/';
    const parentUri = uri.with({ path: parentPath });

    this.dirCache.delete(parentUri.toString());
    this.dirInflight.delete(parentUri.toString());
  }
}
