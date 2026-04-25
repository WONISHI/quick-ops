export interface GitFile {
  status: string;
  file: string;
}

export interface TreeNode {
  name: string;
  fullPath: string;
  isDirectory: boolean;
  children: TreeNode[];
  file?: GitFile;
}