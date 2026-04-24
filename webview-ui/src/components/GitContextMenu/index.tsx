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

  useEffect(() => {
    if (!visible) return;
    const handleKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [visible, onClose]);

  if (!visible) return null;

  return createPortal(
    <>
      <div 
        className={styles.backdrop} 
        onMouseDown={(e) => { e.stopPropagation(); onClose(); }}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onClose(); }}
      />
      <div
        ref={menuRef}
        className={`${styles.menu} ${isCalculated ? styles.visible : ''}`}
        style={{ left: pos.x, top: pos.y }}
        onMouseDown={(e) => e.stopPropagation()}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
      >
        {children}
      </div>
    </>,
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