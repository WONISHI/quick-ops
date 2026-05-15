import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { MarkdownProcessResult } from './setupMarkdown';

const WEB_URL_RE = /^(https?:\/\/|data:|blob:|vscode-webview-resource:|vscode-resource:|mailto:|#)/i;
const IMAGE_DIR_NAMES = ['img', 'images', 'assets'];

function stripWrap(value: string) {
  let result = value.trim();

  if (result.startsWith('<') && result.endsWith('>')) {
    result = result.slice(1, -1).trim();
  }

  if ((result.startsWith('"') && result.endsWith('"')) || (result.startsWith("'") && result.endsWith("'"))) {
    result = result.slice(1, -1).trim();
  }

  return result;
}

function splitMarkdownImageTarget(value: string) {
  const raw = value.trim();

  if (!raw) {
    return {
      src: '',
      title: '',
    };
  }

  if (raw.startsWith('<')) {
    const endIndex = raw.indexOf('>');

    if (endIndex > -1) {
      return {
        src: raw.slice(1, endIndex).trim(),
        title: raw.slice(endIndex + 1).trim(),
      };
    }
  }

  const titleMatch = raw.match(/^(.+?)(\s+["'][^"']*["'])$/);

  if (titleMatch) {
    return {
      src: stripWrap(titleMatch[1]),
      title: titleMatch[2].trim(),
    };
  }

  return {
    src: stripWrap(raw),
    title: '',
  };
}

async function exists(filePath: string) {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(filePath: string) {
  try {
    const stat = await fs.stat(filePath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function findFileRecursive(dir: string, fileName: string): Promise<string | null> {
  let entries: string[] = [];

  try {
    entries = await fs.readdir(dir);
  } catch {
    return null;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry);

    try {
      const stat = await fs.stat(fullPath);

      if (stat.isFile() && entry === fileName) {
        return fullPath;
      }

      if (stat.isDirectory()) {
        const found = await findFileRecursive(fullPath, fileName);

        if (found) {
          return found;
        }
      }
    } catch {
      // ignore
    }
  }

  return null;
}

async function findWikiImagePath(fileName: string, context: MarkdownProcessResult) {
  let currentDir = context.mdDir;
  const stopDir = context.workspaceRoot || path.parse(currentDir).root;

  while (true) {
    for (const dirName of IMAGE_DIR_NAMES) {
      const imageDir = path.join(currentDir, dirName);

      if (!(await isDirectory(imageDir))) continue;

      const directFilePath = path.join(imageDir, fileName);

      if (await exists(directFilePath)) {
        return directFilePath;
      }

      const recursiveFilePath = await findFileRecursive(imageDir, fileName);

      if (recursiveFilePath) {
        return recursiveFilePath;
      }
    }

    if (currentDir === stopDir) break;

    const parentDir = path.dirname(currentDir);

    if (parentDir === currentDir) break;

    currentDir = parentDir;
  }

  return null;
}

async function resolveLocalImagePath(src: string, context: MarkdownProcessResult) {
  const cleanSrc = src.replace(/\\/g, '/');

  if (!cleanSrc || WEB_URL_RE.test(cleanSrc)) {
    return null;
  }

  let decodedSrc = cleanSrc;

  try {
    decodedSrc = decodeURIComponent(cleanSrc);
  } catch {
    decodedSrc = cleanSrc;
  }

  if (decodedSrc.startsWith('file://')) {
    return vscode.Uri.parse(decodedSrc).fsPath;
  }

  if (path.isAbsolute(decodedSrc)) {
    if (await exists(decodedSrc)) {
      return decodedSrc;
    }

    if (context.workspaceRoot) {
      const workspacePath = path.join(context.workspaceRoot, decodedSrc.replace(/^[/\\]+/, ''));

      if (await exists(workspacePath)) {
        return workspacePath;
      }
    }

    return null;
  }

  const relativeToMd = path.resolve(context.mdDir, decodedSrc);

  if (await exists(relativeToMd)) {
    return relativeToMd;
  }

  if (context.workspaceRoot) {
    const relativeToWorkspace = path.resolve(context.workspaceRoot, decodedSrc);

    if (await exists(relativeToWorkspace)) {
      return relativeToWorkspace;
    }
  }

  return null;
}

async function toWebviewImageSrc(src: string, context: MarkdownProcessResult) {
  if (!context.webview) return src;

  const localPath = await resolveLocalImagePath(src, context);

  if (!localPath) return src;

  const webviewSrc = context.webview.asWebviewUri(vscode.Uri.file(localPath)).toString();

  context.assets[webviewSrc] = src;

  return webviewSrc;
}

async function replaceWikiImages(content: string, context: MarkdownProcessResult) {
  const imageReg = /!\[\[([^\]]+)\]\]/g;
  let result = '';
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = imageReg.exec(content)) !== null) {
    const [full, rawFileName] = match;
    const start = match.index;
    const end = start + full.length;
    const fileName = rawFileName.trim();

    result += content.slice(lastIndex, start);

    const filePath = await findWikiImagePath(fileName, context);

    if (filePath) {
      const webviewSrc = await toWebviewImageSrc(filePath, context);

      result += `![${fileName}](${webviewSrc})`;
    } else {
      result += full;
    }

    lastIndex = end;
  }

  result += content.slice(lastIndex);

  return result;
}

async function replaceMarkdownImages(content: string, context: MarkdownProcessResult) {
  const imageReg = /!\[([^\]]*)\]\(([^)\n]+)\)/g;
  let result = '';
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = imageReg.exec(content)) !== null) {
    const [full, alt, target] = match;
    const start = match.index;
    const end = start + full.length;

    result += content.slice(lastIndex, start);

    const { src, title } = splitMarkdownImageTarget(target);
    const webviewSrc = await toWebviewImageSrc(src, context);

    result += `![${alt}](${webviewSrc}${title ? ` ${title}` : ''})`;

    lastIndex = end;
  }

  result += content.slice(lastIndex);

  return result;
}

async function replaceHtmlImages(content: string, context: MarkdownProcessResult) {
  const imageReg = /<img\b([^>]*?)\bsrc=(["'])(.*?)\2([^>]*?)>/gi;
  let result = '';
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = imageReg.exec(content)) !== null) {
    const [full, before, quote, src, after] = match;
    const start = match.index;
    const end = start + full.length;

    result += content.slice(lastIndex, start);

    const webviewSrc = await toWebviewImageSrc(src, context);

    result += `<img${before}src=${quote}${webviewSrc}${quote}${after}>`;

    lastIndex = end;
  }

  result += content.slice(lastIndex);

  return result;
}

export function restoreMarkdownImagePaths(content: string, assets: Record<string, string>) {
  let result = content;

  Object.entries(assets).forEach(([webviewSrc, originalSrc]) => {
    result = result.split(webviewSrc).join(originalSrc);
  });

  return result;
}

export default async function markdownImagePlugin(context: MarkdownProcessResult) {
  context.content = await replaceWikiImages(context.content, context);
  context.content = await replaceMarkdownImages(context.content, context);
  context.content = await replaceHtmlImages(context.content, context);
}