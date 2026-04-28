export interface Project {
  fsPath: string;
  name: string;
  customName?: string;
  customDomain?: string;
  platform?: string;
  branch?: string;
  timestamp: number;
}

export interface DirChild {
  path: string;
  name: string;
  isFolder: boolean;
}

export interface SearchMatch {
  line: number;
  text: string;
}

export interface SearchResult {
  file: string;
  fullPath: string;
  matches: SearchMatch[];
}

export interface ContextMenuPayload {
  path: string;
  name?: string;
  originalName?: string;
  customName?: string;
  isRemote?: boolean;
  platform?: string;
  customDomain?: string;
  isActiveProject?: boolean;
  isFolder?: boolean;
  projectName?: string;
}