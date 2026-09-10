import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import styles from '@components/Scrollbar/index.module.css';

export interface ScrollbarInstance {
  wrapRef: HTMLDivElement | null;
  update: () => void;
  scrollTo: (options: ScrollToOptions | number, y?: number) => void;
  setScrollTop: (value: number) => void;
  setScrollLeft: (value: number) => void;
}

export type ScrollbarDirection = 'vertical' | 'horizontal' | 'both';

export interface ScrollbarProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onScroll'> {
  height?: number | string;
  maxHeight?: number | string;
  native?: boolean;
  always?: boolean;
  noresize?: boolean;

  /**
   * 滚动方向。
   * vertical：只显示纵向滚动条。
   * horizontal：只显示横向滚动条，并支持鼠标滚轮横向滚动。
   * both：横向和纵向都自动检测。
   */
  direction?: ScrollbarDirection;

  /**
   * 是否让滚动条上下/左右留出间距。
   * 默认 false：贴边显示，接近 VS Code 原生滚动条。
   */
  inset?: boolean;

  /**
   * 滚动条可交互区域宽度，默认 8px。
   */
  barSize?: number | string;

  /**
   * inset 模式下 thumb 的实际显示宽度，默认 6px。
   */
  insetSize?: number | string;

  /**
   * inset 模式下滚动条两端间距，默认 2px。
   */
  insetGap?: number;

  /**
   * direction="horizontal" 时，是否把普通鼠标滚轮转换为横向滚动。
   */
  wheelX?: boolean;

  wrapClassName?: string;
  viewClassName?: string;
  viewStyle?: React.CSSProperties;
  onScroll?: (payload: { scrollTop: number; scrollLeft: number }) => void;
}

interface ThumbState {
  verticalSize: number;
  verticalOffset: number;
  horizontalSize: number;
  horizontalOffset: number;
  verticalVisible: boolean;
  horizontalVisible: boolean;
}

const MIN_THUMB_SIZE = 20;

function addUnit(value?: number | string) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  return typeof value === 'number' ? `${value}px` : value;
}

