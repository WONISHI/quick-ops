import { isObject } from '@/utils/is';
export type PlainObject = Record<string, any>;

/**
 * 深合并 source 到 target 上（就地修改 target）
 * 数组会拼接而不是覆盖
 */
export default function mergeClone<T extends PlainObject, U extends PlainObject>(target: T, source: U): T & U {
  // 先克隆一份 target，避免修改原始对象
  const result: PlainObject = Array.isArray(target) ? [...target] : { ...target };

  for (const key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      const sourceValue = source[key];
      const targetValue = result[key];

      if (Array.isArray(sourceValue)) {
        result[key] = Array.isArray(targetValue) ? (targetValue as any[]).concat(sourceValue) : [...sourceValue];
      } else if (isObject(sourceValue)) {
        result[key] = isObject(targetValue) ? mergeClone(targetValue, sourceValue) : mergeClone({}, sourceValue);
      } else {
        result[key] = sourceValue;
      }
    }
  }

  return result as T & U;
}
