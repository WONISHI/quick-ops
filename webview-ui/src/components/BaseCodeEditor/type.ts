import type { ComponentProps } from 'react';
import type CodeMirror from '@uiw/react-codemirror';

type ReactCodeMirrorProps = ComponentProps<typeof CodeMirror>;

export type BaseCodeEditorLanguage = 'json' | 'plaintext';

export type BaseCodeEditorSearchAlign = 'start' | 'center' | 'end' | 'nearest';

export interface BaseCodeEditorSearchRange {
  /**
   * @description 匹配内容起始位置
   */
  from: number;

  /**
   * @description 匹配内容结束位置
   */
  to: number;
}

export interface BaseCodeEditorSearchOptions {
  /**
   * @description 是否启用当前搜索条件
   *
   * @default true
   */
  open?: boolean;

  /**
   * @description 搜索关键词
   *
   * @default ''
   */
  query?: string;

  /**
   * @description 当前激活结果下标
   *
   * @default 0
   */
  activeIndex?: number;

  /**
   * @description 是否区分大小写
   *
   * @default false
   */
  caseSensitive?: boolean;

  /**
   * @description 是否按普通文本搜索
   *
   * 设为 false 时按照正则表达式搜索。
   *
   * @default true
   */
  literal?: boolean;

  /**
   * @description 搜索前是否移除关键词首尾空格
   *
   * @default true
   */
  trim?: boolean;

  /**
   * @description 是否选中当前匹配内容
   *
   * @default true
   */
  selectMatch?: boolean;

  /**
   * @description 当前匹配内容滚动位置
   *
   * @default 'center'
   */
  scrollAlign?: BaseCodeEditorSearchAlign;
}

export interface BaseCodeEditorProps extends Omit<
  ReactCodeMirrorProps,
  'value' | 'width' | 'height' | 'className' | 'theme' | 'extensions' | 'editable' | 'readOnly' | 'indentWithTab' | 'basicSetup' | 'onChange' | 'onCreateEditor'
> {
  /**
   * @description 编辑器内容
   *
   * @default ''
   */
  value?: string;

  /**
   * @description 内置语言模式
   *
   * 当前内置 JSON 和纯文本。
   * 其他语言可通过 extensions 传入。
   *
   * @default 'plaintext'
   */
  language?: BaseCodeEditorLanguage;

  /**
   * @description 是否允许编辑
   *
   * @default false
   */
  editable?: boolean;

  /**
   * @description 编辑器宽度
   *
   * @default '100%'
   */
  width?: string;

  /**
   * @description 编辑器高度
   *
   * @default '100%'
   */
  height?: string;

  /**
   * @description 编辑器容器类名
   */
  className?: string;

  /**
   * @description CodeMirror 主题
   *
   * 不传时自动使用 VS Code Webview 当前主题。
   */
  theme?: ReactCodeMirrorProps['theme'];

  /**
   * @description 自定义 CodeMirror 扩展
   *
   * 会追加到组件内置扩展之后。
   */
  extensions?: ReactCodeMirrorProps['extensions'];

  /**
   * @description 是否自动换行
   *
   * @default true
   */
  lineWrapping?: boolean;

  /**
   * @description Tab 键是否用于缩进
   *
   * 默认与 editable 保持一致。
   */
  indentWithTab?: boolean;

  /**
   * @description CodeMirror 基础配置
   *
   * 传入对象时会覆盖组件默认配置；
   * 传入 false 时关闭全部基础配置。
   */
  basicSetup?: ReactCodeMirrorProps['basicSetup'];

  /**
   * @description 外部搜索配置
   *
   * 不传时不加载搜索扩展。
   */
  search?: BaseCodeEditorSearchOptions;

  /**
   * @description 编辑器内容变化事件
   */
  onChange?: ReactCodeMirrorProps['onChange'];

  /**
   * @description 编辑器创建完成事件
   */
  onCreateEditor?: ReactCodeMirrorProps['onCreateEditor'];

  /**
   * @description 兼容旧版搜索框显示状态
   *
   * @deprecated 请使用 search.open
   */
  searchOpen?: boolean;

  /**
   * @description 兼容旧版搜索关键词
   *
   * @deprecated 请使用 search.query
   */
  searchQuery?: string;

  /**
   * @description 兼容旧版激活结果下标
   *
   * @deprecated 请使用 search.activeIndex
   */
  activeSearchIndex?: number;
}

/**
 * @deprecated 请使用 BaseCodeEditorLanguage
 */
export type ResponseEditorLanguage = BaseCodeEditorLanguage;

/**
 * @deprecated 请使用 BaseCodeEditorProps
 */
export type ResponseCodeMirrorEditorProps = BaseCodeEditorProps;

/**
 * @deprecated 请使用 BaseCodeEditorSearchRange
 */
export type ResponseSearchRange = BaseCodeEditorSearchRange;
