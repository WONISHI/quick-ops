export interface ProjectLike {
  fsPath: string;
  customDomain?: string;
}

export function getDisplayPath(project: ProjectLike) {
  let displayPath = project.fsPath;

  try {
    const isFile = !project.fsPath.startsWith('vscode-vfs') && !project.fsPath.startsWith('http');

    if (isFile) {
      let cleanPath = decodeURIComponent(project.fsPath);

      cleanPath = cleanPath.replace(/^file:\/\//i, '');
      cleanPath = cleanPath.replace(/^\/?[a-zA-Z]:[\\/]/i, '/');

      displayPath = cleanPath;
    } else if (project.customDomain) {
      const pathPart = project.fsPath.split('/').slice(3).join('/');
      displayPath = `Self-Hosted: ${project.customDomain}/${pathPart}`;
    } else {
      displayPath = project.fsPath
        .replace('vscode-vfs://github/', 'GitHub: ')
        .replace('vscode-vfs://gitlab/', 'GitLab: ');
    }
  } catch (e) {
    console.log('e', e);
  }

  return displayPath;
}