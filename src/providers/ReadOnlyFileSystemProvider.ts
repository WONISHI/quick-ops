import * as vscode from 'vscode';

export class ReadOnlyFileSystemProvider implements vscode.FileSystemProvider {
  public onDidChangeFileEmitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  public onDidChangeFile = this.onDidChangeFileEmitter.event;

  private fileCache = new Map<string, Uint8Array>();

  watch(): vscode.Disposable {
    return new vscode.Disposable(() => { });
  }

  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    return {
      type: vscode.FileType.File,
      ctime: Date.now(),
      mtime: Date.now(),
      size: 0,
      permissions: vscode.FilePermission.Readonly,
    };
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    try {
      const targetQuery = uri.query.replace('target=', '');
      const targetUriStr = decodeURIComponent(targetQuery);

      if (this.fileCache.has(targetUriStr)) {
        return this.fileCache.get(targetUriStr)!;
      }

      const targetUri = vscode.Uri.parse(targetUriStr);

      return await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Window,
          title: '正在拉取远程文件内容...',
        },
        async () => {
          const contentBytes = await vscode.workspace.fs.readFile(targetUri);
          this.fileCache.set(targetUriStr, contentBytes);
          return contentBytes;
        }
      );
    } catch (e) {
      return Buffer.from(`/* 无法读取该文件内容。可能是由于网络不佳或触发了 API 请求频率限制。\n   详情：${e} */`, 'utf8');
    }
  }

  // 以下为只读文件系统必须实现的占位方法，直接抛出无权限异常即可
  readDirectory(): [string, vscode.FileType][] { return []; }
  createDirectory() { throw vscode.FileSystemError.NoPermissions(); }
  writeFile() { throw vscode.FileSystemError.NoPermissions(); }
  delete() { throw vscode.FileSystemError.NoPermissions(); }
  rename() { throw vscode.FileSystemError.NoPermissions(); }
}
