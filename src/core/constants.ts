/**
 * 核心常量定义
 */

// 支持的文件类型
export const SUPPORTED_FILE_TYPES = ['vue', 'jsx', 'tsx', 'css', 'less', 'scss', 'html', 'js', 'ts'] as const;

export type SupportedFileType = (typeof SUPPORTED_FILE_TYPES)[number];

// 插件特定的标识符
export const EXTENSION_ID = 'quick-ops';
