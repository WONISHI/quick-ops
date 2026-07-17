export type ResponseEditorLanguage =
  | 'json'
  | 'plaintext';

export interface ResponseCodeMirrorEditorProps {
  /**
   * @description 编辑器显示内容
   */
  value: string;

  /**
   * @description 编辑器语言
   */
  language: ResponseEditorLanguage;

  /**
   * @description 是否允许编辑
   *
   * @default false
   */
  editable?: boolean;

  /**
   * @description 编辑器内容变化事件
   */
  onChange?: (value: string) => void;

  /**
   * @description 悬浮搜索框是否打开
   *
   * @default false
   */
  searchOpen?: boolean;

  /**
   * @description 当前搜索关键词
   *
   * @default ''
   */
  searchQuery?: string;

  /**
   * @description 当前激活搜索结果下标
   *
   * @default 0
   */
  activeSearchIndex?: number;
}

export interface ResponseSearchRange {
  from: number;
  to: number;
}