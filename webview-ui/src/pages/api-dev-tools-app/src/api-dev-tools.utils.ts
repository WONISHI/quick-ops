/**
 * @description 格式化字节大小
 */
export function formatSize(size: number): string {
  if (!size) return '0 B';

  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * @description 将文本安全转换为 Base64
 */
export function safeBase64(value: string): string {
  try {
    return btoa(unescape(encodeURIComponent(value)));
  } catch {
    return btoa(value);
  }
}

/**
 * @description 将数值限制在指定的最小值和最大值之间
 */
export function clampNumber(value: number, min: number, max: number) {
  const safeMax = Math.max(min, max);
  return Math.min(Math.max(value, min), safeMax);
}


/**
 * @description 尝试格式化 JSON 文本
 */
export function tryFormatJson(text: string) {
  const value = String(text || '').trim();

  if (!value) return '';

  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return text;
  }
}

/**
 * @description 判断文本是否可能为 JSON
 */
export function isJsonLikeText(value: string): boolean {
  const firstCharacter = String(value || '')
    .trim()
    .charAt(0);

  return firstCharacter === '{' || firstCharacter === '[';
}

/**
 * @description 深拷贝接口请求配置
 */
export function cloneRequest<T>(request: T): T {
  return JSON.parse(JSON.stringify(request));
}