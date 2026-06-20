import * as vscode from 'vscode';

export interface GitVirtualContentQuery {
  cwd: string;
  ref: string;
  file: string;
}

export function createGitVirtualContentUri(
  query: GitVirtualContentQuery,
): vscode.Uri {
  return vscode.Uri.from({
    scheme: 'quickops-git',
    path: `/${query.file}`,
    query: encodeURIComponent(JSON.stringify(query)),
  });
}