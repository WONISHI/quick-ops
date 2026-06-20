import * as vscode from 'vscode';
import * as path from 'path';
import { execFile } from 'child_process';

export type GitFileStatus = 'u' | 'a' | 'm' | 'd' | 'r' | 'c';

export interface DirectoryEntryItem {
  path: string;
  name: string;
  isFolder: boolean;
  status?: GitFileStatus;
  diagnostics: {
    errors: number;
    warnings: number;
  };
}

export interface SearchFileNameResult {
  path: string;
  name: string;
  relativePath: string;
  isFolder: boolean;
  status?: GitFileStatus;
  diagnostics: {
    errors: number;
    warnings: number;
  };
}

export interface SearchTextMatch {
  line: number;
  text: string;
}

export interface SearchTextResult {
  file: string;
  fullPath: string;
  matches: SearchTextMatch[];
  diagnostics: {
    errors: number;
    warnings: number;
  };
}

export class DirectoryService {
  private static instance: DirectoryService | undefined;

  private constructor() {}

  public static getInstance(): DirectoryService {
    if (!DirectoryService.instance) {
      DirectoryService.instance = new DirectoryService();
    }

    return DirectoryService.instance;
  }

  public toUri(value: string | vscode.Uri): vscode.Uri {
    if (value instanceof vscode.Uri) return value;

    if (value.includes('://')) {
      return vscode.Uri.parse(value);
    }

    return vscode.Uri.file(value);
  }

  public async readDirectory(
    target: string | vscode.Uri,
  ): Promise<DirectoryEntryItem[]> {
    const uri = this.toUri(target);
    const nativePath = uri.fsPath || uri.path;
    const statusMap = uri.scheme === 'file'
      ? await this.getGitStatusMap(nativePath)
      : new Map<string, GitFileStatus>();

    const gitRoot = uri.scheme === 'file'
      ? await this.getGitRoot(nativePath)
      : '';

    const entries = await vscode.workspace.fs.readDirectory(uri);

    return entries
      .filter(([name]) => !this.shouldIgnoreVisibleName(name))
      .map(([name, type]) => {
        const childUri = vscode.Uri.joinPath(uri, name);
        const isFolder = (type & vscode.FileType.Directory) !== 0;
        const relativePath = gitRoot
          ? this.normalizeRelativePath(path.relative(gitRoot, childUri.fsPath))
          : name;

        return {
          path: childUri.toString(),
          name,
          isFolder,
          status: this.getChildGitStatus(relativePath, isFolder, statusMap),
          diagnostics: this.getDiagnostics(childUri),
        };
      })
      .sort((a, b) => {
        if (a.isFolder !== b.isFolder) {
          return a.isFolder ? -1 : 1;
        }

        return a.name.localeCompare(b.name);
      });
  }

  public async createFile(
    parent: string | vscode.Uri,
    fileName: string,
  ): Promise<vscode.Uri | undefined> {
    const parentUri = this.toUri(parent);

    if (parentUri.scheme !== 'file') {
      vscode.window.showWarningMessage('当前只支持在本地目录中新建文件');
      return undefined;
    }

    const normalizedName = this.normalizeEntityName(fileName);

    if (!normalizedName) return undefined;

    const fileUri = vscode.Uri.joinPath(
      parentUri,
      ...this.toPathParts(normalizedName),
    );

    await this.ensureParentDirectory(fileUri);
    await vscode.workspace.fs.writeFile(fileUri, new Uint8Array());

    return fileUri;
  }

  public async createFolder(
    parent: string | vscode.Uri,
    folderName: string,
  ): Promise<vscode.Uri | undefined> {
    const parentUri = this.toUri(parent);

    if (parentUri.scheme !== 'file') {
      vscode.window.showWarningMessage('当前只支持在本地目录中新建文件夹');
      return undefined;
    }

    const normalizedName = this.normalizeEntityName(folderName);

    if (!normalizedName) return undefined;

    const folderUri = vscode.Uri.joinPath(
      parentUri,
      ...this.toPathParts(normalizedName),
    );

    await vscode.workspace.fs.createDirectory(folderUri);

    return folderUri;
  }

