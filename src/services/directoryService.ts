import * as vscode from 'vscode';
import * as path from 'path';
import { RecentProjectsGitStatusService } from './gitStatusService';

export interface RecentProjectsDirectoryChild {
  name: string;
  isFolder: boolean;
  path: string;
  status?: string;
}

export interface ReadRecentProjectsDirectoryOptions {
  fsPath: string;
  projectName: string;
  focusOnly?: boolean;
  forceRefresh?: boolean;
  postMessage: (message: Record<string, unknown>) => void;
}

export class RecentProjectsDirectoryService {
  private readonly dirCache = new Map<string, { children: RecentProjectsDirectoryChild[]; timestamp: number }>();
  private readonly dirCacheTtl = 3000;

  constructor(private readonly gitStatusService: RecentProjectsGitStatusService) { }

  public invalidateDirCache(fsPath?: string) {
    if (!fsPath) {
      this.dirCache.clear();
      return;
    }

    const uri = fsPath.includes('://') ? vscode.Uri.parse(fsPath) : vscode.Uri.file(fsPath);
    const uriStr = uri.toString();

    for (const key of Array.from(this.dirCache.keys())) {
      if (key.endsWith(uriStr) || key.includes(uriStr + '/')) {
        this.dirCache.delete(key);
      }
    }
  }

  public async readDirectory(options: ReadRecentProjectsDirectoryOptions) {
    const {
      fsPath,
      projectName,
      focusOnly = false,
      forceRefresh = false,
      postMessage,
    } = options;

    try {
      const uri = fsPath.includes('://') ? vscode.Uri.parse(fsPath) : vscode.Uri.file(fsPath);
      const uriStr = uri.toString();
      const isRemote = uriStr.startsWith('vscode-vfs://') || uriStr.startsWith('http');

      const cacheKey = `${focusOnly ? 'focus:' : 'normal:'}${uriStr}`;
      const cached = this.dirCache.get(cacheKey);
      const now = Date.now();

      if (!forceRefresh && cached && now - cached.timestamp <= this.dirCacheTtl) {
        postMessage({
          type: 'readDirResult',
          fsPath: uriStr,
          children: cached.children,
          projectName,
          focusOnly,
        });
        return;
      }

      const entries = await vscode.workspace.fs.readDirectory(uri);

      let gitRoot = '';
      let statusMap = new Map<string, string>();

      if (!isRemote && uri.scheme === 'file') {
        gitRoot = await this.gitStatusService.getGitRoot(uri.fsPath);
        if (gitRoot) {
          statusMap = await this.gitStatusService.getGitStatusMap(uri.fsPath);
        }
      }

      const ignoredNames = new Set([
        'node_modules',
        '.git',
        '.DS_Store',
      ]);

      const children = entries
        .filter(([name]) => !ignoredNames.has(name))
        .map(([name, type]) => {
          const isFolder = (type & vscode.FileType.Directory) !== 0;
          const childUri = vscode.Uri.joinPath(uri, name);
          const childUriStr = childUri.toString();
          let status: string | undefined;

          if (!isRemote && gitRoot && childUri.scheme === 'file') {
            const relativePath = path.relative(gitRoot, childUri.fsPath);
            status = this.gitStatusService.getChildGitStatus(relativePath, isFolder, statusMap);
          }

          return {
            name,
            isFolder,
            path: childUriStr,
            status,
          };
        })
        .filter((child) => {
          if (!focusOnly) return true;
          return !!child.status;
        })
        .sort((a, b) => {
          if (a.isFolder === b.isFolder) return a.name.localeCompare(b.name);
          return a.isFolder ? -1 : 1;
        });

      this.dirCache.set(cacheKey, {
        children,
        timestamp: now,
      });

      postMessage({
        type: 'readDirResult',
        fsPath: uriStr,
        children,
        projectName,
        focusOnly,
      });
    } catch (e) {
      const uri = fsPath.includes('://') ? vscode.Uri.parse(fsPath) : vscode.Uri.file(fsPath);
      const uriStr = uri.toString();
      const isRemote = uriStr.startsWith('vscode-vfs://') || uriStr.startsWith('http');

      postMessage({
        type: 'readDirResult',
        fsPath: uriStr,
        children: [],
        projectName,
        focusOnly,
      });

      if (isRemote) {
        vscode.window.showErrorMessage('读取失败：可能是网络超时或触发了 GitHub API 限制，请稍后再试。');
      }
    }
  }
}
