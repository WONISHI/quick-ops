import * as vscode from 'vscode';
import * as path from 'path';
import type { MarkdownProcessResult } from './setupMarkdown';

const WEB_URL_RE = /^(https?:\/\/|data:|blob:|vscode-webview-resource:|vscode-resource:|mailto:|#)/i;
const IMAGE_DIR_NAMES = ['img', 'images', 'assets'];
const imageDirCache = new Map<string, Map<string, string>>();
const statCache = new Map<string, boolean>();

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

function escapeHtmlAttr(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
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

function splitWikiImageTarget(value: string) {
  const parts = value
    .replace(/｜/g, '|')
    .split('|')
    .map((item) => item.trim())
    .filter(Boolean);

  return {
    fileName: parts[0] || '',
    width: parts[1] || '',
  };
}

function normalizeImagePath(value: string) {
  let result = value.trim().replace(/\\/g, '/');

  try {
    result = decodeURIComponent(result);
  } catch {
    // ignore
  }

  return result;
}

async function exists(filePath: string) {
  if (statCache.has(filePath)) {
    return statCache.get(filePath)!;
  }

  try {
    await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
    statCache.set(filePath, true);
    return true;
  } catch {
    statCache.set(filePath, false);
    return false;
  }
}

async function isDirectory(filePath: string) {
  try {
    const stat = await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
    return (stat.type & vscode.FileType.Directory) !== 0;
  } catch {
    return false;
  }
}

function hasPathSegment(src: string) {
  return src.includes('/') || src.includes('\\');
}

async function resolveSecondLevelImagePath(src: string, context: MarkdownProcessResult) {
  const cleanSrc = normalizeImagePath(src);

  if (!cleanSrc || WEB_URL_RE.test(cleanSrc)) {
    return null;
  }

  if (!hasPathSegment(cleanSrc)) {
    return null;
  }

  if (cleanSrc.startsWith('file://')) {
    return vscode.Uri.parse(cleanSrc).fsPath;
  }

  if (path.isAbsolute(cleanSrc)) {
    if (await exists(cleanSrc)) {
      return cleanSrc;
    }

    return null;
  }

  const relativeToMd = path.resolve(context.mdDir, cleanSrc);

  if (await exists(relativeToMd)) {
    return relativeToMd;
  }

  if (context.workspaceRoot) {
    const relativeToWorkspace = path.resolve(context.workspaceRoot, cleanSrc);

    if (await exists(relativeToWorkspace)) {
      return relativeToWorkspace;
    }
  }

  const parts = cleanSrc.split('/').filter(Boolean);
  const firstDirName = parts[0];
  const fileName = parts[parts.length - 1];

  if (!IMAGE_DIR_NAMES.includes(firstDirName)) {
    return null;
  }

  let currentDir = context.mdDir;
  const stopDir = context.workspaceRoot || path.parse(currentDir).root;

  while (true) {
    const imageDir = path.join(currentDir, firstDirName);

    if (await isDirectory(imageDir)) {
      const directFilePath = path.join(imageDir, fileName);

      if (await exists(directFilePath)) {
        return directFilePath;
      }
    }

    if (currentDir === stopDir) break;

    const parentDir = path.dirname(currentDir);

    if (parentDir === currentDir) break;

    currentDir = parentDir;
  }

  return null;
}

async function buildImageFileMap(dir: string) {
  if (imageDirCache.has(dir)) {
    return imageDirCache.get(dir)!;
  }

  const fileMap = new Map<string, string>();

  const walk = async (currentDir: string) => {
    let entries: [string, vscode.FileType][] = [];

    try {
      entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(currentDir));
    } catch {
      return;
    }

    await Promise.all(
      entries.map(async ([entry, type]) => {
        const fullPath = path.join(currentDir, entry);

        if ((type & vscode.FileType.File) !== 0) {
          if (!fileMap.has(entry)) {
            fileMap.set(entry, fullPath);
          }

          const lowerEntry = entry.toLowerCase();

          if (!fileMap.has(lowerEntry)) {
            fileMap.set(lowerEntry, fullPath);
          }
        }

        if ((type & vscode.FileType.Directory) !== 0) {
          await walk(fullPath);
        }
      }),
    );
  };

  await walk(dir);

  imageDirCache.set(dir, fileMap);

  return fileMap;
}

async function findImagePathByFileName(fileName: string, context: MarkdownProcessResult) {
  const fastPath = await resolveSecondLevelImagePath(fileName, context);

  if (fastPath) {
    return fastPath;
  }

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
    }

    if (currentDir === stopDir) break;

    const parentDir = path.dirname(currentDir);

    if (parentDir === currentDir) break;

    currentDir = parentDir;
  }

  currentDir = context.mdDir;

  while (true) {
    for (const dirName of IMAGE_DIR_NAMES) {
      const imageDir = path.join(currentDir, dirName);

      if (!(await isDirectory(imageDir))) continue;

      const fileMap = await buildImageFileMap(imageDir);
      const foundFilePath = fileMap.get(fileName) || fileMap.get(fileName.toLowerCase());

      if (foundFilePath) {
        return foundFilePath;
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
  const cleanSrc = normalizeImagePath(src);

  if (!cleanSrc || WEB_URL_RE.test(cleanSrc)) {
    return null;
  }

  const fastPath = await resolveSecondLevelImagePath(cleanSrc, context);

  if (fastPath) {
    return fastPath;
  }

  if (cleanSrc.startsWith('file://')) {
    return vscode.Uri.parse(cleanSrc).fsPath;
  }

  if (path.isAbsolute(cleanSrc)) {
    if (await exists(cleanSrc)) {
      return cleanSrc;
    }

    if (context.workspaceRoot) {
      const workspacePath = path.join(context.workspaceRoot, cleanSrc.replace(/^[/\\]+/, ''));

      if (await exists(workspacePath)) {
        return workspacePath;
      }
    }

    return null;
  }

  const relativeToMd = path.resolve(context.mdDir, cleanSrc);

  if (await exists(relativeToMd)) {
    return relativeToMd;
  }

  if (context.workspaceRoot) {
    const relativeToWorkspace = path.resolve(context.workspaceRoot, cleanSrc);

    if (await exists(relativeToWorkspace)) {
      return relativeToWorkspace;
    }
  }

  return findImagePathByFileName(path.basename(cleanSrc), context);
}

async function toWebviewImageSrc(src: string, context: MarkdownProcessResult) {
  if (!context.webview) return src;

  const localPath = path.isAbsolute(src) ? src : await resolveLocalImagePath(src, context);

  if (!localPath) return src;

  const webviewSrc = context.webview.asWebviewUri(vscode.Uri.file(localPath)).toString();

  context.assets[webviewSrc] = src;

  return webviewSrc;
}

async function replaceWikiImages(content: string, context: MarkdownProcessResult) {
  const imageReg = /!\[\[([^\]]+)\]\]/g;
  const matches = Array.from(content.matchAll(imageReg));

  if (matches.length === 0) return content;

  const replacements = await Promise.all(
    matches.map(async (match) => {
      const [full, rawTarget] = match;
      const { fileName, width } = splitWikiImageTarget(rawTarget);
      const filePath = await findImagePathByFileName(fileName, context);

      if (!filePath) {
        return {
          full,
          replacement: full,
        };
      }

      const webviewSrc = await toWebviewImageSrc(filePath, context);

      if (width) {
        return {
          full,
          replacement: `<img src="${escapeHtmlAttr(webviewSrc)}" width="${escapeHtmlAttr(width)}" />`,
        };
      }

      return {
        full,
        replacement: `![${fileName}](${webviewSrc})`,
      };
    }),
  );

  let result = content;

  replacements.forEach(({ full, replacement }) => {
    result = result.split(full).join(replacement);
  });

  return result;
}

async function replaceMarkdownImages(content: string, context: MarkdownProcessResult) {
  const imageReg = /!\[([^\]]*)\]\(([^)\n]+)\)/g;
  const matches = Array.from(content.matchAll(imageReg));

  if (matches.length === 0) return content;

  const replacements = await Promise.all(
    matches.map(async (match) => {
      const [full, alt, target] = match;
      const { src, title } = splitMarkdownImageTarget(target);
      const webviewSrc = await toWebviewImageSrc(src, context);

      return {
        full,
        replacement: `![${alt}](${webviewSrc}${title ? ` ${title}` : ''})`,
      };
    }),
  );

  let result = content;

  replacements.forEach(({ full, replacement }) => {
    result = result.split(full).join(replacement);
  });

  return result;
}

async function replaceHtmlImages(content: string, context: MarkdownProcessResult) {
  const imageReg = /<img\b([^>]*?)\bsrc=(["'])(.*?)\2([^>]*?)>/gi;
  const matches = Array.from(content.matchAll(imageReg));

  if (matches.length === 0) return content;

  const replacements = await Promise.all(
    matches.map(async (match) => {
      const [full, before, quote, src, after] = match;
      const webviewSrc = await toWebviewImageSrc(src, context);

      return {
        full,
        replacement: `<img${before}src=${quote}${webviewSrc}${quote}${after}>`,
      };
    }),
  );

  let result = content;

  replacements.forEach(({ full, replacement }) => {
    result = result.split(full).join(replacement);
  });

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