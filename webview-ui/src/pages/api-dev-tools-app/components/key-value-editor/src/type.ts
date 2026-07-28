import type { KeyValueItem } from '@/pages/api-dev-tools-app/src/type';

export type KeyValueItemValueType = 'text' | 'file';

export type KeyValueEditorItem = KeyValueItem & {
  /**
   * @description 当前值类型
   */
  valueType?: KeyValueItemValueType;

  /**
   * @description 文件名称
   */
  fileName?: string;

  /**
   * @description 文件 MIME 类型
   */
  fileMimeType?: string;

  /**
   * @description 文件 Base64 内容
   */
  fileData?: string;
};

export interface KeyValueEditorProps {
  /**
   * @description 键值配置列表
   */
  items: KeyValueEditorItem[];

  /**
   * @description 键值配置列表变化事件
   */
  onChange: (items: KeyValueEditorItem[]) => void;

  /**
   * @description Key 输入框占位文本
   *
   * @default '名称'
   */
  keyPlaceholder?: string;

  /**
   * @description Value 输入框占位文本
   *
   * @default '值'
   */
  valuePlaceholder?: string;

  /**
   * @description 是否展示 Text / File 类型列
   *
   * @default false
   */
  showType?: boolean;
}