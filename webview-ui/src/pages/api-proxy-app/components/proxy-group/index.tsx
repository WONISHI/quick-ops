import BaseButton from '@components/BaseButton';
import BaseContextMenu from '@components/BaseContextMenu';
import type { ProxyGroupProps } from '@pages/api-proxy-app/components/proxy-group/src/type';

import styles from './index.module.css';

export default function ProxyGroup({ name, count, enabledCount = 0, collapsed = false, children, contextMenuProps, onToggle }: ProxyGroupProps) {
  const title = name || '未命名分组';

  const header = (
    <BaseButton type="text" block className={styles['group-header']} onClick={onToggle}>
      <span className={styles['group-header-content']}>
        <span className="codicon codicon-chevron-down" data-collapsed={collapsed} />
        <span className="codicon codicon-folder" />
        <span className={styles['group-name']} title={title}>
          {title}
        </span>
        <span className={styles['group-count']}>
          {count} 个代理{enabledCount > 0 ? ` · ${enabledCount} 个启用` : ''}
        </span>
      </span>
    </BaseButton>
  );

  return (
    <section className={styles['proxy-group']}>
      {contextMenuProps ? <BaseContextMenu {...contextMenuProps}>{header}</BaseContextMenu> : header}

      {!collapsed && <div className={styles['group-body']}>{children}</div>}
    </section>
  );
}
