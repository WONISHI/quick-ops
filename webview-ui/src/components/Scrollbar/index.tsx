import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import styles from './index.module.css';

export interface ScrollbarInstance {
  wrapRef: HTMLDivElement | null;
  update: () => void;
  scrollTo: (options: ScrollToOptions | number, y?: number) => void;
  setScrollTop: (value: number) => void;
  setScrollLeft: (value: number) => void;
}

export interface ScrollbarProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onScroll'> {
  height?: number | string;
  maxHeight?: number | string;
  native?: boolean;
  always?: boolean;
  noresize?: boolean;
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
const BAR_OFFSET = 4;

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
    wrapClassName,
    viewClassName,
    viewStyle,
    onScroll,
    ...rest
  } = props;

  const wrapRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const frameRef = useRef<number | null>(null);
  const draggingRef = useRef<{
    axis: 'vertical' | 'horizontal';
    startClient: number;
    startScroll: number;
    maxScroll: number;
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

  const rootStyle = useMemo<React.CSSProperties>(() => {
    return {
      ...style,
      height: addUnit(height) || style?.height,
      maxHeight: addUnit(maxHeight) || style?.maxHeight,
    };
  }, [height, maxHeight, style]);

  const update = useCallback(() => {
    const wrap = wrapRef.current;

    if (!wrap) return;

    const { clientHeight, clientWidth, scrollHeight, scrollWidth, scrollTop, scrollLeft } = wrap;

    const hasVertical = scrollHeight > clientHeight + 1;
    const hasHorizontal = scrollWidth > clientWidth + 1;

    const verticalTrackSize = Math.max(0, clientHeight - BAR_OFFSET);
    const horizontalTrackSize = Math.max(0, clientWidth - BAR_OFFSET);

    const verticalSize = hasVertical
      ? Math.max(Math.round((clientHeight * clientHeight) / scrollHeight), MIN_THUMB_SIZE)
      : 0;
    const horizontalSize = hasHorizontal
      ? Math.max(Math.round((clientWidth * clientWidth) / scrollWidth), MIN_THUMB_SIZE)
      : 0;

    const verticalMaxOffset = Math.max(0, verticalTrackSize - verticalSize);
    const horizontalMaxOffset = Math.max(0, horizontalTrackSize - horizontalSize);

    const verticalOffset = hasVertical
      ? Math.round((scrollTop / Math.max(1, scrollHeight - clientHeight)) * verticalMaxOffset)
      : 0;
    const horizontalOffset = hasHorizontal
      ? Math.round((scrollLeft / Math.max(1, scrollWidth - clientWidth)) * horizontalMaxOffset)
      : 0;

    setThumbState({
      verticalSize,
      verticalOffset,
      horizontalSize,
      horizontalOffset,
      verticalVisible: hasVertical,
      horizontalVisible: hasHorizontal,
    });
  }, []);

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

  const scrollTo = useCallback((options: ScrollToOptions | number, y?: number) => {
    const wrap = wrapRef.current;

    if (!wrap) return;

    if (typeof options === 'number') {
      wrap.scrollTo(options, y || 0);
      return;
    }

    wrap.scrollTo(options);
  }, []);

  const setScrollTop = useCallback((value: number) => {
    if (wrapRef.current) {
      wrapRef.current.scrollTop = value;
    }
  }, []);

  const setScrollLeft = useCallback((value: number) => {
    if (wrapRef.current) {
      wrapRef.current.scrollLeft = value;
    }
  }, []);

  useImperativeHandle(ref, () => ({
    wrapRef: wrapRef.current,
    update,
    scrollTo,
    setScrollTop,
    setScrollLeft,
  }), [scrollTo, setScrollLeft, setScrollTop, update]);

  const handleMouseEnter = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    setHovering(true);
    rest.onMouseEnter?.(event);
  }, [rest]);

  const handleMouseLeave = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    setHovering(false);
    rest.onMouseLeave?.(event);
  }, [rest]);

  const startDrag = useCallback((event: React.MouseEvent, axis: 'vertical' | 'horizontal') => {
    const wrap = wrapRef.current;

    if (!wrap) return;

    event.preventDefault();
    event.stopPropagation();

    const trackSize = axis === 'vertical' ? wrap.clientHeight - BAR_OFFSET : wrap.clientWidth - BAR_OFFSET;
    const thumbSize = axis === 'vertical' ? thumbState.verticalSize : thumbState.horizontalSize;

    draggingRef.current = {
      axis,
      startClient: axis === 'vertical' ? event.clientY : event.clientX,
      startScroll: axis === 'vertical' ? wrap.scrollTop : wrap.scrollLeft,
      maxScroll: axis === 'vertical' ? wrap.scrollHeight - wrap.clientHeight : wrap.scrollWidth - wrap.clientWidth,
      maxThumbOffset: Math.max(1, trackSize - thumbSize),
    };

    clearHideTimer();
    setDragging(true);
    setScrolling(true);
  }, [clearHideTimer, thumbState.horizontalSize, thumbState.verticalSize]);

  const handleTrackMouseDown = useCallback((event: React.MouseEvent, axis: 'vertical' | 'horizontal') => {
    const wrap = wrapRef.current;

    if (!wrap || event.target !== event.currentTarget) return;

    event.preventDefault();
    event.stopPropagation();

    const rect = event.currentTarget.getBoundingClientRect();

    if (axis === 'vertical') {
      const offset = event.clientY - rect.top - thumbState.verticalSize / 2;
      const maxThumbOffset = Math.max(1, wrap.clientHeight - BAR_OFFSET - thumbState.verticalSize);
      wrap.scrollTop = (offset / maxThumbOffset) * (wrap.scrollHeight - wrap.clientHeight);
    } else {
      const offset = event.clientX - rect.left - thumbState.horizontalSize / 2;
      const maxThumbOffset = Math.max(1, wrap.clientWidth - BAR_OFFSET - thumbState.horizontalSize);
      wrap.scrollLeft = (offset / maxThumbOffset) * (wrap.scrollWidth - wrap.clientWidth);
    }
  }, [thumbState.horizontalSize, thumbState.verticalSize]);

  useEffect(() => {
    if (!dragging) return undefined;

    const handleMouseMove = (event: MouseEvent) => {
      const dragState = draggingRef.current;
      const wrap = wrapRef.current;

      if (!dragState || !wrap) return;

      const currentClient = dragState.axis === 'vertical' ? event.clientY : event.clientX;
      const delta = currentClient - dragState.startClient;
      const scrollDelta = (delta / dragState.maxThumbOffset) * dragState.maxScroll;

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
    update();
  }, [children, update]);

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

      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [clearHideTimer]);

  const barVisibleClassName = always || hovering || scrolling || dragging ? styles['is-visible'] : '';

  return (
    <div
      {...rest}
      className={[
        styles['scrollbar'],
        native ? styles['is-native'] : '',
        always ? styles['is-always'] : '',
        className || '',
      ].filter(Boolean).join(' ')}
      style={rootStyle}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div
        ref={wrapRef}
        className={[
          styles['scrollbar-wrap'],
          native ? styles['scrollbar-wrap-native'] : '',
          wrapClassName || '',
        ].filter(Boolean).join(' ')}
        onScroll={handleScroll}
      >
        <div
          ref={viewRef}
          className={[
            styles['scrollbar-view'],
            viewClassName || '',
          ].filter(Boolean).join(' ')}
          style={viewStyle}
        >
          {children}
        </div>
      </div>

      {!native && thumbState.verticalVisible && (
        <div
          className={`${styles['scrollbar-bar']} ${styles['scrollbar-bar-vertical']} ${barVisibleClassName}`}
          onMouseDown={(event) => handleTrackMouseDown(event, 'vertical')}
        >
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
