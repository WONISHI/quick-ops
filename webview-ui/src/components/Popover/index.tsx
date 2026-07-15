import styles from './index.module.css';
import { createPortal } from 'react-dom';
import { useCallback, useEffect, useRef, useState } from 'react';
import useOverlayPosition from '@/hooks/use-overlay-position';
import type { OverlayPlacement } from '@/hooks/use-overlay-position';
import type { CSSProperties, MouseEventHandler, ReactNode } from 'react';

export type PopoverPlacement = OverlayPlacement;

export type PopoverTrigger = 'hover' | 'click' | 'focus' | 'contextmenu';

export interface PopoverProps {
  /**
   * 是否显示 Popover
   *
   * 传入该属性时为受控模式。
   * 受控模式下 trigger、showAfter、hideAfter 无效。
   */
  open?: boolean;

  /** 定位参考元素 */
  anchorEl: HTMLElement | null;

  /**
   * 非受控模式下的触发方式
   *
   * 受控模式下无效。
   */
  trigger?: PopoverTrigger;

  /**
   * 显示前延迟
   *
   * 单位：毫秒。
   * 受控模式下无效。
   */
  showAfter?: number;

  /**
   * 隐藏前延迟
   *
   * 单位：毫秒。
   * 受控模式下无效。
   */
  hideAfter?: number;

  /** 是否显示箭头 */
  showArrow?: boolean;

  /** 优先展示方向 */
  placement?: PopoverPlacement;

  /** Popover 与参考元素之间的距离 */
  offset?: number;

  /** Popover 与视口边缘之间的最小距离 */
  viewportPadding?: number;

  /**
   * 是否持续跟随参考元素
   *
   * React Flow、拖拽节点或 transform 动画场景建议开启。
   */
  followAnchor?: boolean;

  /** 标题 */
  title?: ReactNode;

  /** 标题图标 */
  titleIcon?: ReactNode;

  /** 主体内容 */
  children?: ReactNode;

  /** 底部操作区域 */
  footer?: ReactNode;

  /** 根节点自定义类名 */
  className?: string;

  /** 标题区域自定义类名 */
  headerClassName?: string;

  /** 内容区域自定义类名 */
  bodyClassName?: string;

  /** 底部区域自定义类名 */
  footerClassName?: string;

  /** 根节点自定义样式 */
  style?: CSSProperties;

  /** 最小宽度 */
  minWidth?: CSSProperties['minWidth'];

  /** 最大宽度 */
  maxWidth?: CSSProperties['maxWidth'];

  /** 鼠标进入 Popover */
  onMouseEnter?: MouseEventHandler<HTMLDivElement>;

  /** 鼠标离开 Popover */
  onMouseLeave?: MouseEventHandler<HTMLDivElement>;

  /**
   * 非受控模式下显示状态发生变化
   */
  onOpenChange?: (open: boolean) => void;
}

/**
 * @description 合并 className
 */
function mergeClassNames(...classNames: Array<string | undefined>): string {
  return classNames.filter(Boolean).join(' ');
}

/**
 * @description 通用 Popover 组件
 *
 * 支持：
 * 1. 受控和非受控两种模式；
 * 2. hover、click、focus、contextmenu 触发；
 * 3. 延迟显示和延迟隐藏；
 * 4. 箭头显示；
 * 5. 碰撞检测和自动方向翻转。
 */
