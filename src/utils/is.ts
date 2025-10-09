/**
 * 通用类型判断工具函数
 */

export const isString = (val: unknown): val is string => typeof val === 'string';

export const isNumber = (val: unknown): val is number => typeof val === 'number' && !Number.isNaN(val);

export const isBoolean = (val: unknown): val is boolean => typeof val === 'boolean';

export const isFunction = <T extends Function>(val: unknown): val is T => typeof val === 'function';

export const isArray = Array.isArray;

export const isDate = (val: unknown): val is Date => Object.prototype.toString.call(val) === '[object Date]';

export const isRegExp = (val: unknown): val is RegExp => Object.prototype.toString.call(val) === '[object RegExp]';

export const isObject = (val: unknown): val is Record<string, any> => Object.prototype.toString.call(val) === '[object Object]';

export const isNull = (val: unknown): val is null => val === null;

export const isUndefined = (val: unknown): val is undefined => typeof val === 'undefined';

export const isNil = (val: unknown): val is null | undefined => val === null || val === undefined;

export const isPromise = <T = any>(val: unknown): val is Promise<T> =>
  !!val && (typeof val === 'object' || typeof val === 'function') && typeof (val as any).then === 'function' && typeof (val as any).catch === 'function';

export const isMap = (val: unknown): val is Map<any, any> => Object.prototype.toString.call(val) === '[object Map]';

export const isSet = (val: unknown): val is Set<any> => Object.prototype.toString.call(val) === '[object Set]';

export const isWeakMap = (val: unknown): val is WeakMap<object, any> => Object.prototype.toString.call(val) === '[object WeakMap]';

export const isWeakSet = (val: unknown): val is WeakSet<object> => Object.prototype.toString.call(val) === '[object WeakSet]';

export const isSymbol = (val: unknown): val is symbol => typeof val === 'symbol';

export const isBigInt = (val: unknown): val is bigint => typeof val === 'bigint';

export const isChineseChar = (val: string) => /^[\u4e00-\u9fa5]$/.test(val);
