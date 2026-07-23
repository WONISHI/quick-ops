import * as vscode from 'vscode';
import * as path from 'path';

export function normalizeComparePath(value: string) {
  if (!value) return '';

  let result = value.split('?')[0];

  if (result.startsWith('file://')) {
    result = decodeURIComponent(result.replace(/^file:\/\//, ''));

    if (/^\/[a-zA-Z]:\//.test(result)) {
      result = result.slice(1);
    }
  }

  return result.replace(/\\/g, '/').replace(/\/+$/, '');
}

export function isInsidePath(child: string, parent: string) {
  const childBase = normalizeComparePath(child);
  const parentBase = normalizeComparePath(parent);
  const normalizedParent = parentBase.endsWith('/') ? parentBase : `${parentBase}/`;

  return childBase === parentBase || childBase.startsWith(normalizedParent);
}

export function toResourceUri(fsPath: string): vscode.Uri {
  return fsPath.includes('://') ? vscode.Uri.parse(fsPath) : vscode.Uri.file(fsPath);
}

export function normalizeNativePath(fsPath: string): string {
  return toResourceUri(fsPath).fsPath;
}

export function getRelativePathByUri(rootUri: vscode.Uri, childUri: vscode.Uri): string {
  if (rootUri.scheme === 'file' && childUri.scheme === 'file') {
    return path.relative(rootUri.fsPath, childUri.fsPath).replace(/\\/g, '/');
  }

  const rootPath = rootUri.path.replace(/\/+$/, '');
  const childPath = childUri.path;

  if (childPath === rootPath) {
    return '';
  }

  if (childPath.startsWith(`${rootPath}/`)) {
    return decodeURIComponent(childPath.slice(rootPath.length + 1));
  }

  return decodeURIComponent(childPath.split('/').pop() || childPath);
}

export function parseFileUri(fsPath: string): vscode.Uri {
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(fsPath)) {
    return vscode.Uri.parse(fsPath);
  }

  return vscode.Uri.file(fsPath);
}

export function isLocalFilePath(fsPath: string): boolean {
  if (!fsPath) return false;

  return !fsPath.startsWith('vscode-vfs://') && !/^https?:\/\//i.test(fsPath);
}

export function normalizePathForCompare(value: string): string {
  if (!value) return '';

  try {
    if (value.includes('://')) {
      const uri = vscode.Uri.parse(value);

      if (uri.scheme === 'file') {
        return uri.fsPath.replace(/\\/g, '/').replace(/\/+$/, '');
      }

      return decodeURIComponent(uri.path || value)
        .replace(/\\/g, '/')
        .replace(/\/+$/, '');
    }
  } catch {}

  return value
    .replace(/^file:\/\//, '')
    .replace(/\\/g, '/')
    .replace(/\/+$/, '');
}

export function toLocalUri(value: string): vscode.Uri | undefined {
  if (!value) return undefined;

  try {
    if (value.includes('://')) {
      const uri = vscode.Uri.parse(value);
      return uri.scheme === 'file' ? uri : undefined;
    }

    return vscode.Uri.file(value);
  } catch {
    return undefined;
  }
}
