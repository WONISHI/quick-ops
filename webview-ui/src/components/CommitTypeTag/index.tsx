import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './index.module.css';

export type CommitType =
  | 'feat'
  | 'fix'
  | 'docs'
  | 'style'
  | 'refactor'
  | 'perf'
  | 'test'
  | 'chore'
  | 'revert'
  | 'build';

export interface CommitTypeOption {
  value: CommitType;
  label: string;
  description: string;
}

export const COMMIT_TYPE_OPTIONS: CommitTypeOption[] = [
  { value: 'feat', label: 'feat', description: '新功能' },
  { value: 'fix', label: 'fix', description: '修补 bug' },
  { value: 'docs', label: 'docs', description: '文档' },
  { value: 'style', label: 'style', description: '格式（不影响代码运行的变动）' },
  { value: 'refactor', label: 'refactor', description: '重构' },
  { value: 'perf', label: 'perf', description: '性能优化' },
  { value: 'test', label: 'test', description: '测试' },
  { value: 'chore', label: 'chore', description: '构建过程或辅助工具的变动' },
  { value: 'revert', label: 'revert', description: '回退' },
  { value: 'build', label: 'build', description: '打包' },
];

interface CommitTypeTagProps {
  value: CommitType;
  disabled?: boolean;
  onChange: (value: CommitType) => void;
  onOpenChange?: (open: boolean) => void;
}

const CommitTypeTag: React.FC<CommitTypeTagProps> = ({
  value,
  disabled,
  onChange,
  onOpenChange,
}) => {
  const tagRef = useRef<HTMLButtonElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);

  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({
    left: -9999,
    top: -9999,
    arrowLeft: 16,
  });

  const activeOption = useMemo(() => {
    return COMMIT_TYPE_OPTIONS.find((item) => item.value === value) || COMMIT_TYPE_OPTIONS[0];
  }, [value]);

  const setPopupOpen = (nextOpen: boolean) => {
    setOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };

  useLayoutEffect(() => {
    if (!open) return;

    const tagEl = tagRef.current;
    const popupEl = popupRef.current;

    if (!tagEl || !popupEl) return;

    const padding = 8;
    const gap = 8;

    const tagRect = tagEl.getBoundingClientRect();
    const popupRect = popupEl.getBoundingClientRect();
    const tagCenterX = tagRect.left + tagRect.width / 2;

    let left = tagRect.left;
    let top = tagRect.bottom + gap;

    if (left + popupRect.width > window.innerWidth - padding) {
      left = window.innerWidth - popupRect.width - padding;
    }

    if (left < padding) {
      left = padding;
    }

    if (top + popupRect.height > window.innerHeight - padding) {
      top = Math.max(padding, tagRect.top - popupRect.height - gap);
    }

    const arrowLeft = Math.max(14, Math.min(tagCenterX - left - 5, popupRect.width - 24));

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

      if (tagRef.current && tagRef.current.contains(target)) return;
      if (popupRef.current && popupRef.current.contains(target)) return;

      setPopupOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPopupOpen(false);
      }
    };

    const handleWindowResize = () => {
      setPopupOpen(false);
    };

    document.addEventListener('mousedown', handleMouseDown, true);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleWindowResize);

    return () => {
      document.removeEventListener('mousedown', handleMouseDown, true);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleWindowResize);
    };
  }, [open]);

  return (
    <>
      <button
        ref={tagRef}
        type="button"
        disabled={disabled}
        className={`${styles['commit-type-tag']} ${styles[`commit-type-${activeOption.value}`] || ''}`}
        title={`${activeOption.label}: ${activeOption.description}`}
        onMouseDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();

          if (disabled) return;

          setPopupOpen(!open);
        }}
      >
        {activeOption.label}:
      </button>

      {open &&
        createPortal(
          <div
            ref={popupRef}
            className={styles['commit-type-popup']}
            style={{
              left: position.left,
              top: position.top,
            }}
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <span
              className={styles['commit-type-popup-arrow']}
              style={{
                left: position.arrowLeft,
              }}
            />

            {COMMIT_TYPE_OPTIONS.map((item) => {
              const selected = item.value === value;

              return (
                <button
                  key={item.value}
                  type="button"
                  className={`${styles['commit-type-option']} ${selected ? styles['commit-type-option-active'] : ''}`}
                  onClick={() => {
                    onChange(item.value);
                    setPopupOpen(false);
                  }}
                >
                  <span className={`${styles['commit-type-option-badge']} ${styles[`commit-type-${item.value}`] || ''}`}>
                    {item.label}
                  </span>

                  <span className={styles['commit-type-option-desc']}>{item.description}</span>

                  {selected && <i className={`codicon codicon-check ${styles['commit-type-option-check']}`} />}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
};

export default CommitTypeTag;