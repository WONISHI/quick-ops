import type { FileType } from './utils';

export interface Properties {
  fullPath: string;
  fileName: string;
  fileType: FileType | undefined;
  content: any;
}
