import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './index.module.css';

interface GraphMoreMenuProps {
  isSearchOpen: boolean;
  onToggleSearch: () => void;
  onCollapseCommitFiles: () => void;
  triggerClassName?: string;
  activeTriggerClassName?: string;
}

const GraphMoreMenu: React.FC<GraphMoreMenuProps> = ({
  isSearchOpen,
  onToggleSearch,
  onCollapseCommitFiles,
  triggerClassName = '',
  activeTriggerClassName = '',
}) => {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);

  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({
    left: -9999,
    top: -9999,
    arrowLeft: 16,
  });

  useLayoutEffect(() => {
    if (!open) return;

    const triggerEl = triggerRef.current;
    const popupEl = popupRef.current;

    if (!triggerEl || !popupEl) return;

    const padding = 8;
    const gap = 8;

    const triggerRect = triggerEl.getBoundingClientRect();
    const popupRect = popupEl.getBoundingClientRect();
    const triggerCenterX = triggerRect.left + triggerRect.width / 2;

    let left = triggerRect.right - popupRect.width;
    let top = triggerRect.bottom + gap;

    if (left + popupRect.width > window.innerWidth - padding) {
      left = window.innerWidth - popupRect.width - padding;
    }

    if (left < padding) {
      left = padding;
    }

    if (top + popupRect.height > window.innerHeight - padding) {
      top = Math.max(padding, triggerRect.top - popupRect.height - gap);
    }

    const arrowLeft = Math.max(14, Math.min(triggerCenterX - left - 5, popupRect.width - 24));

    setPosition({
      left,
      top,
      arrowLeft,
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;

      if (triggerRef.current && triggerRef.current.contains(target)) return;
      if (popupRef.current && popupRef.current.contains(target)) return;

      setOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    const handleResize = () => {
      setOpen(false);
    };

    document.addEventListener('mousedown', handleMouseDown, true);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleResize);

    return () => {
      document.removeEventListener('mousedown', handleMouseDown, true);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleResize);
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        className={`${triggerClassName} ${open ? activeTriggerClassName : ''}`}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((prev) => !prev);
        }}
      >
        <i className="codicon codicon-kebab-vertical" />
      </button>

      {open &&
        createPortal(
          <div
            ref={popupRef}
            className={styles['graph-more-popup']}
            style={{
              left: position.left,
              top: position.top,
            }}
            onMouseDown={(event) => {
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <span
              className={styles['graph-more-arrow']}
              style={{
                left: position.arrowLeft,
              }}
            />

            <button
              className={styles['graph-more-item']}
              onClick={() => {
                onCollapseCommitFiles();
                setOpen(false);
              }}
            >
              <i className={`codicon codicon-fold ${styles['graph-more-icon']}`} />
              <span className={styles['graph-more-text']}>折叠提交文件</span>
            </button>

            <button
              className={`${styles['graph-more-item']} ${isSearchOpen ? styles['graph-more-item-active'] : ''}`}
              onClick={() => {
                onToggleSearch();
                setOpen(false);
              }}
            >
              <i className={`codicon codicon-search ${styles['graph-more-icon']}`} />
              <span className={styles['graph-more-text']}>
                {isSearchOpen ? '关闭查询提交' : '查询提交'}
              </span>
            </button>
          </div>,
          document.body,
        )}
    </>
  );
};

export default GraphMoreMenu;