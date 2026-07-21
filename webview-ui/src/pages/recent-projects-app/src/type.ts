import type { ContextMenuPayload } from '@/types/RecentProjectsApp';

export interface DiagnosticSummary {
  errors: number;
  warnings: number;
}

export interface MetadataPatchItem {
  path: string;
  status?: string;
  diagnostics?: DiagnosticSummary;
}

export interface PendingCreateEntity {
  parentPath: string;
  type: 'file' | 'folder';
  projectName: string;
  isActiveProject: boolean;
}

export interface PendingRenameEntity {
  path: string;
  name: string;
  isFolder: boolean;
  projectName: string;
  isActiveProject: boolean;
}

export interface DraggingEntity {
  path: string;
  name: string;
  isFolder: boolean;
  projectName: string;
}

export interface SearchReturnState {
  isFocusMode: boolean;
  isFocusLocked: boolean;
  focusRootPath: string;
  focusRootName: string;
  searchTargetProject: ContextMenuPayload | null;
}