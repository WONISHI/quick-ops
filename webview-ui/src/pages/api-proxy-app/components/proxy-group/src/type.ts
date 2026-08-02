import React from 'react';
import type { BaseContextMenuProps } from '@components/BaseContextMenu/src/type';

export type ProxyGroupContextMenuProps = Omit<BaseContextMenuProps, 'children'>;

export interface ProxyGroupProps {
  name: string;
  count: number;
  enabledCount?: number;
  collapsed?: boolean;
  children?: React.ReactNode;
  contextMenuProps?: ProxyGroupContextMenuProps;
  onToggle?: () => void;
}
