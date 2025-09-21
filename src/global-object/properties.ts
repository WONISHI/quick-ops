import * as vscode from 'vscode';
import type { Properties, IgnoredStatus } from '../types/Properties';
import type { FileType } from '../types/utils';
import type { EnvConf } from '../types/EnvConf';
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
  identifiers: ['success', 'warning', 'error', 'head'],
  completionDocumentSelector: ['javascript', 'javascriptreact', 'typescript', 'typescriptreact', 'vue'],
  configFileSchema: ['.prettierrc', '.gitignore', 'package.json', '.logrc', '.markdownlint.json', 'eslint.config.mjs', 'tsconfig.json'],
};

/**
 * 比较两个 string[]，返回新增和删除项
 */
function computeArrayDiff(previous?: string[], current?: string[]): IgnoredStatus {
  const previousSet = new Set(previous || []);
  const currentSet = new Set(current || []);
  const added = Array.from(currentSet).filter((item) => !previousSet.has(item));
  const remove = Array.from(previousSet).filter((item) => !currentSet.has(item));
  return { added, remove };
}

/**
 * 获取 workspaceConfig.git 的变更
 */
export function computeGitChanges(previousConfig?: Partial<EnvConf>, currentConfig?: Partial<EnvConf>): IgnoredStatus {
  return computeArrayDiff(previousConfig?.git, currentConfig?.git);
}

// 合并配置项
export const MergeProperties = (property: Partial<Properties>) => {
  Object.assign(properties, property);
  // 合并插件配置文件和工作区域的配置文件
  if (property.workspaceConfig && Reflect.ownKeys(property.workspaceConfig).length) {
    Object.assign(properties, {
      settings: mergeClone(properties.pluginConfig!, properties.workspaceConfig!),
    });
  }
  // 创建了webveiw则需要给给webview通信
  if (properties.panel) {
    console.log('property.panel',property.panel)
    properties.panel.webview.postMessage({ type: property.panel ? 'ready' : 'update', data: properties });
  }
};

// 设置当前文件配置
export const initProperties = (document: vscode.TextDocument) => {
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
