import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './index.module.css';

type PopupPlacement = 'bottom' | 'top';

interface FilterPopupProps {
    visible: boolean;
    triggerRef: React.RefObject<HTMLElement | null>;
    width?: number;
    onClose: () => void;
    children: React.ReactNode;
}

const VIEWPORT_PADDING = 8;
const TRIGGER_GAP = 8;

const FilterPopup: React.FC<FilterPopupProps> = ({ visible, triggerRef, width, onClose, children }) => {
    const popupRef = useRef<HTMLDivElement>(null);
    const [position, setPosition] = useState({ left: -9999, top: -9999, arrowLeft: 16, placement: 'bottom' as PopupPlacement });
    const [ready, setReady] = useState(false);

    useLayoutEffect(() => {
        if (!visible) {
            setReady(false);
            return;
        }

        const trigger = triggerRef.current;
        const popup = popupRef.current;

        if (!trigger || !popup) return;

        const triggerRect = trigger.getBoundingClientRect();
        const popupRect = popup.getBoundingClientRect();
        const popupWidth = width || popupRect.width;
        const popupHeight = popupRect.height;

        let left = triggerRect.left + triggerRect.width / 2 - popupWidth / 2;
        left = Math.max(VIEWPORT_PADDING, Math.min(left, window.innerWidth - popupWidth - VIEWPORT_PADDING));

        const bottomTop = triggerRect.bottom + TRIGGER_GAP;
        const topTop = triggerRect.top - popupHeight - TRIGGER_GAP;
        const shouldPlaceTop = bottomTop + popupHeight > window.innerHeight - VIEWPORT_PADDING && topTop >= VIEWPORT_PADDING;
        const top = shouldPlaceTop ? topTop : Math.min(bottomTop, window.innerHeight - popupHeight - VIEWPORT_PADDING);

        const triggerCenterX = triggerRect.left + triggerRect.width / 2;
        const arrowLeft = Math.max(12, Math.min(triggerCenterX - left, popupWidth - 12));

        setPosition({
            left,
            top: Math.max(VIEWPORT_PADDING, top),
            arrowLeft,
            placement: shouldPlaceTop ? 'top' : 'bottom',
        });
        setReady(true);
    }, [visible, triggerRef, width, children]);

    useEffect(() => {
        if (!visible) return;

        const handlePointerDown = (event: MouseEvent) => {
            const target = event.target as Node | null;

            if (!target) return;
            if (popupRef.current?.contains(target)) return;
            if (triggerRef.current?.contains(target)) return;

            onClose();
        };

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };

        const handleWindowChange = () => {
            onClose();
        };

        document.addEventListener('mousedown', handlePointerDown, true);
        document.addEventListener('keydown', handleKeyDown);
        window.addEventListener('resize', handleWindowChange);
        window.addEventListener('blur', handleWindowChange);

        return () => {
            document.removeEventListener('mousedown', handlePointerDown, true);
            document.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('resize', handleWindowChange);
            window.removeEventListener('blur', handleWindowChange);
        };
    }, [visible, triggerRef, onClose]);

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

export default FilterPopup;
