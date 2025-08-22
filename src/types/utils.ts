export const fileTypes = ['vue', 'jsx', 'tsx', 'css', 'less', 'scss', 'html', 'js', 'ts'] as const;

export type FileType = (typeof fileTypes)[number];

export interface FileEntry {}
