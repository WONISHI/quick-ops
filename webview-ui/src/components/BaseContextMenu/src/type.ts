import type { CSSProperties, ReactNode } from 'react';

export type BaseContextMenuTrigger = 'contextmenu' | 'click';

export type BaseContextMenuSubmenuPlacement = 'auto' | 'left' | 'right' | 'inline';

export type BaseContextMenuPopupPlacement = 'auto' | 'top' | 'bottom';

export interface BaseContextMenuPosition {
  x: number;
  y: number;
}

export interface BaseContextMenuOffsetPosition {
  left: number;
  top: number;
}

export interface BaseContextMenuActionItem {
  type?: 'item';
  key: string;
  label: ReactNode;
  icon?: ReactNode;
  shortcut?: ReactNode;
  disabled?: boolean;
  hidden?: boolean;
  danger?: boolean;
  title?: string;
  className?: string;
  style?: CSSProperties;

  /**
   * 子菜单，支持继续递归嵌套。
   */
  children?: BaseContextMenuItem[];

  /**
   * 叶子菜单点击事件。
   */
  onSelect?: () => void | Promise<void>;

  /**
   * 点击后是否关闭全部菜单，默认 true。
   */
  closeOnSelect?: boolean;
}

export interface BaseContextMenuSeparatorItem {
  type: 'separator';
  key: string;
  hidden?: boolean;
}

export type BaseContextMenuItem = BaseContextMenuActionItem | BaseContextMenuSeparatorItem;

export interface BaseContextMenuProps {
  /**
   * 菜单数据。
   */
  items: BaseContextMenuItem[];

  /**
   * 右键触发区域。
   *
   * 不传 children 时，组件作为受控浮层菜单使用。
   */
  children?: ReactNode;

  /**
   * 受控打开状态。
   */
  open?: boolean;

  /**
   * 兼容旧菜单的 visible 属性。
   * open 的优先级高于 visible。
   */
  visible?: boolean;

  /**
   * 受控菜单位置。
   *
   * 同时兼容：
   * - { x, y }
   * - { left, top }
   */
  position?: BaseContextMenuPosition | BaseContextMenuOffsetPosition;

  /**
   * 菜单触发方式。
   *
   * - contextmenu：默认，右键打开。
   * - click：将 children 作为目标，点击后显示菜单。
   */
  trigger?: BaseContextMenuTrigger;

  /**
   * 是否显示菜单浮层指向目标元素或 position 坐标的箭头。
   *
   * click 触发模式会自动指向触发元素的水平中点；
   * trigger !== 'click' 时，箭头固定显示在菜单水平中心；
   * 受控模式可以传 anchorEl，未传时使用 position 作为定位锚点。
   *
   * @default false
   */
  showArrow?: boolean;

  /**
   * 受控模式下用于定位和计算箭头的目标元素。
   *
   * click 触发模式会自动使用被点击的第一个子元素。
   */
  anchorEl?: HTMLElement | null;

  /**
   * 根菜单优先展示方向。
   *
   * @default auto
   */
  popupPlacement?: BaseContextMenuPopupPlacement;

  /**
   * 菜单与目标元素之间的间距。
   *
   * @default 8
   */
  popupOffset?: number;

  /**
   * 菜单与视口边缘之间的安全距离。
   *
   * @default 8
   */
  viewportPadding?: number;

  /**
   * 根菜单最大高度。
   *
   * 超过该高度时，菜单内容区域自动出现纵向滚动条。
   */
  maxHeight?: number;

  /**
   * 每一级菜单的最小宽度。
   */
  minWidth?: number;

  /**
   * 是否禁用右键触发。
   */
  disabled?: boolean;

  /**
   * 菜单密度。
   */
  density?: 'default' | 'compact';

  /**
   * 子菜单展开方式。
   *
   * - auto：根据视口空间自动向左或向右展开。
   * - left：优先向左展开。
   * - right：优先向右展开。
   * - inline：在当前菜单内部折叠展开。
   */
  submenuPlacement?: BaseContextMenuSubmenuPlacement;

  /**
   * 子菜单悬停打开延迟。
   */
  submenuOpenDelay?: number;

  /**
   * 直接指定 Portal 容器。
   *
   * 受控模式需要自定义容器时优先使用该属性。
   */
  popupContainer?: HTMLElement | null;

  /**
   * 非受控右键打开时动态获取 Portal 容器。
   */
  getPopupContainer?: () => HTMLElement;

  /**
   * 打开状态变化。
   */
  onOpenChange?: (open: boolean) => void;

  /**
   * 菜单主动关闭时触发。
   */
  onClose?: () => void;

  /**
   * 根菜单类名。
   */
  menuClassName?: string;

  /**
   * 根菜单样式。
   */
  menuStyle?: CSSProperties;
}

export interface MenuPosition {
  left: number;
  top: number;
}

export interface MenuLevelProps {
  items: BaseContextMenuItem[];
  level: number;
  position: MenuPosition;
  minWidth: number;
  density: 'default' | 'compact';
  submenuPlacement: BaseContextMenuSubmenuPlacement;
  submenuOpenDelay: number;
  inline?: boolean;

  /**
   * 仅根菜单使用的弹出箭头配置。
   */
  showArrow?: boolean;

  /**
   * @description 是否强制将箭头放在菜单水平中心
   *
   * click 模式保持指向触发元素；
   * contextmenu / 受控位置模式使用水平居中。
   */
  centerArrow?: boolean;

  anchorEl?: HTMLElement | null;
  anchorPoint?: BaseContextMenuPosition | null;
  popupPlacement?: BaseContextMenuPopupPlacement;
  popupOffset?: number;
  viewportPadding?: number;
  maxHeight?: number;

  menuClassName?: string;
  menuStyle?: CSSProperties;
  onCloseAll: () => void;
  onCloseLevel?: () => void;
  onSelectItem: (item: BaseContextMenuActionItem) => Promise<void>;
}