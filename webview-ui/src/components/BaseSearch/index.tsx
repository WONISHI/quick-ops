import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';

import styles from './index.module.css';

export type BaseSearchDirection = 'prev' | 'next';

export type BaseSearchPosition = 'top' | 'bottom';

export type BaseSearchSize = number | string;

export interface BaseSearchResult {
  /**
   * @description 当前结果序号，从 1 开始；没有结果时为 0
   */
  current: number;

  /**
   * @description 匹配结果总数
   */
  total: number;

  /**
   * @description 结果对应的关键词，用于忽略异步返回的旧结果
   */
  query?: string;
}

export interface BaseSearchRenderProps {
  /**
   * @description 当前搜索关键词
   */
  query: string;

  /**
   * @description 匹配结果总数
   */
  total: number;

  /**
   * @description 当前激活结果下标
   */
  activeIndex: number;

  /**
   * @description 搜索框固定位置
   */
  searchPosition: BaseSearchPosition;

  /**
   * @description 搜索框标准化后的高度
   */
  size: string;

  /**
   * @description 当前是否允许拖拽
   */
  draggable: boolean;

  /**
   * @description 渲染带搜索高亮的文本
   */
  renderHighlightedText: (text: string) => ReactNode;
}

export interface BaseSearchProps {
  /**
   * @description 是否显示悬浮搜索框
   */
  open: boolean;

  /**
   * @description 被搜索的完整文本
   */
  text?: string;

  /**
   * @description 搜索框关闭事件
   */
  onClose: () => void;

  /**
   * @description 自定义搜索区域内容
   */
  children?: (context: BaseSearchRenderProps) => ReactNode;

  /**
   * @description 是否只渲染悬浮搜索框，不包裹内容区域
   *
   * 适用于网页查找等由外部负责搜索的场景。
   *
   * @default false
   */
  standalone?: boolean;

  /**
   * @description 外部搜索结果
   *
   * 传入后，结果数量和当前位置由外部控制。
   */
  result?: BaseSearchResult;

  /**
   * @description 执行搜索或切换上一个、下一个结果
   */
  onSearch?: (query: string, direction: BaseSearchDirection) => void;

  /**
   * @description 是否显示上一个、下一个按钮
   *
   * @default true
   */
  showNavigation?: boolean;

  /**
   * @description 自定义结果数量文本
   */
  formatCount?: (current: number, total: number, query: string) => ReactNode;

  /**
   * @description 搜索容器类名
   */
  className?: string;

  /**
   * @description 搜索容器样式
   */
  style?: CSSProperties;

  /**
   * @description 输入框占位文本
   */
  placeholder?: string;

  /**
   * @description 搜索框最大宽度
   */
  maxWidth?: number | string;

  /**
   * @description 搜索框高度
   *
   * 数字会自动转换为 px，也支持 CSS 尺寸字符串。
   *
   * @example
   * size={34}
   * size="2.25rem"
   *
   * @default 34
   */
  size?: BaseSearchSize;

  /**
   * @description 是否区分大小写
   */
  caseSensitive?: boolean;

  /**
   * @description 是否允许拖拽
   *
   * @default false
   */
  draggable?: boolean;

  /**
   * @description 搜索框固定位置
   *
   * draggable 为 false 时固定在顶部或底部；
   * draggable 为 true 时作为初始停靠位置。
   *
   * @default 'top'
   */
  searchPosition?: BaseSearchPosition;

  /**
   * @description 搜索框初始偏移量
   *
   * 仅在组件首次创建时生效。
   */
  initialOffset?: Partial<BaseSearchOffset>;

  /**
   * @description 关闭搜索框时是否重置拖拽位置
   *
   * @default true
   */
  resetOffsetOnClose?: boolean;

  /**
   * @description 拖拽结束事件
   */
  onDragEnd?: (offset: BaseSearchOffset) => void;

  /**
   * @description 打开后是否自动聚焦
   */
  autoFocus?: boolean;

  /**
   * @description 搜索关键词变化事件
   */
  onQueryChange?: (query: string) => void;
}

interface SearchCursor {
  query: string;
  text: string;
  caseSensitive: boolean;
  index: number;
}

export interface BaseSearchOffset {
  x: number;
  y: number;
}

interface SearchDragStart {
  x: number;
  y: number;
  offsetX: number;
  offsetY: number;
  containerLeft: number;
  containerTop: number;
  containerRight: number;
  containerBottom: number;
  barLeft: number;
  barTop: number;
  barWidth: number;
  barHeight: number;
}

