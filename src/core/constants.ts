/**
 * 核心常量定义
 */

// 支持的文件类型
export const SUPPORTED_FILE_TYPES = ['vue', 'jsx', 'tsx', 'css', 'less', 'scss', 'html', 'js', 'ts'] as const;

export type SupportedFileType = (typeof SUPPORTED_FILE_TYPES)[number];

// HTTP 状态码
export const HTTP_STATUS_CODES = [100, 101, 200, 201, 204, 301, 302, 304, 400, 401, 403, 404, 500, 502, 503] as const;

// 请求方法
export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'ALL'] as const;

// 插件特定的标识符
export const EXTENSION_ID = 'quick-ops';
