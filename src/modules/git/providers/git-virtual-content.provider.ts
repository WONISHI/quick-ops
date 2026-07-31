import * as vscode from 'vscode';
import type { GitService } from '@modules/git/git.service';
import type { GitVirtualContentQuery } from '@modules/git/git.type';

/**
 * @description Git 虚拟文本内容 Provider
 *
 * 同时支持两种内容来源：
 * 1. Git 模块：quickops-git:?{ cwd, ref, file }
 * 2. Recent Projects：quickops-git:?key=xxx
 *
 * Provider 只在 GitModule 中注册一次，其他模块直接通过 GitModule 导出的
 * GitVirtualContentProvider 复用同一个实例。
 */
export class GitVirtualContentProvider implements vscode.TextDocumentContentProvider {
  private readonly changeEmitter = new vscode.EventEmitter<vscode.Uri>();
  private readonly contentMap = new Map<string, string>();

  private gitService?: GitService;

  public readonly onDidChange = this.changeEmitter.event;

  /**
   * @description 避免 GitService 与 Provider 通过 static inject 形成循环依赖。
   * 由 GitController.onModuleInit() 注入容器中已经创建好的 GitService。
   */
  public setGitService(gitService: GitService): void {
    this.gitService = gitService;
  }

  public provideTextDocumentContent(uri: vscode.Uri): vscode.ProviderResult<string> {
    const key = new URLSearchParams(uri.query).get('key');

    if (key) {
      return this.contentMap.get(key) || '';
    }

    const query = this.parseGitQuery(uri);

    if (!query || !this.gitService) {
      return '';
    }

    return this.gitService.getFileContent(query.cwd, query.ref, query.file);
  }

  public setContent(key: string, content: string): void {
    if (!key) return;

    this.contentMap.set(key, content);
  }

  public deleteContent(key: string): void {
    if (!key) return;

    this.contentMap.delete(key);
  }

  public dispose(): void {
    this.gitService = undefined;
    this.contentMap.clear();
    this.changeEmitter.dispose();
  }

  private parseGitQuery(uri: vscode.Uri): GitVirtualContentQuery | undefined {
    if (!uri.query) return undefined;

    try {
      const value = JSON.parse(decodeURIComponent(uri.query)) as Partial<GitVirtualContentQuery>;
      const cwd = String(value.cwd || '').trim();
      const ref = String(value.ref || 'HEAD').trim();
      const file = String(value.file || uri.path.replace(/^\/+/, '')).trim();

      if (!cwd || !ref || !file) {
        return undefined;
      }

      return {
        cwd,
        ref,
        file,
      };
    } catch {
      return undefined;
    }
  }
}
