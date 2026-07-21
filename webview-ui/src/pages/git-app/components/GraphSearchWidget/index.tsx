import React, { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import styles from '@pages/git-app/components/GraphSearchWidget/index.module.css';
import type { GraphSearchWidgetProps, SearchOffset, DragStart } from '@/pages/git-app/components/GraphSearchWidget/src/type';

const GraphSearchWidget: React.FC<GraphSearchWidgetProps> = ({
  isSearchOpen,
  setIsSearchOpen,
  searchQuery,
  setSearchQuery,
  currentMatchIndex,
  setCurrentMatchIndex,
  matchedIndices,
  handlePrevMatch,
  handleNextMatch,
  anchorRef,
}) => {
  const widgetRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const isDragging = useRef(false);
  const searchOffsetRef = useRef<SearchOffset>({
    x: 0,
    y: 0,
  });
  const dragStart = useRef<DragStart>({
    mouseX: 0,
    mouseY: 0,
    currentX: 0,
    currentY: 0,
  });

  const focusTimerRef = useRef<number | null>(null);
  const focusFrameRef = useRef<number | null>(null);

  /**
   * @description 清理输入框聚焦任务
   */
  const clearFocusTasks = useCallback(() => {
    if (focusFrameRef.current !== null) {
      cancelAnimationFrame(focusFrameRef.current);
      focusFrameRef.current = null;
    }

    if (focusTimerRef.current !== null) {
      window.clearTimeout(focusTimerRef.current);
      focusTimerRef.current = null;
    }
  }, []);

  /**
   * @description 聚焦并选中搜索输入框
   */
  const focusSearchInput = useCallback(() => {
    clearFocusTasks();

    focusFrameRef.current = requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();

      focusTimerRef.current = window.setTimeout(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }, 0);
    });
  }, [clearFocusTasks]);

  /**
   * @description 更新搜索框的 transform
   *
   * 拖动位置只作用于 DOM，不需要触发 React 重渲染。
   */
  const updateWidgetTransform = useCallback(() => {
    const widget = widgetRef.current;

    if (!widget) return;

    const { x, y } = searchOffsetRef.current;

    widget.style.transform = `translate(calc(-50% + ${x}px), ${y}px)`;
  }, []);

  /**
   * @description 根据锚点更新搜索框顶部位置
   *
   * 这里直接同步外部 DOM，不在 Effect 中同步调用 setState。
   */
  const updateWidgetPosition = useCallback(() => {
    const widget = widgetRef.current;
    const anchor = anchorRef.current;

    if (!widget || !anchor) {
      return;
    }

    const rect = anchor.getBoundingClientRect();

    widget.style.top = `${rect.top + 8}px`;
    widget.style.visibility = 'visible';

    updateWidgetTransform();
  }, [anchorRef, updateWidgetTransform]);

  /**
   * @description 搜索框挂载时初始化位置和拖动偏移
   */
  const setWidgetRef = useCallback(
    (node: HTMLDivElement | null) => {
      widgetRef.current = node;

      if (!node) return;

      searchOffsetRef.current = {
        x: 0,
        y: 0,
      };

      node.style.visibility = 'hidden';

      updateWidgetPosition();
    },
    [updateWidgetPosition],
  );

  useEffect(() => {
    if (!isSearchOpen) return;

    const handleResize = () => {
      updateWidgetPosition();
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [isSearchOpen, updateWidgetPosition]);

  useLayoutEffect(() => {
    if (!isSearchOpen) return;

    focusSearchInput();

    return clearFocusTasks;
  }, [isSearchOpen, focusSearchInput, clearFocusTasks]);

  const handleMouseMove = useCallback(
    (event: MouseEvent) => {
      if (!isDragging.current) {
        return;
      }

      const dx = event.clientX - dragStart.current.mouseX;
      const dy = event.clientY - dragStart.current.mouseY;

      searchOffsetRef.current = {
        x: dragStart.current.currentX + dx,
        y: dragStart.current.currentY + dy,
      };

      updateWidgetTransform();
    },
    [updateWidgetTransform],
  );

  const handleMouseUp = useCallback(() => {
    isDragging.current = false;

    document.removeEventListener('mousemove', handleMouseMove);
  }, [handleMouseMove]);

  const handleMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement;

      if (target.tagName.toLowerCase() === 'input' || target.closest('button')) {
        return;
      }

      event.preventDefault();

      isDragging.current = true;

      dragStart.current = {
        mouseX: event.clientX,
        mouseY: event.clientY,
        currentX: searchOffsetRef.current.x,
        currentY: searchOffsetRef.current.y,
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp, {
        once: true,
      });
    },
    [handleMouseMove, handleMouseUp],
  );

  /**
   * @description 组件卸载时清理全局事件和聚焦任务
   */
  useEffect(() => {
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);

      clearFocusTasks();
    };
  }, [handleMouseMove, handleMouseUp, clearFocusTasks]);

  if (!isSearchOpen) {
    return null;
  }

  return (
    <div
      ref={setWidgetRef}
      className={styles['search-widget']}
      style={{
        top: '-9999px',
        visibility: 'hidden',
        cursor: 'grab',
      }}
      onMouseDown={handleMouseDown}
    >
      <div className={styles['search-gripper']}>
        <i className="codicon codicon-gripper" />
      </div>

      <input
        ref={searchInputRef}
        className={styles['search-input']}
        placeholder="搜索提交..."
        value={searchQuery}
        style={{
          cursor: 'text',
        }}
        onChange={(event) => {
          setSearchQuery(event.target.value);
          setCurrentMatchIndex(0);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();

            if (event.shiftKey) {
              handlePrevMatch();
            } else {
              handleNextMatch();
            }

            return;
          }

          if (event.key === 'Escape') {
            setIsSearchOpen(false);
          }
        }}
      />

      <div
        className={styles['search-count']}
        style={{
          cursor: 'default',
        }}
      >
        {matchedIndices.length > 0 ? currentMatchIndex + 1 : 0}/{matchedIndices.length}
      </div>

      <button
        type="button"
        className={styles['search-btn']}
        onClick={handlePrevMatch}
        disabled={matchedIndices.length === 0}
        title="上一个 (Shift+Enter)"
        style={{
          cursor: 'pointer',
        }}
      >
        <i className="codicon codicon-arrow-up" />
      </button>

      <button
        type="button"
        className={styles['search-btn']}
        onClick={handleNextMatch}
        disabled={matchedIndices.length === 0}
        title="下一个 (Enter)"
        style={{
          cursor: 'pointer',
        }}
      >
        <i className="codicon codicon-arrow-down" />
      </button>

      <button
        type="button"
        className={styles['search-btn']}
        onClick={() => {
          setIsSearchOpen(false);
        }}
        title="关闭 (Esc)"
        style={{
          cursor: 'pointer',
        }}
      >
        <i className="codicon codicon-close" />
      </button>
    </div>
  );
};

export default GraphSearchWidget;
