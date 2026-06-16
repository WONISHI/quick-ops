import * as vscode from 'vscode';

export class GitVirtualContentProvider implements vscode.TextDocumentContentProvider {
  private readonly changeEmitter = new vscode.EventEmitter<vscode.Uri>();
  public readonly onDidChange = this.changeEmitter.event;

  private readonly contentMap = new Map<string, string>();

  public provideTextDocumentContent(uri: vscode.Uri): string {
    const key = new URLSearchParams(uri.query).get('key') || '';

    return this.contentMap.get(key) || '';
  }

  public setContent(key: string, content: string): void {
    this.contentMap.set(key, content);
  }

  public deleteContent(key: string): void {
    this.contentMap.delete(key);
  }

  public dispose(): void {
    this.contentMap.clear();
    this.changeEmitter.dispose();
  }
}
