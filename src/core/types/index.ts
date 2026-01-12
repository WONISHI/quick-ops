export * from './config';

// 基础文件条目接口
export interface IFileEntry {
  name: string;
  fullPath: string;
  isDirectory: boolean;
}

// 导出信息接口
export interface IExportInfo {
  named: string[];
  default?: string;
}
