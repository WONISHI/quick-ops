import * as vscode from 'vscode';

export class ReadOnlyFileSystemProvider implements vscode.FileSystemProvider {
  private readonly changeEmitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  private readonly refreshEmitter = new vscode.EventEmitter<void>();

  public readonly onDidChangeFile = this.changeEmitter.event;
  public readonly onDidRefreshReadonlyTarget = this.refreshEmitter.event;

  public watch(
    uri: vscode.Uri,
    _options: {
      recursive: boolean;
      excludes: readonly string[];
    },
  ): vscode.Disposable {
    return new vscode.Disposable(() => {
      void uri;
    });
  }

  public async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    const targetUri = this.toTargetUri(uri);

    return vscode.workspace.fs.stat(targetUri);
  }

  public async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    const targetUri = this.toTargetUri(uri);

    return vscode.workspace.fs.readDirectory(targetUri);
  }

  public async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const targetUri = this.toTargetUri(uri);

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

  public refreshAllWatched(): void {
    this.changeEmitter.fire([
      {
        type: vscode.FileChangeType.Changed,
        uri: vscode.Uri.parse('quickops-ro:/'),
      },
    ]);

    this.refreshEmitter.fire();
  }

  public createReadOnlyUri(targetUri: vscode.Uri): vscode.Uri {
    return vscode.Uri.from({
      scheme: 'quickops-ro',
      authority: targetUri.scheme,
      path: targetUri.path,
      query: `target=${encodeURIComponent(targetUri.toString())}`,
    });
  }

  public dispose(): void {
    this.changeEmitter.dispose();
    this.refreshEmitter.dispose();
  }

  private toTargetUri(uri: vscode.Uri): vscode.Uri {
    const params = new URLSearchParams(uri.query);
    const target = params.get('target');

    if (target) {
      return vscode.Uri.parse(target);
    }

    if (uri.authority && uri.authority !== 'file') {
      return vscode.Uri.from({
        scheme: uri.authority,
        authority: '',
        path: uri.path,
      });
    }

    return vscode.Uri.file(uri.fsPath);
  }
}