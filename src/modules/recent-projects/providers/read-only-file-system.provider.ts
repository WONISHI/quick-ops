import * as vscode from 'vscode';

interface ReadonlyTargetRefreshEvent {
  readonlyUri: vscode.Uri;
  targetUri: vscode.Uri;
  targetFsPath: string;
}

export class ReadOnlyFileSystemProvider implements vscode.FileSystemProvider {
  private readonly changeEmitter =
    new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  private readonly refreshTargetEmitter =
    new vscode.EventEmitter<ReadonlyTargetRefreshEvent>();

  private readonly watchedDocuments = new Set<string>();
  private readonly debounceTimers = new Map<string, NodeJS.Timeout>();

  public readonly onDidChangeFile = this.changeEmitter.event;
  public readonly onDidRefreshReadonlyTarget = this.refreshTargetEmitter.event;

  public watch(
    uri: vscode.Uri,
    _options?: {
      recursive: boolean;
      excludes: readonly string[];
    },
  ): vscode.Disposable {
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

  public refreshByTargetUri(targetUri: vscode.Uri): void {
    const targetKey = this.normalizeTargetKey(targetUri);

    if (!targetKey) return;

    for (const readonlyUriStr of this.watchedDocuments) {
      const readonlyUri = vscode.Uri.parse(readonlyUriStr);
      const currentTargetUri = this.getTargetUri(readonlyUri);

      if (!currentTargetUri) continue;

      if (this.normalizeTargetKey(currentTargetUri) === targetKey) {
        this.refresh(readonlyUri);
      }
    }
  }

  public refreshByTargetPath(targetPath: string): void {
    if (!targetPath) return;

    const targetUri = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(targetPath)
      ? vscode.Uri.parse(targetPath)
      : vscode.Uri.file(targetPath);

    this.refreshByTargetUri(targetUri);
  }

  public refreshAllWatched(): void {
    for (const readonlyUriStr of this.watchedDocuments) {
      this.refresh(vscode.Uri.parse(readonlyUriStr));
    }
  }

  public async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    const targetUri = this.getTargetUri(uri);

    if (!targetUri) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }

    return vscode.workspace.fs.stat(targetUri);
  }

  public async readDirectory(
    uri: vscode.Uri,
  ): Promise<[string, vscode.FileType][]> {
    const targetUri = this.getTargetUri(uri);

    if (!targetUri) {
      return [];
    }

    return vscode.workspace.fs.readDirectory(targetUri);
  }

  public async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const targetUri = this.getTargetUri(uri);

    if (!targetUri) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }

    return vscode.workspace.fs.readFile(targetUri);
  }

  public writeFile(): void {
    throw vscode.FileSystemError.NoPermissions('quickops-ro 是只读文件系统');
  }

  public createDirectory(): void {
    throw vscode.FileSystemError.NoPermissions('quickops-ro 是只读文件系统');
  }

  public delete(): void {
    throw vscode.FileSystemError.NoPermissions('quickops-ro 是只读文件系统');
  }

  public rename(): void {
    throw vscode.FileSystemError.NoPermissions('quickops-ro 是只读文件系统');
  }

  public createReadOnlyUri(
    targetUri: vscode.Uri,
    projectName = '只读预览',
  ): vscode.Uri {
    const fileName = targetUri.path.split(/[\\/]/).pop() || 'unknown';

    return vscode.Uri.from({
      scheme: 'quickops-ro',
      path: `/${projectName}: ${fileName}`,
      query: `target=${encodeURIComponent(targetUri.toString())}`,
    });
  }

  public dispose(): void {
    this.watchedDocuments.clear();

    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }

    this.debounceTimers.clear();
    this.changeEmitter.dispose();
    this.refreshTargetEmitter.dispose();
  }

  private normalizeReadonlyUri(uri: vscode.Uri): vscode.Uri {
    return uri.scheme === 'quickops-ro'
      ? uri
      : vscode.Uri.parse(uri.toString());
  }

  private getTargetUri(uri: vscode.Uri): vscode.Uri | undefined {
    const target = new URLSearchParams(uri.query).get('target');

    if (target) {
      try {
        return vscode.Uri.parse(target);
      } catch {
        return undefined;
      }
    }

    if (uri.authority && uri.authority !== 'file') {
      return vscode.Uri.from({
        scheme: uri.authority,
        authority: '',
        path: uri.path,
      });
    }

    if (uri.scheme === 'file') {
      return uri;
    }

    return undefined;
  }

  private normalizeTargetKey(uri: vscode.Uri): string {
    if (uri.scheme === 'file') {
      return uri.fsPath.replace(/\\/g, '/').replace(/\/+$/, '');
    }

    return uri
      .toString()
      .split('?')[0]
      .replace(/\\/g, '/')
      .replace(/\/+$/, '');
  }

  private normalizeTargetKey(uri: vscode.Uri): string {
    if (uri.scheme === 'file') {
      return uri.fsPath.replace(/\\/g, '/').replace(/\/+$/, '');
    }

    return uri.toString().split('?')[0].replace(/\\/g, '/').replace(/\/+$/, '');
  }
}
