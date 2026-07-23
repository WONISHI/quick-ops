import type { ReactNode } from 'react';

import styles from './index.module.css';

export interface BaseTabItem<Value extends string = string> {
  /**
   * @description Tab 唯一值
   */
  key: Value;

  /**
   * @description Tab 显示内容
   */
  label: ReactNode;

  /**
   * @description Tab 提示文本
   */
  title?: string;

  /**
   * @description 是否禁用
   *
   * @default false
   */
  disabled?: boolean;
}

export interface BaseTabsProps<Value extends string = string> {
  /**
   * @description Tab 配置列表
   */
  items: readonly BaseTabItem<Value>[];

  /**
   * @description 当前选中的 Tab
   */
  value: Value;

  /**
   * @description Tab 切换事件
   */
  onChange: (value: Value, item: BaseTabItem<Value>) => void;

  /**
   * @description 自定义类名
   */
  className?: string;

  /**
   * @description 无障碍标签
   */
  ariaLabel?: string;
}

/**
 * @description 通用 Tab 切换组件
 */
export default function BaseTabs<Value extends string>({ items, value, onChange, className, ariaLabel }: BaseTabsProps<Value>) {
  return (
    <div className={[styles.tabs, className].filter(Boolean).join(' ')} role="tablist" aria-label={ariaLabel}>
      {items.map((item) => {
        const active = item.key === value;

        return (
          <button
            key={item.key}
            type="button"
            role="tab"
            title={item.title}
            disabled={item.disabled}
            aria-selected={active}
            className={[styles.tab, active ? styles.active : ''].filter(Boolean).join(' ')}
            onClick={() => {
              if (item.disabled) return;

              onChange(item.key, item);
            }}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