export default function Popover({
  open,
  anchorEl,
  trigger = 'hover',
  showAfter = 0,
  hideAfter = 200,
  showArrow = true,
  placement = 'bottom',
  offset = 10,
  viewportPadding = 8,
  followAnchor = false,
  title,
  titleIcon,
  children,
  footer,
  className,
  headerClassName,
  bodyClassName,
  footerClassName,
  style,
  minWidth,
  maxWidth,
  onMouseEnter,
  onMouseLeave,
  onOpenChange,
}: PopoverProps) {
  const [innerOpen, setInnerOpen] = useState(false);

  const popoverRef = useRef<HTMLDivElement | null>(null);

  const showTimerRef = useRef<number | undefined>(undefined);

  const hideTimerRef = useRef<number | undefined>(undefined);

  /**
   * 记录非受控模式下期望的显示状态。
   *
   * 点击延迟显示期间再次点击时，
   * 也能够正确取消显示。
   */
  const expectedOpenRef = useRef(false);

  /**
   * 传递 open 即为受控模式。
   */
  const isControlled = open !== undefined;

  const visible = isControlled ? open : innerOpen;

  const { resolvedPlacement } = useOverlayPosition({
    open: visible,
    anchorEl,
    overlayRef: popoverRef,
    placement,
    offset,
    viewportPadding,
    followAnchor,
  });

  /**
   * @description 清除显示定时器
   */
  const clearShowTimer = useCallback((): void => {
    if (showTimerRef.current !== undefined) {
      window.clearTimeout(showTimerRef.current);
      showTimerRef.current = undefined;
    }
  }, []);

  /**
   * @description 清除隐藏定时器
   */
  const clearHideTimer = useCallback((): void => {
    if (hideTimerRef.current !== undefined) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = undefined;
    }
  }, []);

  /**
   * @description 更新非受控显示状态
   */
  const updateInnerOpen = useCallback(
    (nextOpen: boolean): void => {
      expectedOpenRef.current = nextOpen;

      setInnerOpen((currentOpen) => {
        if (currentOpen === nextOpen) {
          return currentOpen;
        }

        onOpenChange?.(nextOpen);

        return nextOpen;
      });
    },
    [onOpenChange],
  );

  /**
   * @description 延迟显示
   */
  const showPopover = useCallback((): void => {
    if (isControlled) return;

    clearHideTimer();
    clearShowTimer();

    expectedOpenRef.current = true;

    if (showAfter <= 0) {
      updateInnerOpen(true);
      return;
    }

    showTimerRef.current = window.setTimeout(() => {
      showTimerRef.current = undefined;

      if (!expectedOpenRef.current) {
        return;
      }

      updateInnerOpen(true);
    }, showAfter);
  }, [clearHideTimer, clearShowTimer, isControlled, showAfter, updateInnerOpen]);

  /**
   * @description 延迟隐藏
   */
  const hidePopover = useCallback((): void => {
    if (isControlled) return;

    clearShowTimer();
    clearHideTimer();

    expectedOpenRef.current = false;

    if (hideAfter <= 0) {
      updateInnerOpen(false);
      return;
    }

    hideTimerRef.current = window.setTimeout(() => {
      hideTimerRef.current = undefined;

      if (expectedOpenRef.current) {
        return;
      }

      updateInnerOpen(false);
    }, hideAfter);
  }, [clearHideTimer, clearShowTimer, hideAfter, isControlled, updateInnerOpen]);

  /**
   * @description 切换显示状态
   */
  const togglePopover = useCallback((): void => {
    if (isControlled) return;

    if (expectedOpenRef.current) {
      hidePopover();
      return;
    }

    showPopover();
  }, [hidePopover, isControlled, showPopover]);

  /**
   * @description 绑定定位元素的触发事件
   *
   * 只有非受控模式才会绑定。
   */
  useEffect(() => {
    if (isControlled || !anchorEl) {
      return;
    }

    const handleMouseEnter = (): void => {
      showPopover();
    };

    const handleMouseLeave = (): void => {
      hidePopover();
    };

    const handleClick = (): void => {
      togglePopover();
    };

    const handleFocusIn = (): void => {
      showPopover();
    };

    const handleFocusOut = (event: FocusEvent): void => {
      const nextTarget = event.relatedTarget as Node | null;

      if (nextTarget && popoverRef.current?.contains(nextTarget)) {
        return;
      }

      hidePopover();
    };

    const handleContextMenu = (event: MouseEvent): void => {
      event.preventDefault();
      togglePopover();
    };

    switch (trigger) {
      case 'click':
        anchorEl.addEventListener('click', handleClick);
        break;

      case 'focus':
        anchorEl.addEventListener('focusin', handleFocusIn);

        anchorEl.addEventListener('focusout', handleFocusOut);
        break;

      case 'contextmenu':
        anchorEl.addEventListener('contextmenu', handleContextMenu);
        break;

      case 'hover':
      default:
        anchorEl.addEventListener('mouseenter', handleMouseEnter);

        anchorEl.addEventListener('mouseleave', handleMouseLeave);
        break;
    }

    return () => {
      anchorEl.removeEventListener('click', handleClick);

      anchorEl.removeEventListener('focusin', handleFocusIn);

      anchorEl.removeEventListener('focusout', handleFocusOut);

      anchorEl.removeEventListener('contextmenu', handleContextMenu);

      anchorEl.removeEventListener('mouseenter', handleMouseEnter);

      anchorEl.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, [anchorEl, hidePopover, isControlled, showPopover, togglePopover, trigger]);

  /**
   * @description 点击外部区域时关闭
   */
  useEffect(() => {
    if (isControlled || !visible || !anchorEl || (trigger !== 'click' && trigger !== 'contextmenu')) {
      return;
    }

    const handleOutsideMouseDown = (event: MouseEvent): void => {
      const target = event.target as Node;

      if (anchorEl.contains(target)) {
        return;
      }

      if (popoverRef.current?.contains(target)) {
        return;
      }

      hidePopover();
    };

    document.addEventListener('mousedown', handleOutsideMouseDown, true);

    return () => {
      document.removeEventListener('mousedown', handleOutsideMouseDown, true);
    };
  }, [anchorEl, hidePopover, isControlled, trigger, visible]);

  /**
   * @description 组件卸载时清理定时器
   */
  useEffect(() => {
    return () => {
      clearShowTimer();
      clearHideTimer();
    };
  }, [clearHideTimer, clearShowTimer]);

  /**
   * @description 鼠标进入 Popover
   *
   * hover 模式下取消隐藏，保证鼠标能够从目标元素移动到 Popover。
   */
  const handlePopoverMouseEnter: MouseEventHandler<HTMLDivElement> = (event) => {
    if (!isControlled && trigger === 'hover') {
      clearHideTimer();
      expectedOpenRef.current = true;
    }

    onMouseEnter?.(event);
  };

  /**
   * @description 鼠标离开 Popover
   */
  const handlePopoverMouseLeave: MouseEventHandler<HTMLDivElement> = (event) => {
    if (!isControlled && trigger === 'hover') {
      hidePopover();
    }

    onMouseLeave?.(event);
  };

  if (!visible || !anchorEl) {
    return null;
  }

  const hasHeader = title !== undefined || titleIcon !== undefined;

  const hasFooter = footer !== undefined && footer !== null;

  return createPortal(
    <div
      ref={popoverRef}
      className={mergeClassNames(styles.popover, className)}
      data-placement={resolvedPlacement}
      style={{
        ...style,
        minWidth,
        maxWidth,
      }}
      role="dialog"
      aria-modal={false}
      onMouseEnter={handlePopoverMouseEnter}
      onMouseLeave={handlePopoverMouseLeave}
    >
      {showArrow && <span className={styles.arrow} aria-hidden="true" />}

      {hasHeader && (
        <div className={mergeClassNames(styles.header, headerClassName)}>
          {titleIcon !== undefined && <span className={styles.headerIcon}>{titleIcon}</span>}

          {title !== undefined && <span className={styles.title}>{title}</span>}
        </div>
      )}

      <div className={mergeClassNames(styles.body, bodyClassName)}>{children}</div>

      {hasFooter && <div className={mergeClassNames(styles.footer, footerClassName)}>{footer}</div>}
    </div>,
    document.body,
  );
}
