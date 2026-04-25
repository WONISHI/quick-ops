import React, { useLayoutEffect, useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import styles from './index.module.css';
import { vscode } from '../../utils/vscode'; // 确保路径正确

// ==========================================
// 1. 基础 UI 组件 (碰撞检测与渲染)
// ==========================================
interface ContextMenuProps {
  visible: boolean;
  x: number;
  y: number;
  onClose: () => void;
  children: React.ReactNode;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({ visible, x, y, onClose, children }) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: -9999, y: -9999 });
  const [isCalculated, setIsCalculated] = useState(false);

  // 🌟 核心：碰撞检测逻辑
  useLayoutEffect(() => {
    if (visible && menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      const padding = 8; // 距离屏幕边缘的安全距离

      let newX = x;
      let newY = y;

      if (x + rect.width > window.innerWidth) newX = window.innerWidth - rect.width - padding;
      if (y + rect.height > window.innerHeight) newY = window.innerHeight - rect.height - padding;
      newX = Math.max(padding, newX);
      newY = Math.max(padding, newY);

      setPos({ x: newX, y: newY });
      setIsCalculated(true);
    } else {
      setIsCalculated(false);
    }
  }, [visible, x, y]);

  // 2. 🌟 核心：全局监听点击其他地方或失焦关闭
  useEffect(() => {
    if (!visible) return;

    const handleEscape = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    
    const handleOutsideClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    // 🌟 新增：当点击 VS Code 原生 UI（红框区域）时，iframe 会失焦，此时关闭菜单
    const handleWindowBlur = () => {
      onClose();
    };

    document.addEventListener('keydown', handleEscape);
    document.addEventListener('mousedown', handleOutsideClick, true);
    window.addEventListener('blur', handleWindowBlur);

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.removeEventListener('mousedown', handleOutsideClick, true);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [visible, onClose]);

  if (!visible) return null;

  return createPortal(
    <div
      ref={menuRef}
      className={`${styles.menu} ${isCalculated ? styles.visible : ''}`}
      style={{ left: pos.x, top: pos.y }}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
    >
      {children}
    </div>,
    document.body
  );
};

export const MenuItem = ({ icon, text, onClick }: { icon: string, text: string, onClick: () => void }) => (
  <div 
    className={styles.item} 
    onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onClick(); }}
  >
    <i className={`codicon ${icon} ${styles.icon}`} />
    <span className={styles.text} title={text}>{text}</span>
  </div>
);

export const MenuDivider = () => <div className={styles.divider} />;


// ==========================================
// 2. 🌟 业务组件：Git 专属右键菜单
// ==========================================

export interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  type: 'file' | 'commit';
  file?: { file: string; status: string };
  listType?: 'staged' | 'unstaged' | 'history' | 'compare';
  commit?: { hash: string; message: string };
}

interface GitContextMenuProps {
  contextMenu: ContextMenuState | null;
  onClose: () => void;
}

export const GitContextMenu: React.FC<GitContextMenuProps> = ({ contextMenu, onClose }) => {
  if (!contextMenu || !contextMenu.visible) return null;

  const exec = (action: () => void) => {
    action();
    onClose();
  };

  return (
    <ContextMenu visible={contextMenu.visible} x={contextMenu.x} y={contextMenu.y} onClose={onClose}>
      
      {/* 1. Commit 记录的菜单 */}
      {contextMenu.type === 'commit' && contextMenu.commit && (
        <>
          <MenuItem icon="codicon-copy" text="复制提交信息" onClick={() => exec(() => vscode.postMessage({ command: 'copy', text: contextMenu.commit!.message }))} />
          <MenuItem icon="codicon-git-compare" text="打开更改" onClick={() => exec(() => vscode.postMessage({ command: 'openCommitMultiDiff', hash: contextMenu.commit!.hash }))} />
        </>
      )}

      {/* 2. 工作区文件的菜单 (unstaged) */}
      {contextMenu.type === 'file' && contextMenu.listType === 'unstaged' && (
        <>
          <MenuItem icon="codicon-git-compare" text="打开更改" onClick={() => exec(() => vscode.postMessage({ command: 'diff', file: contextMenu.file!.file, status: contextMenu.file!.status }))} />
          <MenuItem icon="codicon-go-to-file" text="打开文件" onClick={() => exec(() => vscode.postMessage({ command: 'open', file: contextMenu.file!.file }))} />
          <MenuItem icon="codicon-discard" text="放弃更改" onClick={() => exec(() => vscode.postMessage({ command: 'discard', file: contextMenu.file!.file, status: contextMenu.file!.status }))} />
          <MenuItem icon="codicon-plus" text="暂存更改" onClick={() => exec(() => vscode.postMessage({ command: 'stage', file: contextMenu.file!.file, status: contextMenu.file!.status }))} />
          <MenuDivider />
          <MenuItem icon="codicon-eye-closed" text="添加到 .gitignore" onClick={() => exec(() => vscode.postMessage({ command: 'ignore', file: contextMenu.file!.file }))} />
          <MenuItem icon="codicon-folder-opened" text="在访达/资源管理器中显示" onClick={() => exec(() => vscode.postMessage({ command: 'reveal', file: contextMenu.file!.file }))} />
        </>
      )}

      {/* 3. 暂存区文件的菜单 (staged) */}
      {contextMenu.type === 'file' && contextMenu.listType === 'staged' && (
        <>
          <MenuItem icon="codicon-git-compare" text="打开更改" onClick={() => exec(() => vscode.postMessage({ command: 'diff', file: contextMenu.file!.file, status: contextMenu.file!.status }))} />
          <MenuItem icon="codicon-go-to-file" text="打开文件" onClick={() => exec(() => vscode.postMessage({ command: 'open', file: contextMenu.file!.file }))} />
          <MenuItem icon="codicon-remove" text="取消暂存更改" onClick={() => exec(() => vscode.postMessage({ command: 'unstage', file: contextMenu.file!.file }))} />
          <MenuDivider />
          <MenuItem icon="codicon-folder-opened" text="在访达/资源管理器中显示" onClick={() => exec(() => vscode.postMessage({ command: 'reveal', file: contextMenu.file!.file }))} />
        </>
      )}

      {/* 4. 历史/对比文件的菜单 (history / compare) */}
      {contextMenu.type === 'file' && (contextMenu.listType === 'history' || contextMenu.listType === 'compare') && (
        <MenuItem icon="codicon-go-to-file" text="打开文件" onClick={() => exec(() => vscode.postMessage({ command: 'open', file: contextMenu.file!.file }))} />
      )}

    </ContextMenu>
  );
};