import { TextDocument, window } from 'vscode';
import type { Properties } from '../types/Properties';

// 全局对象，用于存储当前文件的相关属性
export const properties: Properties = {
  fullPath: '',
  fileName: '',
  fileType: '',
  content: '',
};

// 设置当前文件配置
export const initProperties = (document: TextDocument) => {
  const fullPath = document.uri.path;
  properties.fullPath = fullPath;
  properties.fileName = fullPath.split('/').pop() || '';
  properties.fileType = fullPath.split('.').pop() || '';
  properties.content = document.getText();
};

export const channel = window.createOutputChannel('scope-search-console');
