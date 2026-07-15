import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

export type OverlayPlacement = 'top' | 'right' | 'bottom' | 'left';

export interface UseOverlayPositionOptions<T extends HTMLElement = HTMLElement> {
  /** 是否启用定位 */
  open: boolean;

  /** 定位参考元素 */
  anchorEl: HTMLElement | null;

  /** 浮层元素 Ref */
  overlayRef: RefObject<T | null>;

  /** 优先展示方向 */
  placement?: OverlayPlacement;

  /** 浮层与参考元素之间的距离 */
  offset?: number;

  /** 浮层与视口边缘之间的最小距离 */
  viewportPadding?: number;

  /**
   * 是否持续跟随参考元素
   *
   * React Flow、拖拽节点或 transform 动画场景建议开启。
   */
  followAnchor?: boolean;
}

export interface UseOverlayPositionReturn {
  /** 碰撞检测后实际使用的方向 */
  resolvedPlacement: OverlayPlacement;

  /** 手动重新计算位置 */
  updatePosition: () => void;
}

interface OverlaySize {
  width: number;
  height: number;
}

interface OverlayPosition {
  left: number;
  top: number;
}

const OPPOSITE_PLACEMENT_MAP: Record<OverlayPlacement, OverlayPlacement> = {
  top: 'bottom',
  right: 'left',
  bottom: 'top',
  left: 'right',
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/**
 * @description 判断指定方向是否能完整容纳浮层
 */
function hasEnoughSpace(placement: OverlayPlacement, anchorRect: DOMRect, overlaySize: OverlaySize, offset: number, viewportPadding: number): boolean {
  switch (placement) {
    case 'top':
      return anchorRect.top - viewportPadding >= overlaySize.height + offset;

    case 'bottom':
      return window.innerHeight - anchorRect.bottom - viewportPadding >= overlaySize.height + offset;

    case 'left':
      return anchorRect.left - viewportPadding >= overlaySize.width + offset;

    case 'right':
      return window.innerWidth - anchorRect.right - viewportPadding >= overlaySize.width + offset;

    default:
      return true;
  }
}

/**
 * @description 碰撞检测
 *
 * 优先使用传入的 placement。
 * 当首选方向无法完整展示，并且相反方向空间充足时，
 * 自动翻转到相反方向。
 */
function resolvePlacement(placement: OverlayPlacement, anchorRect: DOMRect, overlaySize: OverlaySize, offset: number, viewportPadding: number): OverlayPlacement {
  if (hasEnoughSpace(placement, anchorRect, overlaySize, offset, viewportPadding)) {
    return placement;
  }

  const oppositePlacement = OPPOSITE_PLACEMENT_MAP[placement];

  if (hasEnoughSpace(oppositePlacement, anchorRect, overlaySize, offset, viewportPadding)) {
    return oppositePlacement;
  }

  return placement;
}

/**
 * @description 根据实际方向计算浮层坐标
 */
function calculatePosition(placement: OverlayPlacement, anchorRect: DOMRect, overlaySize: OverlaySize, offset: number, viewportPadding: number): OverlayPosition {
  let left = anchorRect.left + (anchorRect.width - overlaySize.width) / 2;

  let top = anchorRect.bottom + offset;

  switch (placement) {
    case 'top':
      top = anchorRect.top - overlaySize.height - offset;
      break;

    case 'right':
      left = anchorRect.right + offset;
      top = anchorRect.top + (anchorRect.height - overlaySize.height) / 2;
      break;

    case 'left':
      left = anchorRect.left - overlaySize.width - offset;
      top = anchorRect.top + (anchorRect.height - overlaySize.height) / 2;
      break;

    case 'bottom':
    default:
      break;
  }

  const maxLeft = window.innerWidth - overlaySize.width - viewportPadding;

  const maxTop = window.innerHeight - overlaySize.height - viewportPadding;

  return {
    left: clamp(left, viewportPadding, maxLeft),
    top: clamp(top, viewportPadding, maxTop),
  };
}

/**
 * @description 通用浮层定位 Hook
 *
 * 负责：
 * 1. 根据 anchorEl 自动计算位置；
 * 2. 检测视口碰撞并自动翻转方向；
 * 3. 将最终位置限制在视口范围内；
 * 4. 监听滚动、窗口缩放和元素尺寸变化；
 * 5. 支持持续跟随移动中的参考元素。
 */
export default function useOverlayPosition<T extends HTMLElement = HTMLElement>({
  open,
  anchorEl,
  overlayRef,
  placement = 'bottom',
  offset = 10,
  viewportPadding = 8,
  followAnchor = false,
}: UseOverlayPositionOptions<T>): UseOverlayPositionReturn {
  const [resolvedPlacement, setResolvedPlacement] = useState<OverlayPlacement>(placement);

  const resolvedPlacementRef = useRef<OverlayPlacement>(placement);

  const updatePosition = useCallback((): void => {
    const overlayElement = overlayRef.current;

    if (!open || !anchorEl || !overlayElement) {
      return;
    }

    if (!anchorEl.isConnected) {
      overlayElement.style.visibility = 'hidden';
      return;
    }

    const anchorRect = anchorEl.getBoundingClientRect();

    const overlayRect = overlayElement.getBoundingClientRect();

    const overlaySize: OverlaySize = {
      width: overlayRect.width,
      height: overlayRect.height,
    };

    const nextPlacement = resolvePlacement(placement, anchorRect, overlaySize, offset, viewportPadding);

    const position = calculatePosition(nextPlacement, anchorRect, overlaySize, offset, viewportPadding);

    overlayElement.style.left = `${Math.round(position.left)}px`;

    overlayElement.style.top = `${Math.round(position.top)}px`;

    overlayElement.style.visibility = 'visible';

    if (resolvedPlacementRef.current !== nextPlacement) {
      resolvedPlacementRef.current = nextPlacement;

      setResolvedPlacement(nextPlacement);
    }
  }, [anchorEl, offset, open, overlayRef, placement, viewportPadding]);

  useLayoutEffect(() => {
    if (!open || !anchorEl) {
      return;
    }

    let animationFrameId = 0;

    const handlePositionChange = (): void => {
      updatePosition();
    };

    const trackPosition = (): void => {
      updatePosition();

      animationFrameId = window.requestAnimationFrame(trackPosition);
    };

    /*
     * placement 或目标元素发生变化时，
     * 先隐藏浮层，等待下一帧完成重新定位。
     */
    if (overlayRef.current) {
      overlayRef.current.style.visibility = 'hidden';
    }

    /*
     * 不在 Effect 主体内同步调用 updatePosition。
     * 因为 updatePosition 内部可能调用 setResolvedPlacement。
     */
    if (followAnchor) {
      animationFrameId = window.requestAnimationFrame(trackPosition);
    } else {
      animationFrameId = window.requestAnimationFrame(() => {
        updatePosition();
      });
    }

    window.addEventListener('resize', handlePositionChange);

    window.addEventListener('scroll', handlePositionChange, true);

    const resizeObserver = new ResizeObserver(handlePositionChange);

    resizeObserver.observe(anchorEl);

    if (overlayRef.current) {
      resizeObserver.observe(overlayRef.current);
    }

    return () => {
      window.cancelAnimationFrame(animationFrameId);

      window.removeEventListener('resize', handlePositionChange);

      window.removeEventListener('scroll', handlePositionChange, true);

      resizeObserver.disconnect();
    };
  }, [anchorEl, followAnchor, open, overlayRef, placement, updatePosition]);

  return {
    resolvedPlacement,
    updatePosition,
  };
}
