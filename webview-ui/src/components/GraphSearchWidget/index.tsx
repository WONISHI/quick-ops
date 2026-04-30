import React, { useState, useEffect, useRef } from 'react';
import styles from './index.module.css';

interface GraphSearchWidgetProps {
    isSearchOpen: boolean;
    setIsSearchOpen: (open: boolean) => void;
    searchQuery: string;
    setSearchQuery: (query: string) => void;
    currentMatchIndex: number;
    setCurrentMatchIndex: (index: number) => void;
    matchedIndices: number[];
    handlePrevMatch: () => void;
    handleNextMatch: () => void;
    anchorRef: React.RefObject<HTMLDivElement | null>;
}

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
    anchorRef
}) => {
    const [searchOffset, setSearchOffset] = useState({ x: 0, y: 0 });
    const [initialTop, setInitialTop] = useState(-9999);
    
    const searchInputRef = useRef<HTMLInputElement>(null);
    const isDragging = useRef(false);
    const dragStart = useRef({ mouseX: 0, mouseY: 0, currentX: 0, currentY: 0 });

    useEffect(() => {
        if (!isSearchOpen || !anchorRef.current) return;

        const updatePosition = () => {
            if (anchorRef.current) {
                const rect = anchorRef.current.getBoundingClientRect();
                setInitialTop(rect.top + 8); 
            }
        };

        updatePosition(); 
        setSearchOffset({ x: 0, y: 0 }); 

        window.addEventListener('resize', updatePosition);
        return () => window.removeEventListener('resize', updatePosition);
    }, [isSearchOpen, anchorRef]);

    useEffect(() => {
        if (isSearchOpen && searchInputRef.current) {
            searchInputRef.current.focus();
        }
    }, [isSearchOpen]);

    // 🌟 核心修复：改用原生的 Mouse 事件挂载到 Document 上，彻底防止鼠标脱轨
    const handleMouseMove = (e: MouseEvent) => {
        if (!isDragging.current) return;
        const dx = e.clientX - dragStart.current.mouseX;
        const dy = e.clientY - dragStart.current.mouseY;
        setSearchOffset({
            x: dragStart.current.currentX + dx,
            y: dragStart.current.currentY + dy
        });
    };

    const handleMouseUp = () => {
        isDragging.current = false;
        // 拖拽结束时移除全局监听
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
    };

    const handleMouseDown = (e: React.MouseEvent) => {
        const target = e.target as HTMLElement;
        
        // 🌟 体验优化：只要点的不是输入框和按钮，点整个搜索条的任意位置都能拖拽！
        if (target.tagName.toLowerCase() === 'input' || target.closest('button')) {
            return;
        }

        e.preventDefault();
        isDragging.current = true;
        dragStart.current = {
            mouseX: e.clientX,
            mouseY: e.clientY,
            currentX: searchOffset.x,
            currentY: searchOffset.y
        };

        // 鼠标按下时，向全局注册移动和抬起事件（防止鼠标移出组件外部时失效）
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    };

    // 组件卸载时安全清理
    useEffect(() => {
        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, []);

    if (!isSearchOpen) return null;

    return (
        <div
            className={styles['search-widget']}
            style={{ 
                top: `${initialTop}px`,
                transform: `translate(calc(-50% + ${searchOffset.x}px), ${searchOffset.y}px)`,
                visibility: initialTop < 0 ? 'hidden' : 'visible',
                cursor: 'grab' // 提示用户可以抓取
            }}
            onMouseDown={handleMouseDown} // 替换掉原来的 onPointer 家族
        >
            <div className={styles['search-gripper']}>
                <i className="codicon codicon-gripper" />
            </div>

            <input
                ref={searchInputRef}
                className={styles['search-input']}
                placeholder="搜索提交..."
                value={searchQuery}
                style={{ cursor: 'text' }} // 鼠标悬浮在输入框时恢复光标
                onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setCurrentMatchIndex(0); 
                }}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        if (e.shiftKey) handlePrevMatch();
                        else handleNextMatch();
                    } else if (e.key === 'Escape') {
                        setIsSearchOpen(false);
                    }
                }}
            />
            <div className={styles['search-count']} style={{ cursor: 'default' }}>
                {matchedIndices.length > 0 ? currentMatchIndex + 1 : 0}/{matchedIndices.length}
            </div>
            <button className={styles['search-btn']} onClick={handlePrevMatch} disabled={matchedIndices.length === 0} title="上一个 (Shift+Enter)" style={{ cursor: 'pointer' }}>
                <i className="codicon codicon-arrow-up" />
            </button>
            <button className={styles['search-btn']} onClick={handleNextMatch} disabled={matchedIndices.length === 0} title="下一个 (Enter)" style={{ cursor: 'pointer' }}>
                <i className="codicon codicon-arrow-down" />
            </button>
            <button className={styles['search-btn']} onClick={() => setIsSearchOpen(false)} title="关闭 (Esc)" style={{ cursor: 'pointer' }}>
                <i className="codicon codicon-close" />
            </button>
        </div>
    );
};

export default GraphSearchWidget;