const Scrollbar = forwardRef<ScrollbarInstance, ScrollbarProps>((props, ref) => {
  const {
    children,
    className,
    style,
    height,
    maxHeight,
    native = false,
    always = false,
    noresize = false,
    direction = 'both',
    inset = false,
    barSize = 8,
    insetSize = 6,
    insetGap = 2,
    wheelX = true,
    wrapClassName,
    viewClassName,
    viewStyle,
    onScroll,
    onMouseEnter,
    onMouseLeave,
    ...rest
  } = props;

  const wrapRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const frameRef = useRef<number | null>(null);
  const wheelFrameRef = useRef<number | null>(null);
  const wheelTargetRef = useRef({
    top: 0,
    left: 0,
  });
  const draggingRef = useRef<{
    axis: 'vertical' | 'horizontal';
    startClient: number;
    startScroll: number;
    maxThumbOffset: number;
  } | null>(null);

  const [hovering, setHovering] = useState(false);
  const [scrolling, setScrolling] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [thumbState, setThumbState] = useState<ThumbState>({
    verticalSize: 0,
    verticalOffset: 0,
    horizontalSize: 0,
    horizontalOffset: 0,
    verticalVisible: false,
    horizontalVisible: false,
  });

  const barGapSize = inset ? insetGap : 0;
  const barOffsetSize = barGapSize * 2;

  const canScrollVertical = direction === 'vertical' || direction === 'both';
  const canScrollHorizontal = direction === 'horizontal' || direction === 'both';

  const rootStyle = useMemo<React.CSSProperties>(() => {
    return {
      ...style,
      height: addUnit(height) || style?.height,
      maxHeight: addUnit(maxHeight) || style?.maxHeight,
      '--quickops-scrollbar-bar-gap': `${barGapSize}px`,
      '--quickops-scrollbar-bar-size': addUnit(barSize),
      '--quickops-scrollbar-thumb-size': addUnit(inset ? insetSize : barSize),
    } as React.CSSProperties;
  }, [barGapSize, barSize, height, inset, insetSize, maxHeight, style]);

  const update = useCallback(() => {
    const wrap = wrapRef.current;

    if (!wrap) return;

    const { clientHeight, clientWidth, scrollHeight, scrollWidth, scrollTop, scrollLeft } = wrap;

    const hasVertical = canScrollVertical && scrollHeight > clientHeight + 1;
    const hasHorizontal = canScrollHorizontal && scrollWidth > clientWidth + 1;

    const verticalTrackSize = Math.max(0, clientHeight - barOffsetSize);
    const horizontalTrackSize = Math.max(0, clientWidth - barOffsetSize);

    const verticalSize = hasVertical ? Math.max(Math.round((clientHeight * verticalTrackSize) / scrollHeight), MIN_THUMB_SIZE) : 0;

    const horizontalSize = hasHorizontal ? Math.max(Math.round((clientWidth * horizontalTrackSize) / scrollWidth), MIN_THUMB_SIZE) : 0;

    const verticalMaxOffset = Math.max(0, verticalTrackSize - verticalSize);
    const horizontalMaxOffset = Math.max(0, horizontalTrackSize - horizontalSize);

    const verticalOffset = hasVertical ? Math.round((scrollTop / Math.max(1, scrollHeight - clientHeight)) * verticalMaxOffset) : 0;

    const horizontalOffset = hasHorizontal ? Math.round((scrollLeft / Math.max(1, scrollWidth - clientWidth)) * horizontalMaxOffset) : 0;

    setThumbState({
      verticalSize,
      verticalOffset,
      horizontalSize,
      horizontalOffset,
      verticalVisible: hasVertical,
      horizontalVisible: hasHorizontal,
    });
  }, [barOffsetSize, canScrollHorizontal, canScrollVertical]);

  const scheduleUpdate = useCallback(() => {
    if (frameRef.current !== null) return;

    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      update();
    });
  }, [update]);

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const showScrollbarTemporarily = useCallback(() => {
    clearHideTimer();
    setScrolling(true);

    hideTimerRef.current = window.setTimeout(() => {
      setScrolling(false);
      hideTimerRef.current = null;
    }, 700);
  }, [clearHideTimer]);

  const handleScroll = useCallback(() => {
    const wrap = wrapRef.current;

    if (!wrap) return;

    scheduleUpdate();
    showScrollbarTemporarily();

    onScroll?.({
      scrollTop: wrap.scrollTop,
      scrollLeft: wrap.scrollLeft,
    });
  }, [onScroll, scheduleUpdate, showScrollbarTemporarily]);

  const cancelWheelAnimation = useCallback(() => {
    if (wheelFrameRef.current !== null) {
      window.cancelAnimationFrame(wheelFrameRef.current);
      wheelFrameRef.current = null;
    }

    const wrap = wrapRef.current;

    if (wrap) {
      wheelTargetRef.current.top = wrap.scrollTop;
      wheelTargetRef.current.left = wrap.scrollLeft;
    }
  }, []);

  const startWheelAnimation = useCallback(() => {
    if (wheelFrameRef.current !== null) return;

    const animate = () => {
      const wrap = wrapRef.current;

      if (!wrap) {
        wheelFrameRef.current = null;
        return;
      }

      const targetTop = wheelTargetRef.current.top;
      const targetLeft = wheelTargetRef.current.left;
      const topDistance = targetTop - wrap.scrollTop;
      const leftDistance = targetLeft - wrap.scrollLeft;
      const topFinished = Math.abs(topDistance) <= 0.5;
      const leftFinished = Math.abs(leftDistance) <= 0.5;

      if (topFinished) {
        wrap.scrollTop = targetTop;
      } else {
        wrap.scrollTop += topDistance * 0.24;
      }

      if (leftFinished) {
        wrap.scrollLeft = targetLeft;
      } else {
        wrap.scrollLeft += leftDistance * 0.24;
      }

      if (topFinished && leftFinished) {
        wheelFrameRef.current = null;
        return;
      }

      wheelFrameRef.current = window.requestAnimationFrame(animate);
    };

    wheelFrameRef.current = window.requestAnimationFrame(animate);
  }, []);

  const handleWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      const wrap = wrapRef.current;

      if (!wrap || native || event.ctrlKey) return;

      const maxScrollTop = Math.max(0, wrap.scrollHeight - wrap.clientHeight);
      const maxScrollLeft = Math.max(0, wrap.scrollWidth - wrap.clientWidth);
      const lineSize = 16;
      const wheelSpeed = 0.42;
      const maxWheelDelta = 120;

      const normalizeDelta = (delta: number, pageSize: number) => {
        let value = delta;

        if (event.deltaMode === 1) {
          value *= lineSize;
        } else if (event.deltaMode === 2) {
          value *= pageSize;
        }

        return Math.max(-maxWheelDelta, Math.min(maxWheelDelta, value)) * wheelSpeed;
      };

      let axis: 'vertical' | 'horizontal' | null = null;
      let delta = 0;

      if (direction === 'horizontal') {
        if (!wheelX || maxScrollLeft <= 0) return;

        axis = 'horizontal';
        delta = normalizeDelta(
          Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY,
          wrap.clientWidth,
        );
      } else if (direction === 'vertical') {
        if (maxScrollTop <= 0 || !event.deltaY) return;

        axis = 'vertical';
        delta = normalizeDelta(event.deltaY, wrap.clientHeight);
      } else if (Math.abs(event.deltaX) > Math.abs(event.deltaY) && maxScrollLeft > 0) {
        axis = 'horizontal';
        delta = normalizeDelta(event.deltaX, wrap.clientWidth);
      } else if (maxScrollTop > 0 && event.deltaY) {
        axis = 'vertical';
        delta = normalizeDelta(event.deltaY, wrap.clientHeight);
      }

      if (!axis || !delta) return;

      if (wheelFrameRef.current === null) {
        wheelTargetRef.current.top = wrap.scrollTop;
        wheelTargetRef.current.left = wrap.scrollLeft;
      }

      if (axis === 'vertical') {
        const nextTop = Math.max(0, Math.min(maxScrollTop, wheelTargetRef.current.top + delta));

        if (nextTop === wheelTargetRef.current.top && Math.abs(wheelTargetRef.current.top - wrap.scrollTop) <= 0.5) {
          return;
        }

        wheelTargetRef.current.top = nextTop;
      } else {
        const nextLeft = Math.max(0, Math.min(maxScrollLeft, wheelTargetRef.current.left + delta));

        if (nextLeft === wheelTargetRef.current.left && Math.abs(wheelTargetRef.current.left - wrap.scrollLeft) <= 0.5) {
          return;
        }

        wheelTargetRef.current.left = nextLeft;
      }

      event.preventDefault();
      showScrollbarTemporarily();
      startWheelAnimation();
    },
    [direction, native, showScrollbarTemporarily, startWheelAnimation, wheelX],
  );

  const scrollTo = useCallback(
    (options: ScrollToOptions | number, y?: number) => {
      const wrap = wrapRef.current;

      if (!wrap) return;

      cancelWheelAnimation();

      if (typeof options === 'number') {
        wrap.scrollTo(options, y || 0);
        scheduleUpdate();
        return;
      }

      wrap.scrollTo(options);
      scheduleUpdate();
    },
    [scheduleUpdate],
  );

  const setScrollTop = useCallback(
    (value: number) => {
      if (wrapRef.current) {
        cancelWheelAnimation();
        wrapRef.current.scrollTop = value;
        scheduleUpdate();
      }
    },
    [cancelWheelAnimation, scheduleUpdate],
  );

  const setScrollLeft = useCallback(
    (value: number) => {
      if (wrapRef.current) {
        cancelWheelAnimation();
        wrapRef.current.scrollLeft = value;
        scheduleUpdate();
      }
    },
    [cancelWheelAnimation, scheduleUpdate],
  );

  useImperativeHandle(
    ref,
    () => ({
      get wrapRef() {
        return wrapRef.current;
      },
      update,
      scrollTo,
      setScrollTop,
      setScrollLeft,
    }),
    [scrollTo, setScrollLeft, setScrollTop, update],
  );

  const handleMouseEnter = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      setHovering(true);
      onMouseEnter?.(event);
    },
    [onMouseEnter],
  );

  const handleMouseLeave = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      setHovering(false);
      onMouseLeave?.(event);
    },
    [onMouseLeave],
  );

  const startDrag = useCallback(
    (event: React.MouseEvent, axis: 'vertical' | 'horizontal') => {
      const wrap = wrapRef.current;

      if (!wrap) return;

      event.preventDefault();
      event.stopPropagation();
      cancelWheelAnimation();

      const trackSize = axis === 'vertical' ? wrap.clientHeight - barOffsetSize : wrap.clientWidth - barOffsetSize;

      const thumbSize = axis === 'vertical' ? thumbState.verticalSize : thumbState.horizontalSize;

      draggingRef.current = {
        axis,
        startClient: axis === 'vertical' ? event.clientY : event.clientX,
        startScroll: axis === 'vertical' ? wrap.scrollTop : wrap.scrollLeft,
        maxThumbOffset: Math.max(1, trackSize - thumbSize),
      };

      clearHideTimer();
      setDragging(true);
      setScrolling(true);
    },
    [barOffsetSize, cancelWheelAnimation, clearHideTimer, thumbState.horizontalSize, thumbState.verticalSize],
  );

  const handleTrackMouseDown = useCallback(
    (event: React.MouseEvent, axis: 'vertical' | 'horizontal') => {
      const wrap = wrapRef.current;

      if (!wrap || event.target !== event.currentTarget) return;

      event.preventDefault();
      event.stopPropagation();
      cancelWheelAnimation();

      const rect = event.currentTarget.getBoundingClientRect();

      if (axis === 'vertical') {
        const offset = event.clientY - rect.top - thumbState.verticalSize / 2;
        const maxThumbOffset = Math.max(1, wrap.clientHeight - barOffsetSize - thumbState.verticalSize);

        wrap.scrollTop = (offset / maxThumbOffset) * (wrap.scrollHeight - wrap.clientHeight);
      } else {
        const offset = event.clientX - rect.left - thumbState.horizontalSize / 2;
        const maxThumbOffset = Math.max(1, wrap.clientWidth - barOffsetSize - thumbState.horizontalSize);

        wrap.scrollLeft = (offset / maxThumbOffset) * (wrap.scrollWidth - wrap.clientWidth);
      }

      handleScroll();
    },
    [barOffsetSize, cancelWheelAnimation, handleScroll, thumbState.horizontalSize, thumbState.verticalSize],
  );

  useEffect(() => {
    if (!dragging) return undefined;

    const handleMouseMove = (event: MouseEvent) => {
      const dragState = draggingRef.current;
      const wrap = wrapRef.current;

      if (!dragState || !wrap) return;

      const currentClient = dragState.axis === 'vertical' ? event.clientY : event.clientX;
      const delta = currentClient - dragState.startClient;
      const maxScroll = dragState.axis === 'vertical' ? wrap.scrollHeight - wrap.clientHeight : wrap.scrollWidth - wrap.clientWidth;
      const scrollDelta = (delta / dragState.maxThumbOffset) * maxScroll;

      if (dragState.axis === 'vertical') {
        wrap.scrollTop = dragState.startScroll + scrollDelta;
      } else {
        wrap.scrollLeft = dragState.startScroll + scrollDelta;
      }
    };

    const handleMouseUp = () => {
      draggingRef.current = null;
      setDragging(false);
      showScrollbarTemporarily();
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragging, showScrollbarTemporarily]);

  useEffect(() => {
    scheduleUpdate();
  }, [children, scheduleUpdate]);

  useEffect(() => {
    if (native || noresize) return undefined;

    const wrap = wrapRef.current;
    const view = viewRef.current;

    if (!wrap || !view || typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);

      return () => {
        window.removeEventListener('resize', update);
      };
    }

    const observer = new ResizeObserver(() => update());
    observer.observe(wrap);
    observer.observe(view);

    return () => observer.disconnect();
  }, [native, noresize, update]);

  useEffect(() => {
    return () => {
      clearHideTimer();
      cancelWheelAnimation();

      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [cancelWheelAnimation, clearHideTimer]);

  const barVisibleClassName = always || hovering || scrolling || dragging ? styles['is-visible'] : '';

  return (
    <div
      {...rest}
      className={[
        styles['scrollbar'],
        native ? styles['is-native'] : '',
        always ? styles['is-always'] : '',
        inset ? styles['is-inset'] : '',
        direction === 'vertical' ? styles['is-vertical-only'] : '',
        direction === 'horizontal' ? styles['is-horizontal-only'] : '',
        direction === 'both' ? styles['is-both'] : '',
        className || '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={rootStyle}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div
        ref={wrapRef}
        className={[styles['scrollbar-wrap'], native ? styles['scrollbar-wrap-native'] : '', wrapClassName || ''].filter(Boolean).join(' ')}
        onScroll={handleScroll}
        onWheel={handleWheel}
      >
        <div ref={viewRef} className={[styles['scrollbar-view'], viewClassName || ''].filter(Boolean).join(' ')} style={viewStyle}>
          {children}
        </div>
      </div>

      {!native && thumbState.verticalVisible && (
        <div className={`${styles['scrollbar-bar']} ${styles['scrollbar-bar-vertical']} ${barVisibleClassName}`} onMouseDown={(event) => handleTrackMouseDown(event, 'vertical')}>
          <div
            className={styles['scrollbar-thumb']}
            style={{
              height: thumbState.verticalSize,
              transform: `translateY(${thumbState.verticalOffset}px)`,
            }}
            onMouseDown={(event) => startDrag(event, 'vertical')}
          />
        </div>
      )}

      {!native && thumbState.horizontalVisible && (
        <div
          className={`${styles['scrollbar-bar']} ${styles['scrollbar-bar-horizontal']} ${barVisibleClassName}`}
          onMouseDown={(event) => handleTrackMouseDown(event, 'horizontal')}
        >
          <div
            className={styles['scrollbar-thumb']}
            style={{
              width: thumbState.horizontalSize,
              transform: `translateX(${thumbState.horizontalOffset}px)`,
            }}
            onMouseDown={(event) => startDrag(event, 'horizontal')}
          />
        </div>
      )}
    </div>
  );
});

Scrollbar.displayName = 'Scrollbar';

export default Scrollbar;
