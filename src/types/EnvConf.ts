type Placeholder = '[time]' | '[line]' | '[uuid]';

// 工具类型：数组转联合
type ArrayToUnion<T extends any[]> = T[number];

// 生成占位符数组的所有排列（最大深度固定为3，避免递归过深）
type Perm3<T extends string> =
  | `${T}-${Exclude<T, T>}-${Exclude<T, T | Exclude<T, T>>}`
  | `${T}-${Exclude<T, T | Exclude<T, T>>}-${Exclude<T, T>}`
  | `${Exclude<T, T>}-${T}-${Exclude<T, T | Exclude<T, T>>}`
  | `${Exclude<T, T>}-${Exclude<T, T | Exclude<T, T>>}-${T}`
  | `${Exclude<T, T | Exclude<T, T>>}-${T}-${Exclude<T, T>}`
  | `${Exclude<T, T | Exclude<T, T>>}-${Exclude<T, T>}-${T}`;

// 随机占位符排列
type RandomizedPlaceholders = Perm3<Placeholder>;

// 可选扩展
type CustomSegment = `[${string}]`;

// 最终类型
type LogEnhancerConfig =
  | RandomizedPlaceholders
  | `${RandomizedPlaceholders}-${CustomSegment}`
  | `${RandomizedPlaceholders}-${CustomSegment}-${CustomSegment}`;


export interface EnvConf {
  logEnhancerConfig: LogEnhancerConfig;
  [key: string]: any; // 允许其他任意配置项
}
