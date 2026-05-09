export interface ParsedFileUriInfo {
  raw: string;
  fullPath: string;
  projectName: string;
  fileName: string;
  fileNameWithExt: string;
  ext: string;
  dirPath: string;
}

export interface ParseFileUriOptions {
  projectMarker?: string;
  fallbackProjectName?: string;
}

export const safeDecode = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

export const normalizeFsPath = (value: string): string => {
  let pathValue = value.trim();

  if (pathValue.startsWith('file://')) {
    try {
      const url = new URL(pathValue);
      pathValue = safeDecode(url.pathname);
    } catch {
      pathValue = safeDecode(pathValue.replace(/^file:\/\//, ''));
    }
  } else {
    pathValue = safeDecode(pathValue);
  }

  // Windows: /C:/Users/xxx => C:/Users/xxx
  if (/^\/[a-zA-Z]:\//.test(pathValue)) {
    pathValue = pathValue.slice(1);
  }

  return pathValue.replace(/\\/g, '/');
};

export const getFileNameParts = (fileNameWithExt: string) => {
  const lastDotIndex = fileNameWithExt.lastIndexOf('.');

  if (lastDotIndex <= 0) {
    return {
      fileName: fileNameWithExt,
      ext: '',
    };
  }

  return {
    fileName: fileNameWithExt.slice(0, lastDotIndex),
    ext: fileNameWithExt.slice(lastDotIndex),
  };
};

export const parseFileUriInfo = (fileUri: string, options?: ParseFileUriOptions): ParsedFileUriInfo => {
  const fullPath = normalizeFsPath(fileUri);
  const parts = fullPath.split('/').filter(Boolean);

  const fileNameWithExt = parts[parts.length - 1] || '';
  const { fileName, ext } = getFileNameParts(fileNameWithExt);

  const dirParts = parts.slice(0, -1);
  const dirPath = fullPath.slice(0, fullPath.length - fileNameWithExt.length).replace(/\/$/, '');

  let projectName = options?.fallbackProjectName || '';

  const projectMarker = options?.projectMarker || 'Desktop';
  const markerIndex = parts.indexOf(projectMarker);

  if (!projectName && markerIndex !== -1 && parts[markerIndex + 1]) {
    projectName = parts[markerIndex + 1];
  }

  if (!projectName) {
    projectName = dirParts[dirParts.length - 1] || '';
  }

  return {
    raw: fileUri,
    fullPath,
    projectName,
    fileName,
    fileNameWithExt,
    ext,
    dirPath,
  };
};