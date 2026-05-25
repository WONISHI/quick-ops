import * as vscode from 'vscode';
import * as path from 'path';

export class ReadOnlyFileSystemProvider implements vscode.FileSystemProvider {
  private readonly changeEmitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  public readonly onDidChangeFile = this.changeEmitter.event;

  private readonly watchedDocuments = new Map<string, vscode.Disposable>();
  private readonly debounceTimers = new Map<string, NodeJS.Timeout>();

  public watch(uri: vscode.Uri): vscode.Disposable {
    return this.watchReadonlyDocument(uri);
  }

  public watchReadonlyDocument(uri: vscode.Uri): vscode.Disposable {
    const readonlyUri = this.normalizeReadonlyUri(uri);
    const readonlyUriKey = readonlyUri.toString();

    const existing = this.watchedDocuments.get(readonlyUriKey);
    if (existing) {
      return new vscode.Disposable(() => undefined);
    }

    const targetUri = this.getTargetUri(readonlyUri);

    if (!targetUri || targetUri.scheme !== 'file') {
      return new vscode.Disposable(() => undefined);
    }

    const nativePath = targetUri.fsPath;
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(path.dirname(nativePath), path.basename(nativePath)),
      false,
      false,
      false
    );

    const trigger = () => this.refresh(readonlyUri);

    const subscriptions: vscode.Disposable[] = [
      watcher,
      watcher.onDidChange(trigger),
      watcher.onDidCreate(trigger),
      watcher.onDidDelete(trigger),
    ];

    const disposable = new vscode.Disposable(() => {
      subscriptions.forEach((item) => item.dispose());
      this.watchedDocuments.delete(readonlyUriKey);

      const timer = this.debounceTimers.get(readonlyUriKey);
      if (timer) {
        clearTimeout(timer);
        this.debounceTimers.delete(readonlyUriKey);
      }
    });

    this.watchedDocuments.set(readonlyUriKey, disposable);

    return new vscode.Disposable(() => undefined);
  }

  public refresh(uri: vscode.Uri) {
    const readonlyUri = this.normalizeReadonlyUri(uri);
    const readonlyUriKey = readonlyUri.toString();
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
    }, 80);

    this.debounceTimers.set(readonlyUriKey, timer);
  }

  public refreshAllWatched() {
    Array.from(this.watchedDocuments.keys()).forEach((uriStr) => {
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
}
