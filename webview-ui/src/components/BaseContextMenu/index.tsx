import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import styles from './index.module.css';
import { useDismissOnOutsideInteraction } from '@/hooks/use-dismiss-on-outside-interaction';

export type BaseContextMenuTrigger = 'contextmenu' | 'click';

export type BaseContextMenuSubmenuPlacement = 'auto' | 'left' | 'right' | 'inline';

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
   * 是否显示菜单浮层指向触发目标的箭头。
   *
   * 仅在 trigger="click" 时生效。
   *
   * @default false
   */
  showArrow?: boolean;

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

interface MenuPosition {
  left: number;
  top: number;
}

interface PopupArrowState {
  /**
   * top 表示箭头显示在菜单顶部，指向上方目标；
   * bottom 表示箭头显示在菜单底部，指向下方目标。
   */
  placement: 'top' | 'bottom';

  /**
   * 触发目标中心点在视口中的横坐标。
   */
  anchorX: number;
}

interface ClickTriggerPositionResult {
  position: MenuPosition;
  popupArrow: PopupArrowState;
}

interface MenuLevelProps {
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
  popupArrow?: PopupArrowState | null;

  menuClassName?: string;
  menuStyle?: CSSProperties;
  onCloseAll: () => void;
  onCloseLevel?: () => void;
  onSelectItem: (item: BaseContextMenuActionItem) => Promise<void>;
}

const VIEWPORT_GAP = 8;
const SUBMENU_GAP = 4;
const DEFAULT_ITEM_HEIGHT = 30;
const COMPACT_ITEM_HEIGHT = 28;
const SEPARATOR_HEIGHT = 11;
const MENU_VERTICAL_PADDING = 10;
const DEFAULT_SUBMENU_OPEN_DELAY = 90;

/**
 * @description 过滤隐藏菜单项。
 */
function getVisibleItems(items: BaseContextMenuItem[]): BaseContextMenuItem[] {
  return items.filter((item) => !item.hidden);
}

/**
 * @description 判断菜单项是否存在可见子菜单。
 */
function hasVisibleChildren(item: BaseContextMenuActionItem): boolean {
  return Boolean(item.children && getVisibleItems(item.children).length > 0);
}

/**
 * @description 获取菜单项高度。
 */
function getItemHeight(density: 'default' | 'compact'): number {
  return density === 'compact' ? COMPACT_ITEM_HEIGHT : DEFAULT_ITEM_HEIGHT;
}

/**
 * @description 估算菜单高度。
 */
function getEstimatedMenuHeight(items: BaseContextMenuItem[], density: 'default' | 'compact'): number {
  const itemHeight = getItemHeight(density);

  return (
    items.reduce((height, item) => {
      return height + (item.type === 'separator' ? SEPARATOR_HEIGHT : itemHeight);
    }, MENU_VERTICAL_PADDING) || itemHeight
  );
}

/**
 * @description 标准化外部传入的位置。
 */
function normalizePosition(position: BaseContextMenuPosition | BaseContextMenuOffsetPosition): MenuPosition {
  if ('x' in position) {
    return {
      left: position.x,
      top: position.y,
    };
  }

  return {
    left: position.left,
    top: position.top,
  };
}

/**
 * @description 将根菜单坐标限制在视口范围内。
 */
function getSafeRootPosition(position: MenuPosition, menuWidth: number, menuHeight: number): MenuPosition {
  return {
    left: Math.max(VIEWPORT_GAP, Math.min(position.left, window.innerWidth - menuWidth - VIEWPORT_GAP)),
    top: Math.max(VIEWPORT_GAP, Math.min(position.top, window.innerHeight - menuHeight - VIEWPORT_GAP)),
  };
}

/**
 * @description 根据点击目标计算类似 Tooltip / Dropdown 的菜单位置。
 */
function getClickTriggerPosition(triggerRect: DOMRect, menuWidth: number, menuHeight: number): ClickTriggerPositionResult {
  /**
   * 给箭头预留空间，避免菜单边框紧贴触发元素。
   */
  const arrowGap = 8;

  const canOpenBelow = triggerRect.bottom + arrowGap + menuHeight + VIEWPORT_GAP <= window.innerHeight;

  const placement: PopupArrowState['placement'] = canOpenBelow ? 'top' : 'bottom';

  const top = canOpenBelow ? triggerRect.bottom + arrowGap : triggerRect.top - menuHeight - arrowGap;

  let left = triggerRect.left;

  if (left + menuWidth + VIEWPORT_GAP > window.innerWidth) {
    left = triggerRect.right - menuWidth;
  }

  return {
    position: getSafeRootPosition({ left, top }, menuWidth, menuHeight),
    popupArrow: {
      placement,
      anchorX: triggerRect.left + triggerRect.width / 2,
    },
  };
}

