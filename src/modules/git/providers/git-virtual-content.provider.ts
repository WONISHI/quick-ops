import * as vscode from 'vscode';
import type { GitService } from '../git.service';
import type { GitVirtualContentQuery } from '../git-uri.util';

export class GitVirtualContentProvider
  implements vscode.TextDocumentContentProvider
{
  /**
   * 不要写：
   * public static inject = [GitService];
   *
   * 这样会导致 GitVirtualContentProvider -> GitService 的运行时依赖，
   * 重构后很容易出现循环引用，最终 GitService 变成 undefined。
   */
  public static inject: any[] = [];

  private readonly changeEmitter = new vscode.EventEmitter<vscode.Uri>();

  public readonly onDidChange = this.changeEmitter.event;

  private gitService?: GitService;

  public setGitService(gitService: GitService): void {
    this.gitService = gitService;
  }

  public async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const query = this.parseQuery(uri);

    if (!query) return '';

    if (!this.gitService) {
      console.warn(
        '[GitVirtualContentProvider] GitService 未初始化，无法读取 Git 虚拟内容。',
      );

      return '';
    }

    return this.gitService.getFileContent(query.cwd, query.ref, query.file);
  }

  public refresh(uri: vscode.Uri): void {
    this.changeEmitter.fire(uri);
  }

  public dispose(): void {
    this.changeEmitter.dispose();
    this.gitService = undefined;
  }

  private parseQuery(uri: vscode.Uri): GitVirtualContentQuery | undefined {
    try {
      return JSON.parse(
        decodeURIComponent(uri.query || '{}'),
      ) as GitVirtualContentQuery;
    } catch {
      return undefined;
    }
  }
}