  public async rename(
    oldPath: string | vscode.Uri,
    newNameOrPath: string,
    options: {
      overwrite?: boolean;
    } = {},
  ): Promise<vscode.Uri | undefined> {
    const oldUri = this.toUri(oldPath);

    if (oldUri.scheme !== 'file') {
      vscode.window.showWarningMessage('当前只支持重命名本地文件');
      return undefined;
    }

    const newUri = newNameOrPath.includes('://')
      ? this.toUri(newNameOrPath)
      : vscode.Uri.joinPath(vscode.Uri.joinPath(oldUri, '..'), newNameOrPath);

    await vscode.workspace.fs.rename(oldUri, newUri, {
      overwrite: Boolean(options.overwrite),
    });

    return newUri;
  }

  public async delete(
    target: string | vscode.Uri,
    options: {
      useTrash?: boolean;
      recursive?: boolean;
    } = {},
  ): Promise<void> {
    const uri = this.toUri(target);

    if (uri.scheme !== 'file') {
      vscode.window.showWarningMessage('当前只支持删除本地文件');
      return;
    }

    await vscode.workspace.fs.delete(uri, {
      recursive: options.recursive ?? true,
      useTrash: options.useTrash ?? true,
    });
  }

  public async exists(target: string | vscode.Uri): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(this.toUri(target));
      return true;
    } catch {
      return false;
    }
  }

  public async searchFileName(
    root: string | vscode.Uri,
    query: string,
    options: {
      maxResults?: number;
    } = {},
  ): Promise<SearchFileNameResult[]> {
    const rootUri = this.toUri(root);
    const keyword = query.trim().toLowerCase();
    const maxResults = options.maxResults ?? 200;
    const results: SearchFileNameResult[] = [];

    if (!keyword) return results;

    const gitRoot = rootUri.scheme === 'file'
      ? await this.getGitRoot(rootUri.fsPath)
      : '';

    const statusMap = gitRoot
      ? await this.getGitStatusMap(gitRoot)
      : new Map<string, GitFileStatus>();

    const walk = async (dirUri: vscode.Uri): Promise<void> => {
      if (results.length >= maxResults) return;

      let entries: [string, vscode.FileType][];

      try {
        entries = await vscode.workspace.fs.readDirectory(dirUri);
      } catch {
        return;
      }

      for (const [name, type] of entries) {
        if (results.length >= maxResults) break;
        if (this.shouldIgnoreName(name)) continue;

        const childUri = vscode.Uri.joinPath(dirUri, name);
        const isFolder = (type & vscode.FileType.Directory) !== 0;
        const relativePath = this.normalizeRelativePath(
          path.posix.relative(rootUri.path, childUri.path),
        );

        if (
          name.toLowerCase().includes(keyword) ||
          relativePath.toLowerCase().includes(keyword)
        ) {
          const gitRelativePath = gitRoot && childUri.scheme === 'file'
            ? this.normalizeRelativePath(path.relative(gitRoot, childUri.fsPath))
            : relativePath;

          results.push({
            path: childUri.toString(),
            name,
            relativePath,
            isFolder,
            status: this.getChildGitStatus(
              gitRelativePath,
              isFolder,
              statusMap,
            ),
            diagnostics: this.getDiagnostics(childUri),
          });
        }

        if (isFolder) {
          await walk(childUri);
        }
      }
    };

    await walk(rootUri);

    return results;
  }

  public async searchText(
    root: string | vscode.Uri,
    query: string,
    options: {
      maxResults?: number;
      maxFileSize?: number;
    } = {},
  ): Promise<SearchTextResult[]> {
    const rootUri = this.toUri(root);
    const keyword = query.trim().toLowerCase();
    const maxResults = options.maxResults ?? 200;
    const maxFileSize = options.maxFileSize ?? 2 * 1024 * 1024;
    const results: SearchTextResult[] = [];
    let matchCount = 0;

    if (!keyword) return results;

    const walk = async (dirUri: vscode.Uri): Promise<void> => {
      if (matchCount >= maxResults) return;

      let entries: [string, vscode.FileType][];

      try {
        entries = await vscode.workspace.fs.readDirectory(dirUri);
      } catch {
        return;
      }

      for (const [name, type] of entries) {
        if (matchCount >= maxResults) break;
        if (this.shouldIgnoreName(name)) continue;

        const childUri = vscode.Uri.joinPath(dirUri, name);
        const isFolder = (type & vscode.FileType.Directory) !== 0;

        if (isFolder) {
          await walk(childUri);
          continue;
        }

        if (this.isBinaryLikeFile(name)) continue;

        try {
          const stat = await vscode.workspace.fs.stat(childUri);

          if (stat.size > maxFileSize) continue;

          const contentBytes = await vscode.workspace.fs.readFile(childUri);
          const content = Buffer.from(contentBytes).toString('utf8');
          const lines = content.split(/\r?\n/);
          const matches: SearchTextMatch[] = [];

          lines.forEach((line, index) => {
            if (matchCount >= maxResults) return;

            if (line.toLowerCase().includes(keyword)) {
              matches.push({
                line: index + 1,
                text: line.trim().slice(0, 300),
              });

              matchCount++;
            }
          });

          if (matches.length > 0) {
            results.push({
              file: this.normalizeRelativePath(
                path.posix.relative(rootUri.path, childUri.path),
              ),
              fullPath: childUri.toString(),
              matches,
              diagnostics: this.getDiagnostics(childUri),
            });
          }
        } catch {
          // ignore unreadable file
        }
      }
    };

    await walk(rootUri);

    return results;
  }

  public execGit(args: string[], cwd: string): Promise<string> {
    return new Promise(resolve => {
      execFile('git', args, { cwd }, (error, stdout) => {
        if (error) {
          resolve('');
          return;
        }

        resolve(stdout || '');
      });
    });
  }

  public async getGitRoot(nativePath: string): Promise<string> {
    if (!nativePath) return '';

    const result = await this.execGit(
      ['rev-parse', '--show-toplevel'],
      nativePath,
    );

    return result.trim();
  }

  public normalizeGitStatus(rawStatus: string): GitFileStatus | undefined {
    const status = rawStatus.trim().toUpperCase();

    if (!status) return undefined;
    if (status === '??') return 'u';
    if (status.includes('D')) return 'd';
    if (status.includes('M')) return 'm';
    if (status.includes('A')) return 'a';
    if (status.includes('R')) return 'r';
    if (status.includes('C')) return 'c';

    return undefined;
  }

  public normalizeRelativePath(value: string): string {
    return value.replace(/\\/g, '/').replace(/^\/+/, '');
  }

  public async getGitStatusMap(
    nativePath: string,
  ): Promise<Map<string, GitFileStatus>> {
    const map = new Map<string, GitFileStatus>();

    try {
      const gitRoot = await this.getGitRoot(nativePath);

      if (!gitRoot) return map;

      const output = await this.execGit(
        ['status', '--porcelain=v1', '-z', '-uall'],
        gitRoot,
      );

      if (!output) return map;

      const parts = output.split('\0').filter(Boolean);

      for (let index = 0; index < parts.length; index++) {
        const item = parts[index];
        const rawStatus = item.slice(0, 2);
        const rawPath = item.slice(3);

        if (!rawPath) continue;

        const status = this.normalizeGitStatus(rawStatus);

        if (!status) continue;

        const normalizedPath = this.normalizeRelativePath(rawPath);

        map.set(normalizedPath, status);

        if (rawStatus.toUpperCase().includes('R') && parts[index + 1]) {
          index++;
        }
      }
    } catch {
      return map;
    }

    return map;
  }

  public getGitStatusPriority(status?: string): number {
    switch ((status || '').toLowerCase()) {
      case 'd':
        return 60;
      case 'm':
        return 50;
      case 'a':
        return 40;
      case 'u':
        return 30;
      case 'r':
        return 20;
      case 'c':
        return 10;
      default:
        return 0;
    }
  }

  public getChildGitStatus(
    childRelativePath: string,
    isFolder: boolean,
    statusMap: Map<string, GitFileStatus>,
  ): GitFileStatus | undefined {
    const normalizedChildPath = this.normalizeRelativePath(childRelativePath);
    const normalizedChildPathWithSlash = normalizedChildPath.endsWith('/')
      ? normalizedChildPath
      : `${normalizedChildPath}/`;

    if (!isFolder) {
      const exactStatus = statusMap.get(normalizedChildPath);

      if (exactStatus) return exactStatus;

      let finalStatus: GitFileStatus | undefined;
      let finalMatchedLength = 0;

      for (const [changedPath, status] of statusMap.entries()) {
        if (!changedPath.endsWith('/')) continue;

        if (
          normalizedChildPath.startsWith(changedPath) &&
          changedPath.length > finalMatchedLength
        ) {
          finalStatus = status;
          finalMatchedLength = changedPath.length;
        }
      }

      return finalStatus;
    }

    const exactFolderStatus =
      statusMap.get(normalizedChildPath) ||
      statusMap.get(normalizedChildPathWithSlash);

    let finalStatus = exactFolderStatus;
    let finalPriority = this.getGitStatusPriority(exactFolderStatus);

    for (const [changedPath, status] of statusMap.entries()) {
      if (!changedPath.startsWith(normalizedChildPathWithSlash)) continue;

      const priority = this.getGitStatusPriority(status);

      if (priority > finalPriority) {
        finalStatus = status;
        finalPriority = priority;
      }
    }

    return finalStatus;
  }

  public getDiagnostics(uri: vscode.Uri): {
    errors: number;
    warnings: number;
  } {
    const diagnostics = vscode.languages.getDiagnostics(uri);

    return {
      errors: diagnostics.filter(
        item => item.severity === vscode.DiagnosticSeverity.Error,
      ).length,
      warnings: diagnostics.filter(
        item => item.severity === vscode.DiagnosticSeverity.Warning,
      ).length,
    };
  }

  public shouldIgnoreVisibleName(name: string): boolean {
    return name === '.DS_Store' || name === 'Thumbs.db';
  }

  public shouldIgnoreName(name: string): boolean {
    return [
      'node_modules',
      'dist',
      'build',
      'out',
      '.git',
      '.svn',
      '.hg',
      '.DS_Store',
      'Thumbs.db',
    ].includes(name);
  }

  public isBinaryLikeFile(name: string): boolean {
    const ext = path.extname(name).toLowerCase();

    return [
      '.png',
      '.jpg',
      '.jpeg',
      '.gif',
      '.ico',
      '.svg',
      '.webp',
      '.bmp',
      '.pdf',
      '.zip',
      '.tar',
      '.gz',
      '.7z',
      '.rar',
      '.exe',
      '.dll',
      '.so',
      '.dylib',
      '.woff',
      '.woff2',
      '.ttf',
      '.eot',
      '.otf',
      '.mp4',
      '.mp3',
      '.mov',
      '.avi',
      '.xlsx',
      '.xls',
      '.docx',
      '.doc',
      '.pptx',
      '.ppt',
    ].includes(ext);
  }

  private normalizeEntityName(name: string): string {
    const value = name.trim().replace(/\\/g, '/');

    if (!value) {
      vscode.window.showWarningMessage('名称不能为空');
      return '';
    }

    if (value.startsWith('/') || value.endsWith('/')) {
      vscode.window.showWarningMessage('名称不能以 / 开头或结尾');
      return '';
    }

    const parts = value.split('/').map(item => item.trim());

    if (parts.some(item => !item || item === '.' || item === '..')) {
      vscode.window.showWarningMessage('名称中不能包含空路径、. 或 ..');
      return '';
    }

    const invalidPart = parts.find(item => /[<>:"|?*]/.test(item));

    if (invalidPart) {
      vscode.window.showWarningMessage(`名称包含非法字符: ${invalidPart}`);
      return '';
    }

    return value;
  }

  private toPathParts(value: string): string[] {
    return value.replace(/\\/g, '/').split('/').filter(Boolean);
  }

  private async ensureParentDirectory(fileUri: vscode.Uri): Promise<void> {
    const parentUri = vscode.Uri.joinPath(fileUri, '..');

    await vscode.workspace.fs.createDirectory(parentUri);
  }
}