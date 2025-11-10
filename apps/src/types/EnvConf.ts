import type { OptionType } from 'dayjs';
import * as vscode from 'vscode';
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
export type LogEnhancerConfig = RandomizedPlaceholders | `${RandomizedPlaceholders}-${CustomSegment}` | `${RandomizedPlaceholders}-${CustomSegment}-${CustomSegment}`;

type ConsoleKeys = keyof Console;

export type MarkOption = Record<string, vscode.TextEditorDecorationType>;
export type MarkProp = Record<string, vscode.DecorationRenderOptions>;

export interface EnvConf {
  logEnhancerConfig: Record<ConsoleKeys, LogEnhancerConfig>;
  unitTime: Record<ConsoleKeys, OptionType>;
  uuidLen: Record<ConsoleKeys, number>;
  useAsyncMock: boolean; // 是否使用异步模拟数据
  mockServerCount: number; // 最大模拟数据服务数量
  port: number; // 模拟数据服务端口
  DEV: boolean; // 是否开启功能开发模式
  alias: Record<string, Record<string, string>>; // 别名配置
  excludedConfigFiles: boolean; // 是否忽略配置文件
  customSnippets: Record<string, any>[]; // 自定义代码片段
  git: string[]; //临时忽略文件
  mark: MarkProp;
  [key: string]: any; // 允许其他任意配置项
}

export type EnvConfProps = [Partial<EnvConf> | null, Partial<EnvConf> | null];
