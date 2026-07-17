import type {
  ButtonHTMLAttributes,
  ReactNode,
} from 'react';

/**
 * @description 按钮视觉类型
 */
export type BaseButtonType =
  | 'default'
  | 'primary'
  | 'danger'
  | 'text'
  | 'icon';

/**
 * @description 按钮尺寸
 */
export type BaseButtonSize =
  | 'small'
  | 'medium'
  | 'large';

/**
 * @description 图标位置
 */
export type BaseButtonIconPosition =
  | 'left'
  | 'right';

export interface BaseButtonProps
  extends Omit<
    ButtonHTMLAttributes<HTMLButtonElement>,
    'type' | 'children'
  > {
  /**
   * @description 按钮视觉类型
   *
   * - default：普通按钮
   * - primary：主要按钮
   * - danger：危险操作按钮
   * - text：文字按钮
   * - icon：纯图标按钮
   *
   * @default 'default'
   */
  type?: BaseButtonType;

  /**
   * @description 原生 button type
   *
   * @default 'button'
   */
  htmlType?: ButtonHTMLAttributes<HTMLButtonElement>['type'];

  /**
   * @description 按钮尺寸
   *
   * @default 'medium'
   */
  size?: BaseButtonSize;

  /**
   * @description 图标插槽
   *
   * @example
   * icon={
   *   <i className="codicon codicon-add" />
   * }
   */
  icon?: ReactNode;

  /**
   * @description 图标位置
   *
   * @default 'left'
   */
  iconPosition?: BaseButtonIconPosition;

  /**
   * @description 按钮内容
   */
  children?: ReactNode;

  /**
   * @description 是否处于加载状态
   *
   * 加载时会自动禁用按钮。
   *
   * @default false
   */
  loading?: boolean;

  /**
   * @description 自定义加载图标
   */
  loadingIcon?: ReactNode;

  /**
   * @description 是否占满父容器宽度
   *
   * @default false
   */
  block?: boolean;

  /**
   * @description 是否使用圆形外观
   *
   * @default false
   */
  circle?: boolean;
}