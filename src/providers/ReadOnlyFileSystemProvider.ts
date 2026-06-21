import * as vscode from 'vscode';

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

  /**
   * 只刷新指向指定真实文件的 quickops-ro 文档。
   *
   * 之前保存一个文件时调用 refreshAllWatched，会让所有只读预览文档都刷新，
   * 继而带动 RecentProjectsProvider 整体更新。这里改成按 target 命中。
   */
  public refreshByTargetUri(targetUri: vscode.Uri): void {
    const targetKey = this.normalizeTargetKey(targetUri);

    if (!targetKey) {
      return;
    }

    Array.from(this.watchedDocuments).forEach((readonlyUriStr) => {
      const readonlyUri = vscode.Uri.parse(readonlyUriStr);
      const currentTargetUri = this.getTargetUri(readonlyUri);

      if (!currentTargetUri) {
        return;
      }

      if (this.normalizeTargetKey(currentTargetUri) === targetKey) {
        this.refresh(readonlyUri);
      }
    });
  }

  public refreshByTargetPath(targetPath: string): void {
    if (!targetPath) {
      return;
    }

    const targetUri = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(targetPath)
      ? vscode.Uri.parse(targetPath)
      : vscode.Uri.file(targetPath);

    this.refreshByTargetUri(targetUri);
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

    return vscode.workspace.fs.stat(targetUri);
  }

  public async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const targetUri = this.getTargetUri(uri);

    if (!targetUri) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }

    return vscode.workspace.fs.readFile(targetUri);
  }

  public readDirectory(): [string, vscode.FileType][] | Thenable<[string, vscode.FileType][]> {
    return [];
  }

  public createDirectory(): void | Thenable<void> {
    throw vscode.FileSystemError.NoPermissions('quickops-ro 是只读文件系统');
  }

  public writeFile(): void | Thenable<void> {
    throw vscode.FileSystemError.NoPermissions('quickops-ro 是只读文件系统');
  }

  public delete(): void | Thenable<void> {
    throw vscode.FileSystemError.NoPermissions('quickops-ro 是只读文件系统');
  }

  public rename(): void | Thenable<void> {
    throw vscode.FileSystemError.NoPermissions('quickops-ro 是只读文件系统');
  }

  public dispose(): void {
    this.watchedDocuments.clear();

    Array.from(this.debounceTimers.values()).forEach((timer) => clearTimeout(timer));
    this.debounceTimers.clear();

    this.changeEmitter.dispose();
    this.refreshTargetEmitter.dispose();
  }

  private normalizeReadonlyUri(uri: vscode.Uri): vscode.Uri {
    if (uri.scheme === 'quickops-ro') {
      return uri;
    }

    return vscode.Uri.parse(uri.toString());
  }

  private getTargetUri(uri: vscode.Uri): vscode.Uri | undefined {
    const target = new URLSearchParams(uri.query).get('target');

    if (!target) {
      return undefined;
    }

    try {
      return vscode.Uri.parse(target);
    } catch {
      return undefined;
    }
  }

  private normalizeTargetKey(uri: vscode.Uri): string {
    if (uri.scheme === 'file') {
      return uri.fsPath.replace(/\\/g, '/').replace(/\/+$/, '');
    }

    return uri.toString().split('?')[0].replace(/\\/g, '/').replace(/\/+$/, '');
  }
}
