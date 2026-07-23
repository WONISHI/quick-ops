import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './index.module.css';

interface FilterPopupProps {
  visible: boolean;
  anchorRef: React.RefObject<HTMLElement | null>;
  width?: number;
  onClose: () => void;
  children: React.ReactNode;
}

type PopupPlacement = 'top' | 'bottom';

const ARROW_SIZE = 10;
const SAFE_PADDING = 8;
const POPUP_GAP = 8;

const FilterPopup: React.FC<FilterPopupProps> = ({
  visible,
  anchorRef,
  width = 240,
  onClose,
  children,
}) => {
  const popupRef = useRef<HTMLDivElement | null>(null);

  const [position, setPosition] = useState({
    left: -9999,
    top: -9999,
    arrowLeft: 18,
    placement: 'bottom' as PopupPlacement,
  });

  useLayoutEffect(() => {
    if (!visible) return;

    const anchorEl = anchorRef.current;
    const popupEl = popupRef.current;

    if (!anchorEl || !popupEl) return;

    const anchorRect = anchorEl.getBoundingClientRect();
    const popupRect = popupEl.getBoundingClientRect();

    /**
     * 关键：
     * anchorRef 必须挂在 filter 图标本身。
     * 这里用图标中心点作为弹窗与箭头定位基准。
     */
    const anchorCenterX = anchorRect.left + anchorRect.width / 2;

    /**
     * 弹窗默认以图标中心点居中。
     */
    let left = anchorCenterX - popupRect.width / 2;
    let top = anchorRect.bottom + POPUP_GAP;
    let placement: PopupPlacement = 'bottom';

    /**
     * 底部空间不够时，向上弹出。
     */
    if (top + popupRect.height > window.innerHeight - SAFE_PADDING) {
      top = anchorRect.top - popupRect.height - POPUP_GAP;
      placement = 'top';
    }

    /**
     * 左右碰撞修正。
     */
    if (left + popupRect.width > window.innerWidth - SAFE_PADDING) {
      left = window.innerWidth - popupRect.width - SAFE_PADDING;
    }

    if (left < SAFE_PADDING) {
      left = SAFE_PADDING;
    }

    /**
     * 关键：
     * arrowLeft 是箭头左上角相对 popup 左边的位置。
     * 所以要减掉箭头一半宽度，保证箭头中心对准图标中心。
     */
    const arrowHalf = ARROW_SIZE / 2;

    const arrowLeft = Math.max(
      12,
      Math.min(
        anchorCenterX - left - arrowHalf,
        popupRect.width - ARROW_SIZE - 12,
      ),
    );

    setPosition({
      left,
      top: Math.max(SAFE_PADDING, top),
      arrowLeft,
      placement,
    });
  }, [visible, anchorRef, width]);

  useEffect(() => {
    if (!visible) return;

    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;

      if (popupRef.current && popupRef.current.contains(target)) return;
      if (anchorRef.current && anchorRef.current.contains(target)) return;

      onClose();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    const handleWindowBlur = () => {
      onClose();
    };

    document.addEventListener('mousedown', handleMouseDown, true);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('blur', handleWindowBlur);

    return () => {
      document.removeEventListener('mousedown', handleMouseDown, true);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [visible, anchorRef, onClose]);

  if (!visible) return null;

  return createPortal(
    <div
      ref={popupRef}
      className={`${styles['filter-popup']} ${styles[`filter-popup-${position.placement}`]}`}
      style={{
        left: position.left,
        top: position.top,
        width,
      }}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
    >
      <span
        className={styles['filter-popup-arrow']}
        style={{
          left: position.arrowLeft,
        }}
      />

      {children}
    </div>,
    document.body,
  );
};

interface FilterPopupInputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

export const FilterPopupInput = React.forwardRef<HTMLInputElement, FilterPopupInputProps>(
  ({ className = '', ...props }, ref) => {
    return (
      <input
        ref={ref}
        {...props}
        className={`${styles['filter-input']} ${className}`}
      />
    );
  },
);

FilterPopupInput.displayName = 'FilterPopupInput';

interface FilterPopupActionsProps {
  children: React.ReactNode;
}

export const FilterPopupActions: React.FC<FilterPopupActionsProps> = ({ children }) => {
  return <div className={styles['filter-actions']}>{children}</div>;
};

interface FilterPopupButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  secondary?: boolean;
}

export const FilterPopupButton: React.FC<FilterPopupButtonProps> = ({
  secondary,
  className = '',
  children,
  ...props
}) => {
  return (
    <button
      {...props}
      className={`${styles['filter-btn']} ${secondary ? styles['filter-btn-secondary'] : ''} ${className}`}
    >
      {children}
    </button>
  );
};

interface FilterPopupDateRowProps {
  label: string;
  children: React.ReactNode;
}

export const FilterPopupDateRow: React.FC<FilterPopupDateRowProps> = ({
  label,
  children,
}) => {
  return (
    <div className={styles['date-filter-row']}>
      <span className={styles['date-filter-label']}>{label}</span>
      {children}
    </div>
  );
};

interface FilterPopupCheckboxListProps {
  children: React.ReactNode;
}

export const FilterPopupCheckboxList: React.FC<FilterPopupCheckboxListProps> = ({
  children,
}) => {
  return <div className={styles['filter-checkbox-list']}>{children}</div>;
};

interface FilterPopupCheckboxLabelProps {
  children: React.ReactNode;
}

export const FilterPopupCheckboxLabel: React.FC<FilterPopupCheckboxLabelProps> = ({
  children,
}) => {
  return <label className={styles['filter-checkbox-label']}>{children}</label>;
};

export default FilterPopup;