/**
 * @description 将数值限制在指定范围内
 */
function clampNumber(value: number, min: number, max: number): number {
  const safeMax = Math.max(min, max);

  return Math.min(Math.max(value, min), safeMax);
}

/**
 * @description 将尺寸转换为 CSS 值
 */
function normalizeSize(value?: number | string): string | undefined {
  return typeof value === 'number' ? `${value}px` : value;
}

/**
 * @description 通用悬浮搜索组件
 *
 * 负责：
 * - 搜索关键词状态
 * - 匹配位置计算
 * - 上一个/下一个跳转
 * - 当前结果自动滚动
 * - 搜索框拖拽
 * - 文本匹配高亮
 */
export default function BaseSearch({
  open,
  text = '',
  onClose,
  children,
  standalone = false,
  result,
  onSearch,
  showNavigation = true,
  formatCount,
  className,
  style,
  placeholder = '搜索...',
  maxWidth = 'none',
  size = 34,
  caseSensitive = false,
  draggable = false,
  searchPosition = 'top',
  initialOffset,
  resetOffsetOnClose = true,
  onDragEnd,
  autoFocus = true,
  onQueryChange,
}: BaseSearchProps) {
  const [query, setQuery] = useState('');

  const [searchCursor, setSearchCursor] = useState<SearchCursor>({
    query: '',
    text: '',
    caseSensitive,
    index: 0,
  });

  const [searchBarOffset, setSearchBarOffset] = useState<BaseSearchOffset>(() => ({
    x: initialOffset?.x || 0,
    y: initialOffset?.y || 0,
  }));

  const [isDragging, setIsDragging] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);

  const searchBarRef = useRef<HTMLDivElement | null>(null);

  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const searchBarOffsetRef = useRef(searchBarOffset);

  const searchDragStartRef = useRef<SearchDragStart>({
    x: 0,
    y: 0,
    offsetX: 0,
    offsetY: 0,
    containerLeft: 0,
    containerTop: 0,
    containerRight: 0,
    containerBottom: 0,
    barLeft: 0,
    barTop: 0,
    barWidth: 0,
    barHeight: 0,
  });

  const normalizedQuery = query.trim();

  const normalizedSearchSize = normalizeSize(size) || '34px';

  const containerStyle = {
    ...style,
    '--base-search-size': normalizedSearchSize,
  } as CSSProperties & {
    '--base-search-size': string;
  };

  /**
   * @description 计算全部搜索匹配位置
   */
  const matches = useMemo(() => {
    if (!normalizedQuery || !text) {
      return [];
    }

    const searchText = caseSensitive ? text : text.toLowerCase();

    const searchQuery = caseSensitive ? normalizedQuery : normalizedQuery.toLowerCase();

    const result: number[] = [];
    let startIndex = 0;

    while (startIndex <= searchText.length) {
      const matchIndex = searchText.indexOf(searchQuery, startIndex);

      if (matchIndex === -1) break;

      result.push(matchIndex);

      startIndex = matchIndex + Math.max(searchQuery.length, 1);
    }

    return result;
  }, [caseSensitive, normalizedQuery, text]);

  const internalTotal = matches.length;

  const isExternalResultCurrent = typeof result?.query !== 'string' || result.query.trim() === normalizedQuery;

  const externalTotal = isExternalResultCurrent ? Math.max(0, Math.trunc(Number(result?.total) || 0)) : 0;

  const total = result ? externalTotal : internalTotal;

  const isCurrentSearchCursor = searchCursor.query === normalizedQuery && searchCursor.text === text && searchCursor.caseSensitive === caseSensitive;

  const currentSearchIndex = isCurrentSearchCursor ? searchCursor.index : 0;

  const externalCurrent = total ? clampNumber(Math.trunc(Number(result?.current) || 0), 0, total) : 0;

  const activeIndex = result ? Math.max(0, externalCurrent - 1) : total ? Math.min(currentSearchIndex, total - 1) : 0;

  const current = normalizedQuery && total ? (result ? externalCurrent : activeIndex + 1) : 0;

  const floating = standalone || draggable;

  /**
   * @description 同步搜索框偏移量引用
   */
  useEffect(() => {
    searchBarOffsetRef.current = searchBarOffset;
  }, [searchBarOffset]);

  /**
   * @description 打开搜索框后自动聚焦
   */
  useEffect(() => {
    if (!open || !autoFocus) return;

    const timer = window.setTimeout(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [autoFocus, open]);

  /**
   * @description 外部关闭搜索框时同步清空内部关键词
   */
  useEffect(() => {
    if (open || !query) return;

    setQuery('');
  }, [open, query]);

  /**
   * @description 当前结果变化后滚动到可视区域
   */
  useEffect(() => {
    if (!open || total === 0) return;

    const timer = window.setTimeout(() => {
      const activeElement = containerRef.current?.querySelector('[data-floating-search-active="true"]') as HTMLElement | null;

      activeElement?.scrollIntoView({
        block: 'center',
        inline: 'nearest',
      });
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [activeIndex, normalizedQuery, open, text, total]);

  /**
   * @description 关闭并重置悬浮搜索
   */
  const handleClose = useCallback(() => {
    setQuery('');

    setSearchCursor({
      query: '',
      text,
      caseSensitive,
      index: 0,
    });

    if (resetOffsetOnClose) {
      const resetOffset = {
        x: initialOffset?.x || 0,
        y: initialOffset?.y || 0,
      };

      searchBarOffsetRef.current = resetOffset;

      setSearchBarOffset(resetOffset);
    }

    setIsDragging(false);

    onQueryChange?.('');
    onClose();
  }, [caseSensitive, initialOffset?.x, initialOffset?.y, onClose, onQueryChange, resetOffsetOnClose, text]);

  /**
   * @description 清空关键词并保留搜索框焦点
   */
  const handleClear = useCallback(() => {
    setQuery('');

    setSearchCursor({
      query: '',
      text,
      caseSensitive,
      index: 0,
    });

    onQueryChange?.('');
    onSearch?.('', 'next');

    searchInputRef.current?.focus();
  }, [caseSensitive, onQueryChange, onSearch, text]);

  /**
   * @description 跳转到上一个或下一个结果
   */
  const jumpMatch = useCallback(
    (direction: BaseSearchDirection) => {
      if (!normalizedQuery) return;

      if (result) {
        onSearch?.(normalizedQuery, direction);
        return;
      }

      if (total === 0) return;

      setSearchCursor((current) => {
        const isCurrent = current.query === normalizedQuery && current.text === text && current.caseSensitive === caseSensitive;

        const currentIndex = isCurrent ? Math.min(current.index, total - 1) : 0;

        const nextIndex = direction === 'prev' ? (currentIndex <= 0 ? total - 1 : currentIndex - 1) : currentIndex >= total - 1 ? 0 : currentIndex + 1;

        return {
          query: normalizedQuery,
          text,
          caseSensitive,
          index: nextIndex,
        };
      });
    },
    [caseSensitive, normalizedQuery, onSearch, result, text, total],
  );

  /**
   * @description 开始拖拽搜索框
   */
  const handlePointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (!draggable) return;

    event.preventDefault();
    event.stopPropagation();

    const containerElement = containerRef.current;

    const searchBarElement = searchBarRef.current;

    if (!containerElement || !searchBarElement) {
      return;
    }

    const containerRect = containerElement.getBoundingClientRect();

    const searchBarRect = searchBarElement.getBoundingClientRect();

    searchDragStartRef.current = {
      x: event.clientX,
      y: event.clientY,
      offsetX: searchBarOffsetRef.current.x,
      offsetY: searchBarOffsetRef.current.y,
      containerLeft: containerRect.left,
      containerTop: containerRect.top,
      containerRight: containerRect.right,
      containerBottom: containerRect.bottom,
      barLeft: searchBarRect.left,
      barTop: searchBarRect.top,
      barWidth: searchBarRect.width,
      barHeight: searchBarRect.height,
    };

    setIsDragging(true);
  };

  /**
   * @description 监听搜索框拖拽
   */
  useEffect(() => {
    if (!isDragging) return;

    const handlePointerMove = (event: PointerEvent) => {
      event.preventDefault();

      const start = searchDragStartRef.current;

      const nextLeft = start.barLeft + event.clientX - start.x;

      const nextTop = start.barTop + event.clientY - start.y;

      const maxLeft = start.containerRight - start.barWidth;

      const maxTop = start.containerBottom - start.barHeight;

      const safeLeft = clampNumber(nextLeft, start.containerLeft, maxLeft);

      const safeTop = clampNumber(nextTop, start.containerTop, maxTop);

      const nextOffset = {
        x: start.offsetX + safeLeft - start.barLeft,
        y: start.offsetY + safeTop - start.barTop,
      };

      searchBarOffsetRef.current = nextOffset;

      setSearchBarOffset(nextOffset);
    };

    const handlePointerEnd = () => {
      setIsDragging(false);

      onDragEnd?.(searchBarOffsetRef.current);
    };

    window.addEventListener('pointermove', handlePointerMove, {
      passive: false,
    });

    window.addEventListener('pointerup', handlePointerEnd);

    window.addEventListener('pointercancel', handlePointerEnd);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);

      window.removeEventListener('pointerup', handlePointerEnd);

      window.removeEventListener('pointercancel', handlePointerEnd);
    };
  }, [isDragging, onDragEnd]);

  /**
   * @description 渲染带搜索高亮的文本
   */
  const renderHighlightedText = useCallback(
    (sourceText: string): ReactNode => {
      if (!open || !normalizedQuery || total === 0) {
        return sourceText;
      }

      const nodes: ReactNode[] = [];
      const queryLength = normalizedQuery.length;

      let lastIndex = 0;

      matches.forEach((matchIndex, index) => {
        if (matchIndex > lastIndex) {
          nodes.push(sourceText.slice(lastIndex, matchIndex));
        }

        const isActive = index === activeIndex;

        nodes.push(
          <mark
            key={`${matchIndex}-${index}`}
            className={[styles.mark, isActive ? styles['mark-active'] : ''].filter(Boolean).join(' ')}
            data-floating-search-active={isActive ? 'true' : undefined}
          >
            {sourceText.slice(matchIndex, matchIndex + queryLength)}
          </mark>,
        );

        lastIndex = matchIndex + queryLength;
      });

      if (lastIndex < sourceText.length) {
        nodes.push(sourceText.slice(lastIndex));
      }

      return nodes;
    },
    [activeIndex, matches, normalizedQuery, open, total],
  );

  const content = children?.({
    query,
    total,
    activeIndex,
    searchPosition,
    size: normalizedSearchSize,
    draggable,
    renderHighlightedText,
  });

  const countContent = formatCount
    ? formatCount(current, total, query)
    : normalizedQuery
      ? `${current}/${total}`
      : '0/0';

  return (
    <div
      ref={containerRef}
      className={[
        styles.container,
        standalone ? styles['container-standalone'] : '',
        floating ? styles['container-draggable'] : styles[`container-${searchPosition}`],
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      style={containerStyle}
    >
      {open && (
        <div
          ref={searchBarRef}
          className={[
            styles.bar,
            floating ? styles['bar-draggable'] : styles['bar-fixed'],
            floating ? styles[`bar-draggable-${searchPosition}`] : '',
            isDragging ? styles['bar-dragging'] : '',
          ]
            .filter(Boolean)
            .join(' ')}
          style={{
            maxWidth: normalizeSize(maxWidth),
            transform: floating ? `translate(${searchBarOffset.x}px, ${searchBarOffset.y}px)` : undefined,
          }}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          {draggable && <i className={`codicon codicon-gripper ${styles.grip}`} title="拖拽搜索框" onPointerDown={handlePointerDown} />}

          <input
            ref={searchInputRef}
            value={query}
            placeholder={placeholder}
            aria-label={placeholder}
            onChange={(event) => {
              const value = event.target.value;

              setQuery(value);

              setSearchCursor({
                query: value.trim(),
                text,
                caseSensitive,
                index: 0,
              });

              onQueryChange?.(value);
              onSearch?.(value, 'next');
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();

                jumpMatch(event.shiftKey ? 'prev' : 'next');
              }

              if (event.key === 'Escape') {
                event.preventDefault();
                handleClose();
              }
            }}
          />

          {query && (
            <button type="button" className={`${styles.button} ${styles['clear-button']}`} title="清空关键词" onClick={handleClear}>
              <i className="codicon codicon-close" />
            </button>
          )}

          <span className={[styles.count, normalizedQuery && total === 0 ? styles['count-empty'] : ''].filter(Boolean).join(' ')}>{countContent}</span>

          {showNavigation && (
            <>
              <button
                type="button"
                className={styles.button}
                title="上一个"
                disabled={!normalizedQuery || (!result && total === 0)}
                onClick={() => {
                  jumpMatch('prev');
                }}
              >
                <i className="codicon codicon-arrow-up" />
              </button>

              <button
                type="button"
                className={styles.button}
                title="下一个"
                disabled={!normalizedQuery || (!result && total === 0)}
                onClick={() => {
                  jumpMatch('next');
                }}
              >
                <i className="codicon codicon-arrow-down" />
              </button>
            </>
          )}

          <button type="button" className={styles.button} title="关闭搜索" onClick={handleClose}>
            <i className="codicon codicon-close" />
          </button>
        </div>
      )}

      {!standalone && <div className={styles.content}>{content}</div>}
    </div>
  );
}
