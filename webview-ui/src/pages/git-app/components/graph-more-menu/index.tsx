import React, { useMemo, useState } from 'react';
import BaseContextMenu from '@components/BaseContextMenu';
import type { BaseContextMenuItem } from '@components/BaseContextMenu';
import type { GraphMoreMenuProps } from '@/pages/git-app/components/graph-more-menu/src/type';

/**
 * @description Git 图形更多菜单
 *
 * 弹层定位、视口碰撞、箭头、外部点击关闭、
 * Webview 失焦关闭和键盘操作统一交给
 * BaseContextMenu 处理。
 */
const GraphMoreMenu: React.FC<GraphMoreMenuProps> = ({ isSearchOpen, onToggleSearch, onCollapseCommitFiles, triggerClassName = '', activeTriggerClassName = '' }) => {
  const [open, setOpen] = useState(false);

  const items = useMemo<BaseContextMenuItem[]>(() => {
    return [
      {
        key: 'collapse-commit-files',
        label: '折叠提交文件',
        icon: <i className="codicon codicon-fold" />,
        onSelect: () => {
          onCollapseCommitFiles();
        },
      },
      {
        key: 'toggle-commit-search',
        label: isSearchOpen ? '关闭查询提交' : '查询提交',
        icon: <i className="codicon codicon-search" />,
        shortcut: isSearchOpen ? <i className="codicon codicon-check" /> : undefined,
        onSelect: () => {
          onToggleSearch();
        },
      },
    ];
  }, [isSearchOpen, onCollapseCommitFiles, onToggleSearch]);

  return (
    <BaseContextMenu items={items} open={open} trigger="click" showArrow minWidth={168} density="compact" onOpenChange={setOpen}>
      <button
        type="button"
        className={[triggerClassName, open ? activeTriggerClassName : ''].filter(Boolean).join(' ')}
        aria-label="更多 Git 图形操作"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <i className="codicon codicon-kebab-vertical" />
      </button>
    </BaseContextMenu>
  );
};

export default GraphMoreMenu;
