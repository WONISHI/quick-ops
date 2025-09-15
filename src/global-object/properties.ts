import { TextDocument, window } from 'vscode';
import type { Properties } from '../types/Properties';
import type { FileType } from '../types/utils';
import mergeClone from '../utils/mergeClone';
// 全局对象，用于存储当前文件的相关属性
export const properties: Properties = {
  fullPath: '',
  filePath: '',
  fileName: '',
  fileType: undefined,
  content: '',
  configResult: false,
  pluginConfig: null,
  ignore: ['.logrc'],
};

// 设置当前文件配置
export const initProperties = (document: TextDocument) => {
  const filePath = document.uri.fsPath;
  const fullPath = document.uri.path;
  properties.fullPath = filePath;
  properties.filePath = fullPath;
  properties.fileName = fullPath.split('/').pop() || '';
  properties.fileType = fullPath.split('.').pop() as FileType;
  properties.content = document.getText();
};

// 合并配置项
export const MergeProperties = (property: any) => {
  Object.assign(properties, property);
  if (property.workspaceConfig && Reflect.ownKeys(property.workspaceConfig).length) {
    properties.settings = mergeClone(properties.pluginConfig!, properties.workspaceConfig!);
  }
};

export const channel = window.createOutputChannel('scope-search-console');
