import * as vscode from 'vscode';
import * as path from 'path';

export class DiffBuilder {
  private createGitContentUri: (cwd: string, ref: string, file: string) => vscode.Uri;

  constructor(createGitContentUri: (cwd: string, ref: string, file: string) => vscode.Uri) {
    this.createGitContentUri = createGitContentUri;
  }

  buildChangesArgs(
    cwd: string,
    files: Array<{ file: string; status: string }>,
    mode: 'working' | 'staged' | 'branch_compare' | 'commit',
    extraParams?: { baseRef?: string; rightRef?: string; isCurrentWorkspace?: boolean },
  ) {
    const defaultWorkspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const isCurrentWorkspace = extraParams?.isCurrentWorkspace ?? (defaultWorkspace && cwd === defaultWorkspace);

    return files.map((f) => {
      const status = f.status.charAt(0);
      const fileUri = vscode.Uri.file(path.join(cwd, f.file));

      let leftUri: vscode.Uri;
      let rightUri: vscode.Uri;
      let leftRef: string;
      let rightRef: string | null;

      switch (mode) {
        case 'working': {
          leftRef = 'HEAD';
          rightRef = null;
          if (status === 'A' || status === 'U' || status === '?') {
            leftRef = 'empty';
          }
          if (status === 'D') {
            rightRef = 'empty';
          }
          leftUri = this.createGitContentUri(cwd, leftRef, f.file);
          rightUri =
            rightRef === 'empty'
              ? this.createGitContentUri(cwd, 'empty', f.file)
              : isCurrentWorkspace
                ? fileUri
                : this.createGitContentUri(cwd, 'working', f.file);
          break;
        }

        case 'staged': {
          leftRef = 'HEAD';
          rightRef = 'index';
          if (status === 'A' || status === 'U') {
            leftRef = 'empty';
          }
          if (status === 'D') {
            rightRef = 'empty';
          }
          leftUri = this.createGitContentUri(cwd, leftRef, f.file);
          rightUri = this.createGitContentUri(cwd, rightRef || 'index', f.file);
          break;
        }

        case 'branch_compare': {
          leftRef = extraParams?.baseRef || 'HEAD';
          rightRef = extraParams?.rightRef || 'HEAD';
          if (status === 'A') leftRef = 'empty';
          if (status === 'D') rightRef = 'empty';
          leftUri = this.createGitContentUri(cwd, leftRef, f.file);
          rightUri = this.createGitContentUri(cwd, rightRef || 'HEAD', f.file);
          break;
        }

        case 'commit': {
          const parentHash = extraParams?.baseRef || 'empty';
          const commitHash = extraParams?.rightRef || 'HEAD';
          if (status === 'A') leftRef = 'empty';
          if (status === 'D') rightRef = 'empty';
          leftUri = this.createGitContentUri(cwd, parentHash, f.file);
          rightUri = this.createGitContentUri(cwd, commitHash, f.file);
          break;
        }

        default: {
          leftUri = this.createGitContentUri(cwd, 'HEAD', f.file);
          rightUri = isCurrentWorkspace ? fileUri : this.createGitContentUri(cwd, 'working', f.file);
        }
      }

      return [fileUri, leftUri, rightUri];
    });
  }
}
