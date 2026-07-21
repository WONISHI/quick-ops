import React, { useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import styles from './index.module.css';
import { vscode } from '@utils/vscode'; // 确保路径正确

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
  const menuRef = useRef<HTMLDivElement | null>(null);

  /**
   * @description 菜单挂载时直接完成碰撞定位
   *
   * callback ref 在 DOM 提交阶段执行，
   * 不需要在 Effect 中同步调用 setState，
   * 因此不会产生级联渲染。
   */
  const setMenuRef = useCallback(
    (node: HTMLDivElement | null) => {
      menuRef.current = node;

      if (!node || !visible) {
        return;
      }

      const rect = node.getBoundingClientRect();
      const padding = 8;

      let nextX = x;
      let nextY = y;

      if (nextX + rect.width > window.innerWidth - padding) {
        nextX = window.innerWidth - rect.width - padding;
      }

      if (nextY + rect.height > window.innerHeight - padding) {
        nextY = window.innerHeight - rect.height - padding;
      }

      nextX = Math.max(padding, nextX);
      nextY = Math.max(padding, nextY);

      node.style.left = `${nextX}px`;
      node.style.top = `${nextY}px`;
    },
    [visible, x, y],
  );

  /**
   * @description 监听外部点击、Escape 和窗口失焦
   */
  useEffect(() => {
    if (!visible) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    const handleOutsideClick = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
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
      ref={setMenuRef}
      className={`${styles.menu} ${styles.visible}`}
      style={{
        left: -9999,
        top: -9999,
      }}
      onMouseDown={(event) => {
        event.stopPropagation();
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      {children}
    </div>,
    document.body,
  );
};

export const MenuItem = ({ icon, text, onClick }: { icon: string; text: string; onClick: () => void }) => (
  <div
    className={styles.item}
    onMouseDown={(e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    }}
  >
    <i className={`codicon ${icon} ${styles.icon}`} />
    <span className={styles.text} title={text}>
      {text}
    </span>
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
  listType?: 'staged' | 'unstaged' | 'history' | 'compare' | 'stash-file';
  historyHash?: string;
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
          <MenuItem
            icon="codicon-git-compare"
            text="打开更改"
            onClick={() =>
              exec(() =>
                vscode.postMessage({
                  command: 'diff',
                  file: contextMenu.file!.file,
                  status: contextMenu.file!.status,
                }),
              )
            }
          />

          <MenuItem
            icon="codicon-go-to-file"
            text="打开文件"
            onClick={() =>
              exec(() =>
                vscode.postMessage({
                  command: 'open',
                  file: contextMenu.file!.file,
                }),
              )
            }
          />

          <MenuItem
            icon="codicon-copy"
            text="复制文件名称"
            onClick={() =>
              exec(() => {
                const filePath = contextMenu.file!.file;
                const fileName = filePath.split('/').pop() || filePath;

                vscode.postMessage({
                  command: 'copy',
                  text: fileName,
                });
              })
            }
          />

          <MenuDivider />

          <MenuItem
            icon="codicon-trash"
            text="删除文件"
            onClick={() =>
              exec(() =>
                vscode.postMessage({
                  command: 'deleteWorkingFile',
                  file: contextMenu.file!.file,
                  status: contextMenu.file!.status,
                }),
              )
            }
          />

          <MenuItem
            icon="codicon-discard"
            text="放弃更改"
            onClick={() =>
              exec(() =>
                vscode.postMessage({
                  command: 'discard',
                  file: contextMenu.file!.file,
                  status: contextMenu.file!.status,
                }),
              )
            }
          />

          <MenuItem
            icon="codicon-plus"
            text="暂存更改"
            onClick={() =>
              exec(() =>
                vscode.postMessage({
                  command: 'stage',
                  file: contextMenu.file!.file,
                  status: contextMenu.file!.status,
                }),
              )
            }
          />

          <MenuDivider />

          <MenuItem
            icon="codicon-eye-closed"
            text="添加到 .gitignore"
            onClick={() =>
              exec(() =>
                vscode.postMessage({
                  command: 'ignore',
                  file: contextMenu.file!.file,
                }),
              )
            }
          />

          <MenuItem
            icon="codicon-folder-opened"
            text="在访达/资源管理器中显示"
            onClick={() =>
              exec(() =>
                vscode.postMessage({
                  command: 'reveal',
                  file: contextMenu.file!.file,
                }),
              )
            }
          />
        </>
      )}

      {/* 3. 暂存区文件的菜单 (staged) */}
      {contextMenu.type === 'file' && contextMenu.listType === 'staged' && (
        <>
          <MenuItem
            icon="codicon-git-compare"
            text="打开更改"
            onClick={() =>
              exec(() =>
                vscode.postMessage({
                  command: 'diff',
                  file: contextMenu.file!.file,
                  status: contextMenu.file!.status,
                }),
              )
            }
          />

          <MenuItem
            icon="codicon-go-to-file"
            text="打开文件"
            onClick={() =>
              exec(() =>
                vscode.postMessage({
                  command: 'open',
                  file: contextMenu.file!.file,
                }),
              )
            }
          />

          <MenuItem
            icon="codicon-copy"
            text="复制文件名称"
            onClick={() =>
              exec(() => {
                const filePath = contextMenu.file!.file;
                const fileName = filePath.split('/').pop() || filePath;

                vscode.postMessage({
                  command: 'copy',
                  text: fileName,
                });
              })
            }
          />

          <MenuDivider />

          <MenuItem
            icon="codicon-remove"
            text="取消暂存更改"
            onClick={() =>
              exec(() =>
                vscode.postMessage({
                  command: 'unstage',
                  file: contextMenu.file!.file,
                }),
              )
            }
          />

          <MenuDivider />

          <MenuItem
            icon="codicon-folder-opened"
            text="在访达/资源管理器中显示"
            onClick={() =>
              exec(() =>
                vscode.postMessage({
                  command: 'reveal',
                  file: contextMenu.file!.file,
                }),
              )
            }
          />
        </>
      )}

      {/* 4. 贮藏文件的菜单 (stash-file) */}
      {contextMenu.type === 'file' && contextMenu.listType === 'stash-file' && (
        <>
          <MenuItem
            icon="codicon-git-compare"
            text="打开更改"
            onClick={() =>
              exec(() =>
                vscode.postMessage({
                  command: 'diff',
                  file: contextMenu.file!.file,
                  status: contextMenu.file!.status,
                }),
              )
            }
          />

          <MenuItem
            icon="codicon-go-to-file"
            text="打开文件"
            onClick={() =>
              exec(() =>
                vscode.postMessage({
                  command: 'open',
                  file: contextMenu.file!.file,
                }),
              )
            }
          />

          <MenuItem
            icon="codicon-copy"
            text="复制文件名称"
            onClick={() =>
              exec(() => {
                const filePath = contextMenu.file!.file;
                const fileName = filePath.split('/').pop() || filePath;

                vscode.postMessage({
                  command: 'copy',
                  text: fileName,
                });
              })
            }
          />
        </>
      )}

      {/* 5. 历史/对比文件的菜单 (history / compare) */}
      {contextMenu.type === 'file' && (contextMenu.listType === 'history' || contextMenu.listType === 'compare') && (
        <>
          <MenuItem icon="codicon-go-to-file" text="打开文件" onClick={() => exec(() => vscode.postMessage({ command: 'open', file: contextMenu.file!.file }))} />

          {contextMenu.listType === 'history' && contextMenu.historyHash && (
            <MenuItem
              icon="codicon-git-compare"
              text="与本地分支比较"
              onClick={() =>
                exec(() =>
                  vscode.postMessage({
                    command: 'diffCommitFileWithLocalBranch',
                    file: contextMenu.file!.file,
                    status: contextMenu.file!.status,
                    hash: contextMenu.historyHash,
                  }),
                )
              }
            />
          )}
        </>
      )}
    </ContextMenu>
  );
};
