/**
 * 核心常量定义
 */

// 支持的文件类型
export const SUPPORTED_FILE_TYPES = ['vue', 'jsx', 'tsx', 'css', 'less', 'scss', 'html', 'js', 'ts'] as const;

export type SupportedFileType = (typeof SUPPORTED_FILE_TYPES)[number];

// 插件特定的标识符
export const EXTENSION_ID = 'quick-ops';

export const TOOLTIPS = {
  ADD_NOTE: '添加备注',
  UP: '上移',
  DOWN: '下移',
  DELETE: '删除',
  NEW_SUBGROUP: '由此创建新分组',
  VIEW_CHILDREN: '查看子级',
  INSERT_BEFORE: '在此项【之前】插入',
  INSERT_AFTER: '在此项【之后】插入',
  TRASH: '删除',
};