/**
 * @description 计算子菜单位置。
 */
function getSafeSubmenuPosition(triggerRect: DOMRect, menuWidth: number, menuHeight: number, placement: Exclude<BaseContextMenuSubmenuPlacement, 'inline'>): MenuPosition {
  const rightPosition = triggerRect.right + SUBMENU_GAP;

  const leftPosition = triggerRect.left - menuWidth - SUBMENU_GAP;

  const canOpenRight = rightPosition + menuWidth + VIEWPORT_GAP <= window.innerWidth;

  const canOpenLeft = leftPosition >= VIEWPORT_GAP;

  let left = rightPosition;

  if (placement === 'left') {
    left = canOpenLeft ? leftPosition : rightPosition;
  } else if (placement === 'right') {
    left = canOpenRight ? rightPosition : leftPosition;
  } else {
    left = canOpenRight ? rightPosition : leftPosition;
  }

  left = Math.max(VIEWPORT_GAP, Math.min(left, window.innerWidth - menuWidth - VIEWPORT_GAP));

  const top = Math.max(VIEWPORT_GAP, Math.min(triggerRect.top - 4, window.innerHeight - menuHeight - VIEWPORT_GAP));

  return {
    left,
    top,
  };
}

/**
 * @description 单级菜单。
 */
function MenuLevel(props: MenuLevelProps) {
  const {
    items,
    level,
    position,
    minWidth,
    density,
    submenuPlacement,
    submenuOpenDelay,
    inline = false,
    popupArrow,
    menuClassName,
    menuStyle,
    onCloseAll,
    onCloseLevel,
    onSelectItem,
  } = props;

  const menuRef = useRef<HTMLDivElement | null>(null);

  const itemRefs = useRef(new Map<string, HTMLButtonElement>());

  const openTimerRef = useRef<number | null>(null);

  const visibleItems = useMemo(() => getVisibleItems(items), [items]);

  const enabledItems = useMemo(() => {
    return visibleItems.filter((item): item is BaseContextMenuActionItem => item.type !== 'separator' && !item.disabled);
  }, [visibleItems]);

  const [activeKey, setActiveKey] = useState(enabledItems[0]?.key || '');

  /**
   * 每一级只展开一个子菜单。
   * inline 模式下表现为手风琴式折叠展开。
   */
  const [openChildKey, setOpenChildKey] = useState('');

  const [submenuPosition, setSubmenuPosition] = useState<MenuPosition>({
    left: 0,
    top: 0,
  });

  /**
   * items 更新后，旧 activeKey 可能已经不存在。
   * 直接派生有效值，避免在 Effect 中同步 setState。
   */
  const resolvedActiveKey = enabledItems.some((item) => item.key === activeKey) ? activeKey : enabledItems[0]?.key || '';

  useEffect(() => {
    /**
     * 浮动子菜单打开时获取焦点。
     * inline 子菜单不抢夺父级菜单焦点。
     */
    if (!inline) {
      menuRef.current?.focus({
        preventScroll: true,
      });
    }
  }, [inline]);

  /**
   * 根据菜单真实宽度计算箭头横向位置。
   *
   * 这里在布局完成后读取 menuRef，不会在 render 阶段访问 ref。
   */
  useLayoutEffect(() => {
    if (level !== 0 || !popupArrow || !menuRef.current) {
      return;
    }

    const menuRect = menuRef.current.getBoundingClientRect();

    const edgeGap = 14;

    const arrowLeft = Math.max(edgeGap, Math.min(popupArrow.anchorX - menuRect.left, menuRect.width - edgeGap));

    menuRef.current.style.setProperty('--context-menu-popup-arrow-left', `${arrowLeft}px`);
  }, [level, popupArrow, position.left, position.top, minWidth]);

  useEffect(() => {
    return () => {
      if (openTimerRef.current) {
        window.clearTimeout(openTimerRef.current);
      }
    };
  }, []);

  /**
   * @description 清除子菜单延迟定时器。
   */
  const clearOpenTimer = () => {
    if (!openTimerRef.current) return;

    window.clearTimeout(openTimerRef.current);
    openTimerRef.current = null;
  };

  /**
   * @description 关闭当前级别的子菜单。
   */
  const closeChildMenu = (focusCurrentMenu = false) => {
    clearOpenTimer();
    setOpenChildKey('');

    if (focusCurrentMenu) {
      window.setTimeout(() => {
        menuRef.current?.focus({
          preventScroll: true,
        });
      }, 0);
    }
  };

  /**
   * @description 打开指定菜单项的子菜单。
   *
   * inline 模式不响应悬停打开，只在点击或键盘操作时展开。
   */
  const openChildMenu = (item: BaseContextMenuActionItem, immediate = false) => {
    clearOpenTimer();

    if (!hasVisibleChildren(item)) {
      setOpenChildKey('');
      return;
    }

    if (submenuPlacement === 'inline') {
      if (immediate) {
        setOpenChildKey(item.key);
      }

      return;
    }

    const open = () => {
      const trigger = itemRefs.current.get(item.key);

      if (!trigger) return;

      const childItems = getVisibleItems(item.children || []);

      setSubmenuPosition(getSafeSubmenuPosition(trigger.getBoundingClientRect(), minWidth, getEstimatedMenuHeight(childItems, density), submenuPlacement));

      setOpenChildKey(item.key);
    };

    if (immediate) {
      open();
      return;
    }

    openTimerRef.current = window.setTimeout(open, submenuOpenDelay);
  };

  /**
   * @description 点击父级菜单项时切换子菜单。
   */
  const toggleChildMenu = (item: BaseContextMenuActionItem) => {
    if (!hasVisibleChildren(item)) {
      return;
    }

    if (submenuPlacement === 'inline') {
      clearOpenTimer();

      setOpenChildKey((currentKey) => {
        return currentKey === item.key ? '' : item.key;
      });

      return;
    }

    openChildMenu(item, true);
  };

  /**
   * @description 使用方向键切换菜单项。
   */
  const moveActiveItem = (direction: 1 | -1) => {
    if (enabledItems.length === 0) return;

    const currentIndex = enabledItems.findIndex((item) => item.key === resolvedActiveKey);

    const nextIndex = currentIndex < 0 ? 0 : (currentIndex + direction + enabledItems.length) % enabledItems.length;

    const nextItem = enabledItems[nextIndex];

    setActiveKey(nextItem.key);

    /**
     * 浮动子菜单保留原来的悬停/键盘预展开行为。
     * inline 模式只切换当前项，不自动展开。
     */
    if (submenuPlacement !== 'inline') {
      openChildMenu(nextItem);
    }
  };

  /**
   * @description 处理菜单键盘事件。
   */
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onCloseAll();
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveActiveItem(1);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveActiveItem(-1);
      return;
    }

    if (event.key === 'ArrowLeft') {
      /**
       * inline 模式优先折叠当前级已经展开的子菜单。
       */
      if (submenuPlacement === 'inline' && openChildKey) {
        event.preventDefault();
        closeChildMenu(true);
        return;
      }

      if (level > 0) {
        event.preventDefault();
        onCloseLevel?.();
      }

      return;
    }

    const currentItem = enabledItems.find((item) => item.key === resolvedActiveKey);

    if (!currentItem) return;

    if (event.key === 'ArrowRight') {
      if (hasVisibleChildren(currentItem)) {
        event.preventDefault();
        openChildMenu(currentItem, true);
      }

      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();

      if (hasVisibleChildren(currentItem)) {
        toggleChildMenu(currentItem);
        return;
      }

      void onSelectItem(currentItem);
    }
  };

  const activeChildItem = visibleItems.find((item): item is BaseContextMenuActionItem => item.type !== 'separator' && item.key === openChildKey && hasVisibleChildren(item));

  return (
    <>
      <div
        ref={menuRef}
        role="menu"
        tabIndex={inline ? undefined : -1}
        className={[
          styles['context-menu'],
          inline ? styles['context-menu-inline'] : '',
          !inline && submenuPlacement === 'inline' ? styles['context-menu-inline-placement'] : '',
          density === 'compact' ? styles.compact : '',
          level === 0 && menuClassName ? menuClassName : '',
        ]
          .filter(Boolean)
          .join(' ')}
        style={
          inline
            ? undefined
            : {
                left: position.left,
                top: position.top,
                minWidth,
                ...(level === 0 ? menuStyle : null),
              }
        }
        data-context-menu-level={level}
        data-base-context-menu-root="true"
        onKeyDown={handleKeyDown}
        onContextMenu={(event) => event.preventDefault()}
        onMouseLeave={submenuPlacement === 'inline' ? undefined : clearOpenTimer}
      >
        {level === 0 && popupArrow && (
          <span
            className={[styles['context-menu-popup-arrow'], popupArrow.placement === 'top' ? styles['context-menu-popup-arrow-top'] : styles['context-menu-popup-arrow-bottom']]
              .filter(Boolean)
              .join(' ')}
            aria-hidden="true"
          />
        )}

        {visibleItems.map((item) => {
          if (item.type === 'separator') {
            return <div key={item.key} className={styles['context-menu-separator']} role="separator" />;
          }

          const active = item.key === resolvedActiveKey;

          const hasChildren = hasVisibleChildren(item);

          const childOpen = item.key === openChildKey;

          return (
            <Fragment key={item.key}>
              <button
                ref={(element) => {
                  if (element) {
                    itemRefs.current.set(item.key, element);
                  } else {
                    itemRefs.current.delete(item.key);
                  }
                }}
                type="button"
                role="menuitem"
                title={item.title}
                disabled={item.disabled}
                aria-haspopup={hasChildren ? 'menu' : undefined}
                aria-expanded={hasChildren ? childOpen : undefined}
                className={[styles['context-menu-item'], active ? styles.active : '', childOpen ? styles['child-open'] : '', item.danger ? styles.danger : '', item.className || '']
                  .filter(Boolean)
                  .join(' ')}
                style={item.style}
                onMouseEnter={() => {
                  if (item.disabled) return;

                  setActiveKey(item.key);

                  if (submenuPlacement !== 'inline') {
                    openChildMenu(item);
                  }
                }}
                onClick={() => {
                  if (item.disabled) return;

                  if (hasChildren) {
                    toggleChildMenu(item);
                    return;
                  }

                  void onSelectItem(item);
                }}
              >
                <span className={styles['context-menu-icon']}>{item.icon}</span>

                <span className={styles['context-menu-label']}>{item.label}</span>

                <span className={styles['context-menu-trailing']}>
                  {item.shortcut && <span className={styles['context-menu-shortcut']}>{item.shortcut}</span>}

                  {hasChildren && (
                    <span
                      className={[
                        styles['context-menu-arrow'],
                        submenuPlacement === 'inline' ? styles['context-menu-arrow-inline'] : '',
                        submenuPlacement === 'inline' && childOpen ? styles['context-menu-arrow-open'] : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      aria-hidden="true"
                    >
                      ›
                    </span>
                  )}
                </span>
              </button>

              {submenuPlacement === 'inline' && childOpen && hasChildren && (
                <MenuLevel
                  items={item.children || []}
                  level={level + 1}
                  position={{
                    left: 0,
                    top: 0,
                  }}
                  minWidth={minWidth}
                  density={density}
                  submenuPlacement={submenuPlacement}
                  submenuOpenDelay={submenuOpenDelay}
                  inline
                  onCloseAll={onCloseAll}
                  onCloseLevel={() => closeChildMenu(true)}
                  onSelectItem={onSelectItem}
                />
              )}
            </Fragment>
          );
        })}
      </div>

      {submenuPlacement !== 'inline' && activeChildItem && (
        <MenuLevel
          items={activeChildItem.children || []}
          level={level + 1}
          position={submenuPosition}
          minWidth={minWidth}
          density={density}
          submenuPlacement={submenuPlacement}
          submenuOpenDelay={submenuOpenDelay}
          onCloseAll={onCloseAll}
          onCloseLevel={() => closeChildMenu(true)}
          onSelectItem={onSelectItem}
        />
      )}
    </>
  );
}

/**
 * @description 通用 VS Code 风格多级菜单。
 *
 * 支持两种模式：
 * 1. 传 children：右键触发模式。
 * 2. 传 open/visible + position：受控浮层模式。
 */
export default function BaseContextMenu(props: BaseContextMenuProps) {
  const {
    items,
    children,
    open,
    visible,
    position,
    trigger = 'contextmenu',
    showArrow = false,
    minWidth = 220,
    disabled = false,
    density = 'default',
    submenuPlacement = 'auto',
    submenuOpenDelay = DEFAULT_SUBMENU_OPEN_DELAY,
    popupContainer,
    getPopupContainer,
    onOpenChange,
    onClose,
    menuClassName,
    menuStyle,
  } = props;

  const [internalOpen, setInternalOpen] = useState(false);

  const [internalPosition, setInternalPosition] = useState<MenuPosition>({
    left: 0,
    top: 0,
  });

  const [internalPopupContainer, setInternalPopupContainer] = useState<HTMLElement | null>(null);

  const [internalPopupArrow, setInternalPopupArrow] = useState<PopupArrowState | null>(null);

  const controlledOpen = open ?? visible;
  const isControlled = controlledOpen !== undefined;

  const mergedOpen = isControlled ? controlledOpen : internalOpen;

  const visibleItems = useMemo(() => getVisibleItems(items), [items]);

  const externalPosition = position ? normalizePosition(position) : null;

  const mergedPosition = externalPosition || internalPosition;

  const safePosition = typeof window === 'undefined' ? mergedPosition : getSafeRootPosition(mergedPosition, minWidth, getEstimatedMenuHeight(visibleItems, density));

  const resolvedPopupContainer = popupContainer || internalPopupContainer || (typeof document === 'undefined' ? null : document.body);

  /**
   * @description 通知打开状态。
   */
  const requestOpenChange = (nextOpen: boolean) => {
    if (!isControlled) {
      setInternalOpen(nextOpen);
    }

    onOpenChange?.(nextOpen);
  };

  /**
   * @description 关闭全部菜单。
   */
  const closeMenu = () => {
    requestOpenChange(false);

    if (!isControlled) {
      setInternalPopupContainer(null);
    }

    setInternalPopupArrow(null);
    onClose?.();
  };

  /**
   * @description 菜单打开后监听外部交互。
   *
   * Webview 内部点击通过 pointerdown 判断；
   * 点击 VS Code 编辑器等 Webview 外部区域时，
   * 通过 window blur 感知当前 Webview 已失焦。
   */
  useDismissOnOutsideInteraction({
    active: mergedOpen,
    onDismiss: closeMenu,
    insideSelector: ['[data-base-context-menu-root="true"]', '[data-base-context-menu-trigger="true"]'].join(','),
    ignoreRightClick: true,
    dismissOnWindowBlur: true,
  });

  /**
   * @description 在指定位置打开菜单。
   */
  const openMenuAtPosition = (nextPosition: MenuPosition) => {
    if (disabled || visibleItems.length === 0) {
      return;
    }

    setInternalPosition(nextPosition);
    setInternalPopupContainer(getPopupContainer?.() || document.body);
    requestOpenChange(true);
  };

  /**
   * @description 默认右键触发模式。
   */
  const handleTriggerContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    if (trigger !== 'contextmenu' || event.defaultPrevented) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    setInternalPopupArrow(null);

    openMenuAtPosition(
      getSafeRootPosition(
        {
          left: event.clientX,
          top: event.clientY,
        },
        minWidth,
        getEstimatedMenuHeight(visibleItems, density),
      ),
    );
  };

  /**
   * @description 点击触发模式。
   * children 作为目标，定位方式类似 Tooltip / Dropdown。
   */
  const handleTriggerClick = (event: MouseEvent<HTMLDivElement>) => {
    if (trigger !== 'click' || event.defaultPrevented) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    /**
     * 菜单已经打开时，再次点击触发器应直接关闭，
     * 不再重新计算位置后重复打开。
     */
    if (mergedOpen) {
      closeMenu();
      return;
    }

    const firstChild = event.currentTarget.firstElementChild;

    const eventTarget = event.target instanceof HTMLElement ? event.target : null;

    const target = firstChild instanceof HTMLElement ? firstChild : eventTarget;

    if (!target) return;

    const result = getClickTriggerPosition(target.getBoundingClientRect(), minWidth, getEstimatedMenuHeight(visibleItems, density));

    setInternalPopupArrow(showArrow ? result.popupArrow : null);

    openMenuAtPosition(result.position);
  };

  /**
   * @description 执行叶子菜单。
   */
  const selectItem = async (item: BaseContextMenuActionItem) => {
    if (item.disabled || hasVisibleChildren(item)) {
      return;
    }

    if (item.closeOnSelect !== false) {
      closeMenu();
    }

    await item.onSelect?.();
  };

  return (
    <>
      {children !== undefined && (
        <div className={styles['context-menu-trigger']} data-base-context-menu-trigger="true" onClick={handleTriggerClick} onContextMenu={handleTriggerContextMenu}>
          {children}
        </div>
      )}

      {mergedOpen &&
        resolvedPopupContainer &&
        visibleItems.length > 0 &&
        createPortal(
          <>
            <div
              className={styles['context-menu-mask']}
              onContextMenu={(event) => {
                event.preventDefault();
              }}
            />

            <MenuLevel
              items={visibleItems}
              level={0}
              position={safePosition}
              minWidth={minWidth}
              density={density}
              submenuPlacement={submenuPlacement}
              submenuOpenDelay={submenuOpenDelay}
              popupArrow={trigger === 'click' && showArrow ? internalPopupArrow : null}
              menuClassName={menuClassName}
              menuStyle={menuStyle}
              onCloseAll={closeMenu}
              onSelectItem={selectItem}
            />
          </>,
          resolvedPopupContainer,
        )}
    </>
  );
}
