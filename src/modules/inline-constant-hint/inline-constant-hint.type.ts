export interface InlineConstantHintEntry {
  /**
   * 匹配文本：
   * - 常量：STATUS_SUCCESS
   * - 枚举/对象成员：Status.Success / STATUS_MAP.SUCCESS
   */
  name: string;

  /**
   * 展示值：
   * - "success"
   * - 1
   * - true
   */
  value: string;

  /**
   * 来源类型
   */
  kind: 'const' | 'enum' | 'object';

  /**
   * 声明所在行，避免在声明行重复提示
   */
  declarationLine: number;
}

export interface DocumentCache {
  version: number;
  entries: InlineConstantHintEntry[];
}