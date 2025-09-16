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
  supportsLessSyntax: false,
  supportsScssSyntax: false,
  isGitTracked: true,
  ignore: ['.logrc'],
  server: [],
  completionDocumentSelector: ['javascript', 'javascriptreact', 'typescript', 'typescriptreact', 'vue'],
  configFileSchema: ['.prettierrc', '.gitignore', 'package.json', '.logrc', '.markdownlint.json', 'eslint.config.mjs', 'tsconfig.json'],
};

// 合并配置项
export const MergeProperties = (property: any) => {
  Object.assign(properties, property);
  if (property.workspaceConfig && Reflect.ownKeys(property.workspaceConfig).length) {
    Object.assign({
      settings: mergeClone(properties.pluginConfig!, properties.workspaceConfig!),
    });
  }
};

// 设置当前文件配置
export const initProperties = (document: TextDocument) => {
  // 没有任何文件打开就跳过
  if (!document) return;
  const filePath = document.uri.fsPath;
  const fullPath = document.uri.path;
  const fileType = fullPath.split('.').pop() as FileType;
  MergeProperties({
    fullPath: filePath,
    filePath: fullPath,
    fileName: fullPath.split('/').pop() || '',
    fileType: fileType,
    supportsLessSyntax: fileType.toLocaleLowerCase() === 'less',
    supportsScssSyntax: fileType.toLocaleLowerCase() === 'scss',
    content: document.getText(),
  });
};
