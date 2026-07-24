import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import styles from './index.module.css';
import { useDismissOnOutsideInteraction } from '@/hooks/use-dismiss-on-outside-interaction';
import type {
  BaseContextMenuItem,
  BaseContextMenuActionItem,
  BaseContextMenuPosition,
  BaseContextMenuOffsetPosition,
  MenuPosition,
  BaseContextMenuSubmenuPlacement,
  MenuLevelProps,
  BaseContextMenuPopupPlacement,
  BaseContextMenuProps
} from '@components/BaseContextMenu/src/type';

const DEFAULT_VIEWPORT_PADDING = 8;
const DEFAULT_POPUP_OFFSET = 8;
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
function getSafeRootPosition(position: MenuPosition, menuWidth: number, menuHeight: number, viewportPadding = DEFAULT_VIEWPORT_PADDING): MenuPosition {
  return {
    left: Math.max(viewportPadding, Math.min(position.left, window.innerWidth - menuWidth - viewportPadding)),
    top: Math.max(viewportPadding, Math.min(position.top, window.innerHeight - menuHeight - viewportPadding)),
  };
}

/**
 * @description 将滚动区域高度向下对齐到最后一个完整菜单项。
 *
 * 视口可用高度通常不是菜单行高的整数倍。
 * 直接使用可用高度会在底部截出半行菜单项，
 * 看起来像内容显示不全。
 */
function getCompleteItemContentHeight(contentElement: HTMLDivElement, availableHeight: number): number {
  const children = Array.from(contentElement.children).filter((element): element is HTMLElement => element instanceof HTMLElement);

  let completeHeight = 0;

  children.forEach((element) => {
    const elementBottom = element.offsetTop + element.offsetHeight;

    if (elementBottom <= availableHeight) {
      completeHeight = elementBottom;
    }
  });

  return completeHeight > 0 ? completeHeight : availableHeight;
}

/**
 * @description 计算子菜单位置。
 */
