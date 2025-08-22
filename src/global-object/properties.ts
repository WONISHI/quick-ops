import { TextDocument, window } from 'vscode';
import type { Properties } from '../types/Properties';
import type { FileType } from '../types/utils';

// 全局对象，用于存储当前文件的相关属性
export const properties: Properties = {
  fullPath: '',
  fileName: '',
  fileType: undefined,
  content: '',
};

// 设置当前文件配置
export const initProperties = (document: TextDocument) => {
  const filePath = document.uri.fsPath;
  const fullPath = document.uri.path;
  properties.fullPath = filePath;
  properties.fileName = fullPath.split('/').pop() || '';
  properties.fileType = fullPath.split('.').pop() as FileType;
  properties.content = document.getText();
};

export const channel = window.createOutputChannel('scope-search-console');
