import type { ReactNode } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faRotateRight, faPlus, faStar as faStarSolid, faClockRotateLeft, faBroom, faDatabase, faBoxArchive, faCookieBite, faTerminal } from '@fortawesome/free-solid-svg-icons';
import BaseContextMenu from '@components/BaseContextMenu';
import type { BaseContextMenuItem } from '@components/BaseContextMenu';

interface ContextMenuProps {
  /** 点击触发目标，例如“更多操作”按钮。 */
  children: ReactNode;
  onRefresh: () => void;
  onNewTab: () => void;
  onOpenFav: () => void;
  onOpenHistory: () => void;
  onClearCache: (type: 'local' | 'session' | 'cookie') => void;
  onOpenDevTools: () => void;
}

/**
 * @description Live Preview 更多操作菜单。
 * children 作为点击目标，不需要传入 x、y。
 */
export default function LivePreviewContextMenu(props: ContextMenuProps) {
  const { children, onRefresh, onNewTab, onOpenFav, onOpenHistory, onClearCache, onOpenDevTools } = props;

  const items: BaseContextMenuItem[] = [
    {
      key: 'refresh',
      label: '刷新页面',
      icon: <FontAwesomeIcon icon={faRotateRight} />,
      onSelect: onRefresh,
    },
    {
      key: 'new-tab',
      label: '新建标签页',
      icon: <FontAwesomeIcon icon={faPlus} />,
      onSelect: onNewTab,
    },
    {
      key: 'favorites',
      label: '打开收藏夹',
      icon: (
        <FontAwesomeIcon
          icon={faStarSolid}
          style={{
            color: 'var(--warning-color, var(--vscode-list-warningForeground))',
          }}
        />
      ),
      onSelect: onOpenFav,
    },
    {
      key: 'history',
      label: '历史记录',
      icon: <FontAwesomeIcon icon={faClockRotateLeft} />,
      onSelect: onOpenHistory,
    },
    {
      type: 'separator',
      key: 'separator-cache',
    },
    {
      key: 'clear-cache',
      label: '清理页面缓存',
      icon: <FontAwesomeIcon icon={faBroom} />,
      children: [
        {
          key: 'clear-local-storage',
          label: '清理 LocalStorage',
          icon: <FontAwesomeIcon icon={faDatabase} />,
          onSelect: () => onClearCache('local'),
        },
        {
          key: 'clear-session-storage',
          label: '清理 SessionStorage',
          icon: <FontAwesomeIcon icon={faBoxArchive} />,
          onSelect: () => onClearCache('session'),
        },
        {
          key: 'clear-cookie',
          label: '清理 Cookie 数据',
          icon: <FontAwesomeIcon icon={faCookieBite} />,
          onSelect: () => onClearCache('cookie'),
        },
      ],
    },
    {
      type: 'separator',
      key: 'separator-devtools',
    },
    {
      key: 'devtools',
      label: '开发者工具',
      icon: <FontAwesomeIcon icon={faTerminal} />,
      onSelect: onOpenDevTools,
    },
  ];

  return (
    <BaseContextMenu trigger="click" items={items} minWidth={200} density="compact" submenuPlacement="inline" showArrow={true} submenuOpenDelay={120}>
      {children}
    </BaseContextMenu>
  );
}