function getSafeSubmenuPosition(triggerRect: DOMRect, menuWidth: number, menuHeight: number, placement: Exclude<BaseContextMenuSubmenuPlacement, 'inline'>): MenuPosition {
  const rightPosition = triggerRect.right + SUBMENU_GAP;

  const leftPosition = triggerRect.left - menuWidth - SUBMENU_GAP;

  const canOpenRight = rightPosition + menuWidth + DEFAULT_VIEWPORT_PADDING <= window.innerWidth;

  const canOpenLeft = leftPosition >= DEFAULT_VIEWPORT_PADDING;

  let left = rightPosition;

  if (placement === 'left') {
    left = canOpenLeft ? leftPosition : rightPosition;
  } else if (placement === 'right') {
    left = canOpenRight ? rightPosition : leftPosition;
  } else {
    left = canOpenRight ? rightPosition : leftPosition;
  }

  left = Math.max(DEFAULT_VIEWPORT_PADDING, Math.min(left, window.innerWidth - menuWidth - DEFAULT_VIEWPORT_PADDING));

  const top = Math.max(DEFAULT_VIEWPORT_PADDING, Math.min(triggerRect.top - 4, window.innerHeight - menuHeight - DEFAULT_VIEWPORT_PADDING));

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
    showArrow = false,
    centerArrow = false,
    anchorEl,
    anchorPoint,
    popupPlacement = 'auto',
    popupOffset = DEFAULT_POPUP_OFFSET,
    viewportPadding = DEFAULT_VIEWPORT_PADDING,
    maxHeight,
    menuClassName,
    menuStyle,
    onCloseAll,
    onCloseLevel,
    onSelectItem,
  } = props;

  const menuRef = useRef<HTMLDivElement | null>(null);

  const contentRef = useRef<HTMLDivElement | null>(null);

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
   * @description 根据真实尺寸完成菜单定位、箭头定位和高度碰撞处理。
   *
   * 菜单高度超过可用空间时，只让内容层滚动，
   * 外层菜单继续保持 overflow: visible，避免箭头被裁剪。
   */
  const updateMenuLayout = useCallback(() => {
    const menuElement = menuRef.current;
    const contentElement = contentRef.current;

    if (inline || !menuElement || !contentElement) {
      return;
    }

    const previousScrollTop = contentElement.scrollTop;

    menuElement.style.visibility = 'hidden';
    menuElement.style.maxHeight = '';
    contentElement.style.maxHeight = '';
    contentElement.style.overflowY = '';
    contentElement.style.overflowX = 'hidden';
    delete contentElement.dataset.scrollable;

    const computedStyle = window.getComputedStyle(menuElement);
    const verticalChrome =
      Number.parseFloat(computedStyle.paddingTop || '0') +
      Number.parseFloat(computedStyle.paddingBottom || '0') +
      Number.parseFloat(computedStyle.borderTopWidth || '0') +
      Number.parseFloat(computedStyle.borderBottomWidth || '0');

    const naturalContentHeight = contentElement.scrollHeight;
    const naturalMenuHeight = naturalContentHeight + verticalChrome;
    const viewportMaxHeight = Math.max(32, window.innerHeight - viewportPadding * 2);
    const configuredMaxHeight = typeof maxHeight === 'number' ? Math.min(viewportMaxHeight, Math.max(32, maxHeight)) : viewportMaxHeight;

    const connectedAnchor = anchorEl?.isConnected ? anchorEl : null;
    const anchorRect = connectedAnchor?.getBoundingClientRect();
    const resolvedAnchorPoint = anchorRect
      ? {
          x: anchorRect.left + anchorRect.width / 2,
          top: anchorRect.top,
          bottom: anchorRect.bottom,
        }
      : anchorPoint
        ? {
            x: anchorPoint.x,
            top: anchorPoint.y,
            bottom: anchorPoint.y,
          }
        : null;

    let resolvedPopupPlacement: Exclude<BaseContextMenuPopupPlacement, 'auto'> = 'bottom';
    let availableHeight = configuredMaxHeight;

    if (resolvedAnchorPoint) {
      const spaceBelow = Math.max(0, window.innerHeight - resolvedAnchorPoint.bottom - popupOffset - viewportPadding);
      const spaceAbove = Math.max(0, resolvedAnchorPoint.top - popupOffset - viewportPadding);

      const preferredPlacement = popupPlacement === 'auto' ? 'bottom' : popupPlacement;
      const oppositePlacement = preferredPlacement === 'bottom' ? 'top' : 'bottom';
      const preferredSpace = preferredPlacement === 'bottom' ? spaceBelow : spaceAbove;
      const oppositeSpace = oppositePlacement === 'bottom' ? spaceBelow : spaceAbove;

      if (naturalMenuHeight <= preferredSpace) {
        resolvedPopupPlacement = preferredPlacement;
      } else if (naturalMenuHeight <= oppositeSpace) {
        resolvedPopupPlacement = oppositePlacement;
      } else {
        resolvedPopupPlacement = spaceBelow >= spaceAbove ? 'bottom' : 'top';
      }

      availableHeight = Math.min(configuredMaxHeight, resolvedPopupPlacement === 'bottom' ? spaceBelow : spaceAbove);
    }

    const effectiveMenuMaxHeight = resolvedAnchorPoint ? Math.max(32, Math.min(configuredMaxHeight, availableHeight)) : configuredMaxHeight;

    if (naturalMenuHeight > effectiveMenuMaxHeight) {
      const availableContentHeight = Math.max(24, Math.floor(effectiveMenuMaxHeight - verticalChrome - 1));

      /**
       * 让滚动区域底边落在完整菜单项之后，
       * 避免出现截图中 iPad Air 只显示半行的情况。
       */
      const contentMaxHeight = getCompleteItemContentHeight(contentElement, availableContentHeight);

      contentElement.style.maxHeight = `${contentMaxHeight}px`;
      contentElement.style.overflowY = 'scroll';
      contentElement.dataset.scrollable = 'true';
    }

    const menuWidth = menuElement.offsetWidth;
    const menuHeight = menuElement.offsetHeight;

    let nextLeft = position.left;
    let nextTop = position.top;

    if (resolvedAnchorPoint) {
      /**
       * popup 模式统一以锚点为水平中心：
       * - click 模式：锚点是触发元素中心；
       * - contextmenu / 受控 position 模式：锚点是鼠标坐标。
       *
       * 菜单在完成真实尺寸测量前保持隐藏，因此这里按最终宽度
       * 居中不会产生一次可见的向左跳动。
       */
      nextLeft = resolvedAnchorPoint.x - menuWidth / 2;

      nextTop = resolvedPopupPlacement === 'bottom' ? resolvedAnchorPoint.bottom + popupOffset : resolvedAnchorPoint.top - menuHeight - popupOffset;
    }

    const safePosition = getSafeRootPosition(
      {
        left: nextLeft,
        top: nextTop,
      },
      menuWidth,
      menuHeight,
      viewportPadding,
    );

    menuElement.style.left = `${Math.round(safePosition.left)}px`;
    menuElement.style.top = `${Math.round(safePosition.top)}px`;

    if (level === 0 && showArrow && resolvedAnchorPoint) {
      menuElement.dataset.popupArrowPlacement = resolvedPopupPlacement;

      if (centerArrow) {
        /**
         * 非 click 模式直接交给 CSS 使用 left: 50%。
         *
         * 这样箭头会根据菜单最终真实宽度始终保持居中，
         * 不受首次测量、滚动条和内容宽度变化影响。
         */
        menuElement.dataset.popupArrowAlign = 'center';
        menuElement.style.removeProperty('--context-menu-popup-arrow-left');
      } else {
        const edgeGap = 14;
        const arrowLeft = Math.max(edgeGap, Math.min(resolvedAnchorPoint.x - safePosition.left, menuWidth - edgeGap));

        menuElement.dataset.popupArrowAlign = 'anchor';
        menuElement.style.setProperty('--context-menu-popup-arrow-left', `${Math.round(arrowLeft)}px`);
      }
    } else {
      delete menuElement.dataset.popupArrowPlacement;
      delete menuElement.dataset.popupArrowAlign;
      menuElement.style.removeProperty('--context-menu-popup-arrow-left');
    }

    /**
     * 外部滚动、窗口缩放或锚点变化会重新执行布局。
     * 重新设置 max-height 后恢复原来的滚动位置，
     * 避免菜单被强制拉回顶部或无法滚动到最后一项。
     */
    const maxScrollTop = Math.max(0, contentElement.scrollHeight - contentElement.clientHeight);

    contentElement.scrollTop = Math.min(previousScrollTop, maxScrollTop);

    menuElement.style.visibility = 'visible';
  }, [anchorEl, anchorPoint, centerArrow, inline, level, maxHeight, popupOffset, popupPlacement, position.left, position.top, showArrow, viewportPadding]);

  useLayoutEffect(() => {
    updateMenuLayout();
  }, [updateMenuLayout, visibleItems]);

  useEffect(() => {
    if (inline) {
      return;
    }

    const handleWindowResize = () => {
      updateMenuLayout();
    };

    const handleDocumentScroll = (event: Event) => {
      const target = event.target;

      /**
       * window.addEventListener('scroll', ..., true)
       * 会捕获菜单内容自身的滚动事件。
       *
       * 如果这里继续执行 updateMenuLayout，会在每一次滚动时
       * 清空并重新设置 max-height，导致滚动位置被反复校正，
       * 表现为滚不到最后一项或滚动条回弹。
       */
      if (target instanceof Node && menuRef.current?.contains(target)) {
        return;
      }

      updateMenuLayout();
    };

    const handleAnchorResize = () => {
      updateMenuLayout();
    };

    window.addEventListener('resize', handleWindowResize);
    window.addEventListener('scroll', handleDocumentScroll, true);

    const resizeObserver = new ResizeObserver(handleAnchorResize);

    if (anchorEl) {
      resizeObserver.observe(anchorEl);
    }

    return () => {
      window.removeEventListener('resize', handleWindowResize);
      window.removeEventListener('scroll', handleDocumentScroll, true);
      resizeObserver.disconnect();
    };
  }, [anchorEl, inline, updateMenuLayout]);

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
                minWidth,
                ...(level === 0 ? menuStyle : null),

                /**
                 * left / top 不在 React 渲染阶段写入，
                 * 统一由 updateMenuLayout 在 useLayoutEffect 中设置。
                 *
                 * 原因是菜单保持挂载并更新 position 时，React 会先把
                 * 未按真实宽度居中的坐标写入可见菜单，随后布局函数才会
                 * 减去菜单宽度的一半，因此会看到一次向左移动。
                 *
                 * 首次挂载继续保持隐藏；真实尺寸、居中位置和防越界位置
                 * 会在浏览器绘制前一次性计算完成。
                 */
                visibility: 'hidden',
              }
        }
        data-context-menu-level={level}
        data-base-context-menu-root="true"
        onPointerDown={(event) => {
          event.stopPropagation();
        }}
        onClick={(event) => {
          event.stopPropagation();
        }}
        onKeyDown={handleKeyDown}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onMouseLeave={submenuPlacement === 'inline' ? undefined : clearOpenTimer}
      >
        {level === 0 && showArrow && <span className={styles['context-menu-popup-arrow']} aria-hidden="true" />}

        <div ref={contentRef} className={styles['context-menu-content']}>
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
                  className={[
                    styles['context-menu-item'],
                    active ? styles.active : '',
                    childOpen ? styles['child-open'] : '',
                    item.danger ? styles.danger : '',
                    item.className || '',
                  ]
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
    anchorEl,
    popupPlacement = 'auto',
    popupOffset = DEFAULT_POPUP_OFFSET,
    viewportPadding = DEFAULT_VIEWPORT_PADDING,
    maxHeight,
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

  const [internalAnchorEl, setInternalAnchorEl] = useState<HTMLElement | null>(null);

  const [internalAnchorPoint, setInternalAnchorPoint] = useState<BaseContextMenuPosition | null>(null);

  /**
   * @description 当前 BaseContextMenu 实例自己的触发区域。
   *
   * 不能仅通过全局 data 属性判断，否则点击其他
   * BaseContextMenu 的触发器也会被误认为当前菜单内部。
   */
  const triggerRef = useRef<HTMLDivElement | null>(null);

  const controlledOpen = open ?? visible;
  const isControlled = controlledOpen !== undefined;

  const mergedOpen = isControlled ? controlledOpen : internalOpen;

  const visibleItems = useMemo(() => getVisibleItems(items), [items]);

  const externalPosition = position ? normalizePosition(position) : null;

  const mergedPosition = externalPosition || internalPosition;

  const safePosition =
    typeof window === 'undefined' ? mergedPosition : getSafeRootPosition(mergedPosition, minWidth, getEstimatedMenuHeight(visibleItems, density), viewportPadding);

  const resolvedAnchorEl = anchorEl || internalAnchorEl;

  const resolvedAnchorPoint = resolvedAnchorEl
    ? null
    : internalAnchorPoint ||
      (showArrow && position
        ? {
            x: 'x' in position ? position.x : position.left,
            y: 'y' in position ? position.y : position.top,
          }
        : null);

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

    setInternalAnchorEl(null);
    setInternalAnchorPoint(null);
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
    insideSelector: '[data-base-context-menu-root="true"]',
    insideRefs: [triggerRef],
    /**
     * contextmenu 模式下，新的右键操作随后会更新菜单位置。
     * 如果先在 pointerdown 捕获阶段关闭旧菜单，就会出现
     * “关闭 -> 重新打开”的闪烁或水平跳动。
     *
     * click 模式仍由外部 pointerdown 正常关闭。
     */
    ignoreRightClick: trigger !== 'click',
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

    setInternalAnchorEl(null);
    setInternalAnchorPoint(
      showArrow
        ? {
            x: event.clientX,
            y: event.clientY,
          }
        : null,
    );

    openMenuAtPosition({
      left: event.clientX,
      top: event.clientY,
    });
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

    const targetRect = target.getBoundingClientRect();

    setInternalAnchorEl(target);
    setInternalAnchorPoint(null);

    openMenuAtPosition({
      left: targetRect.left,
      top: targetRect.bottom + popupOffset,
    });
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
        <div
          ref={triggerRef}
          className={styles['context-menu-trigger']}
          data-base-context-menu-trigger="true"
          onClick={handleTriggerClick}
          onContextMenu={handleTriggerContextMenu}
        >
          {children}
        </div>
      )}

      {mergedOpen &&
        resolvedPopupContainer &&
        visibleItems.length > 0 &&
        createPortal(
          <MenuLevel
            items={visibleItems}
            level={0}
            position={safePosition}
            minWidth={minWidth}
            density={density}
            submenuPlacement={submenuPlacement}
            submenuOpenDelay={submenuOpenDelay}
            showArrow={showArrow}
            centerArrow={trigger !== 'click'}
            anchorEl={resolvedAnchorEl}
            anchorPoint={resolvedAnchorPoint}
            popupPlacement={popupPlacement}
            popupOffset={popupOffset}
            viewportPadding={viewportPadding}
            maxHeight={maxHeight}
            menuClassName={menuClassName}
            menuStyle={menuStyle}
            onCloseAll={closeMenu}
            onSelectItem={selectItem}
          />,
          resolvedPopupContainer,
        )}
    </>
  );
}