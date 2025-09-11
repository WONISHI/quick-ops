import { isObject } from '@/utils/is';
export type PlainObject = Record<string, any>;

/**
 * 深合并 source 到 target 上（就地修改 target）
 * 数组会拼接而不是覆盖
 */
export default function mergeClone<T extends PlainObject, U extends PlainObject>(target: T, source: U): T & U {
  for (const key in source) {
    if (source.hasOwnProperty(key)) {
      const sourceValue = source[key];
      const targetValue = target[key];

      if (Array.isArray(sourceValue)) {
        if (Array.isArray(targetValue)) {
          // 使用类型断言，告诉 TS 我们保证拼接类型安全
          (target[key] as any) = (targetValue as any[]).concat(sourceValue as any[]);
        } else {
          (target[key] as any) = [...sourceValue];
        }
      } else if (isObject(sourceValue)) {
        if (!isObject(targetValue)) {
          (target[key] as any) = {};
        }
        mergeClone(target[key] as any, sourceValue);
      } else {
        (target[key] as any) = sourceValue;
      }
    }
  }
  return target as T & U;
}
