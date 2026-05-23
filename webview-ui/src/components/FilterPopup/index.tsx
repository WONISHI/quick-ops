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

    const padding = 8;
    const gap = 8;

    const anchorRect = anchorEl.getBoundingClientRect();
    const popupRect = popupEl.getBoundingClientRect();

    let left = anchorRect.left + anchorRect.width / 2 - popupRect.width / 2;
    let top = anchorRect.bottom + gap;
    let placement: PopupPlacement = 'bottom';

    if (top + popupRect.height > window.innerHeight - padding) {
      top = anchorRect.top - popupRect.height - gap;
      placement = 'top';
    }

    if (left + popupRect.width > window.innerWidth - padding) {
      left = window.innerWidth - popupRect.width - padding;
    }

    if (left < padding) {
      left = padding;
    }

    const anchorCenter = anchorRect.left + anchorRect.width / 2;
    const arrowLeft = Math.max(14, Math.min(anchorCenter - left, popupRect.width - 14));

    setPosition({
      left,
      top: Math.max(padding, top),
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

    const handleBlur = () => {
      onClose();
    };

    document.addEventListener('mousedown', handleMouseDown, true);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('blur', handleBlur);

    return () => {
      document.removeEventListener('mousedown', handleMouseDown, true);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('blur', handleBlur);
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

export const FilterPopupDateRow: React.FC<FilterPopupDateRowProps> = ({ label, children }) => {
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

export const FilterPopupCheckboxList: React.FC<FilterPopupCheckboxListProps> = ({ children }) => {
  return <div className={styles['filter-checkbox-list']}>{children}</div>;
};

interface FilterPopupCheckboxLabelProps {
  children: React.ReactNode;
}

export const FilterPopupCheckboxLabel: React.FC<FilterPopupCheckboxLabelProps> = ({ children }) => {
  return <label className={styles['filter-checkbox-label']}>{children}</label>;
};

export default FilterPopup;