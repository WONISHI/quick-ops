import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
export type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right';
export type TooltipTrigger = 'hover' | 'click';
export type TooltipAlign = 'start' | 'center' | 'end';
export type TooltipTextAlign = 'left' | 'center' | 'right' | 'justify';

export interface TooltipProps {
    content: React.ReactNode;
    children: React.ReactElement<any>;
    placement?: TooltipPlacement;
    trigger?: TooltipTrigger;
    align?: TooltipAlign;
    textAlign?: TooltipTextAlign;
    showArrow?: boolean;
}

const Tooltip: React.FC<TooltipProps> = ({
    content,
    children,
    placement = 'top',
    trigger = 'hover',
    align = 'center',
    textAlign = 'left',
    showArrow = true,
}) => {
    const [visible, setVisible] = useState(false);
    const [opacity, setOpacity] = useState(0);
    const [position, setPosition] = useState({ left: -9999, top: -9999 });
    const [arrowStyle, setArrowStyle] = useState<React.CSSProperties>({});

    const timerRef = useRef<any>(null);
    const tooltipRef = useRef<HTMLDivElement>(null);
    const targetRef = useRef<HTMLElement | null>(null);

    const showTooltip = () => {
        if (!content) return;
        if (trigger === 'hover') {
            clearTimeout(timerRef.current);
            timerRef.current = setTimeout(() => setVisible(true), 300);
        } else {
            setVisible(true);
        }
    };

    const hideTooltip = () => {
        clearTimeout(timerRef.current);
        setVisible(false);
        setOpacity(0);
    };

    const toggleTooltip = () => {
        if (visible) hideTooltip();
        else showTooltip();
    };

    useEffect(() => {
        const handleOutsideClick = (e: MouseEvent) => {
            if (
                trigger === 'click' && 
                visible &&
                tooltipRef.current && !tooltipRef.current.contains(e.target as Node) &&
                targetRef.current && !targetRef.current.contains(e.target as Node)
            ) {
                hideTooltip();
            }
        };

        const handleScrollOrResize = () => {
            if (visible) hideTooltip();
        };

        document.addEventListener('mousedown', handleOutsideClick);
        window.addEventListener('wheel', handleScrollOrResize, { passive: true });
        window.addEventListener('resize', handleScrollOrResize);

        return () => {
            document.removeEventListener('mousedown', handleOutsideClick);
            window.removeEventListener('wheel', handleScrollOrResize);
            window.removeEventListener('resize', handleScrollOrResize);
        };
    }, [visible, trigger]);

    useLayoutEffect(() => {
        if (visible && tooltipRef.current && targetRef.current && opacity === 0) {
            const target = targetRef.current.getBoundingClientRect();
            const tooltip = tooltipRef.current.getBoundingClientRect();
            const gap = showArrow ? 8 : 4;

            let actualPlacement = placement;

            if (placement === 'top' && target.top - tooltip.height - gap < 0 && window.innerHeight - target.bottom > tooltip.height + gap) {
                actualPlacement = 'bottom';
            } 
            else if (placement === 'bottom' && target.bottom + tooltip.height + gap > window.innerHeight && target.top > tooltip.height + gap) {
                actualPlacement = 'top';
            } 
            else if (placement === 'left' && target.left - tooltip.width - gap < 0 && window.innerWidth - target.right > tooltip.width + gap) {
                actualPlacement = 'right';
            } 
            else if (placement === 'right' && target.right + tooltip.width + gap > window.innerWidth && target.left > tooltip.width + gap) {
                actualPlacement = 'left';
            }

            let x = 0;
            let y = 0;

            if (actualPlacement === 'top' || actualPlacement === 'bottom') {
                y = actualPlacement === 'top' ? target.top - tooltip.height - gap : target.bottom + gap;
                if (align === 'start') x = target.left;
                else if (align === 'end') x = target.right - tooltip.width;
                else x = target.left + target.width / 2 - tooltip.width / 2;
            } else {
                x = actualPlacement === 'left' ? target.left - tooltip.width - gap : target.right + gap;
                if (align === 'start') y = target.top;
                else if (align === 'end') y = target.bottom - tooltip.height;
                else y = target.top + target.height / 2 - tooltip.height / 2;
            }

            const padding = 8;
            if (x < padding) x = padding;
            if (x + tooltip.width > window.innerWidth - padding) x = window.innerWidth - padding - tooltip.width;
            if (y < padding) y = padding;
            if (y + tooltip.height > window.innerHeight - padding) y = window.innerHeight - padding - tooltip.height;

            setPosition({ left: x, top: y });

            if (showArrow) {
                const aStyle: React.CSSProperties = {
                    position: 'absolute',
                    width: '8px',
                    height: '8px',
                    backgroundColor: 'var(--vscode-editorHoverWidget-background)',
                };
                const arrowOffset = -4; 

                if (actualPlacement === 'top' || actualPlacement === 'bottom') {
                    let arrowX = (target.left + target.width / 2) - x;
                    arrowX = Math.max(8, Math.min(tooltip.width - 8, arrowX));
                    
                    aStyle.left = arrowX;
                    aStyle.transform = 'translateX(-50%) rotate(45deg)';

                    if (actualPlacement === 'top') {
                        aStyle.bottom = arrowOffset;
                        aStyle.borderBottom = '1px solid var(--vscode-editorHoverWidget-border)';
                        aStyle.borderRight = '1px solid var(--vscode-editorHoverWidget-border)';
                    } else {
                        aStyle.top = arrowOffset;
                        aStyle.borderTop = '1px solid var(--vscode-editorHoverWidget-border)';
                        aStyle.borderLeft = '1px solid var(--vscode-editorHoverWidget-border)';
                    }
                } else {
                    let arrowY = (target.top + target.height / 2) - y;
                    arrowY = Math.max(8, Math.min(tooltip.height - 8, arrowY));
                    
                    aStyle.top = arrowY;
                    aStyle.transform = 'translateY(-50%) rotate(45deg)';

                    if (actualPlacement === 'left') {
                        aStyle.right = arrowOffset;
                        aStyle.borderTop = '1px solid var(--vscode-editorHoverWidget-border)';
                        aStyle.borderRight = '1px solid var(--vscode-editorHoverWidget-border)';
                    } else {
                        aStyle.left = arrowOffset;
                        aStyle.borderBottom = '1px solid var(--vscode-editorHoverWidget-border)';
                        aStyle.borderLeft = '1px solid var(--vscode-editorHoverWidget-border)';
                    }
                }
                setArrowStyle(aStyle);
            }

            requestAnimationFrame(() => setOpacity(1));
        }
    }, [visible, opacity, placement, align, showArrow]);

    const childProps = children.props as any;

    return (
        <>
            {React.cloneElement(children, {
                ref: (node: HTMLElement) => {
                    targetRef.current = node;
                    if (typeof childProps.ref === 'function') childProps.ref(node);
                    else if (childProps.ref) childProps.ref.current = node;
                },
                onMouseEnter: (e: React.MouseEvent) => {
                    if (trigger === 'hover') showTooltip();
                    if (childProps.onMouseEnter) childProps.onMouseEnter(e);
                },
                onMouseLeave: (e: React.MouseEvent) => {
                    if (trigger === 'hover') hideTooltip();
                    if (childProps.onMouseLeave) childProps.onMouseLeave(e);
                },
                onClick: (e: React.MouseEvent) => {
                    if (trigger === 'click') toggleTooltip();
                    if (childProps.onClick) childProps.onClick(e);
                },
                title: undefined 
            } as any)}
            
            {visible && (
                <div
                    ref={tooltipRef}
                    style={{
                        position: 'fixed',
                        top: position.top,
                        left: position.left,
                        opacity: opacity,
                        transition: 'opacity 0.15s ease-in-out',
                        backgroundColor: 'var(--vscode-editorHoverWidget-background)',
                        border: '1px solid var(--vscode-editorHoverWidget-border)',
                        color: 'var(--vscode-editorHoverWidget-foreground)',
                        padding: '4px 8px',
                        borderRadius: '4px',
                        fontSize: '12px',
                        width: 'max-content',
                        maxWidth: 'calc(100vw - 32px)',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        textAlign: textAlign,
                        zIndex: 100000,
                        pointerEvents: 'none',
                        boxShadow: '0 2px 8px var(--vscode-widget-shadow)',
                        boxSizing: 'border-box'
                    }}
                >
                    {content}
                    {showArrow && <div style={arrowStyle} />}
                </div>
            )}
        </>
    );
};

export default Tooltip;