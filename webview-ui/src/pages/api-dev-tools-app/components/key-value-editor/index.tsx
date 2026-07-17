import BaseButton from '@components/BaseButton';

import type { KeyValueItem } from '@/pages/api-dev-tools-app/src/type';

import styles from './index.module.css';

export interface KeyValueEditorProps {
  /**
   * @description 键值配置列表
   */
  items: KeyValueItem[];

  /**
   * @description 键值配置列表变化事件
   */
  onChange: (items: KeyValueItem[]) => void;

  /**
   * @description Key 输入框占位文本
   *
   * @default '名称'
   */
  keyPlaceholder?: string;

  /**
   * @description Value 输入框占位文本
   *
   * @default '值'
   */
  valuePlaceholder?: string;
}

/**
 * @description 创建键值配置项标识
 */
function createKeyValueId(): string {
  return `kv-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * @description 创建空白键值配置项
 */
function createKeyValueItem(): KeyValueItem {
  return {
    id: createKeyValueId(),
    enabled: true,
    key: '',
    value: '',
  };
}

/**
 * @description 渲染键值编辑器
 */
export default function KeyValueEditor({ items, onChange, keyPlaceholder = '名称', valuePlaceholder = '值' }: KeyValueEditorProps) {
  /**
   * @description 更新键值配置项
   */
  const updateItem = (id: string, patch: Partial<KeyValueItem>) => {
    onChange(
      items.map((item) => {
        return item.id === id
          ? {
              ...item,
              ...patch,
            }
          : item;
      }),
    );
  };

  /**
   * @description 删除键值配置项
   */
  const removeItem = (id: string) => {
    const next = items.filter((item) => item.id !== id);

    onChange(next.length > 0 ? next : [createKeyValueItem()]);
  };

  /**
   * @description 添加键值配置项
   */
  const addItem = () => {
    onChange([...items, createKeyValueItem()]);
  };

  return (
    <div className={styles.editor}>
      <div className={styles.head}>
        <span />
        <span>{keyPlaceholder}</span>
        <span>{valuePlaceholder}</span>
        <span />
      </div>

      {items.map((item) => (
        <div className={styles.row} key={item.id}>
          <input
            type="checkbox"
            checked={item.enabled}
            onChange={(event) => {
              updateItem(item.id, {
                enabled: event.target.checked,
              });
            }}
          />

          <input
            value={item.key}
            placeholder={keyPlaceholder}
            onChange={(event) => {
              updateItem(item.id, {
                key: event.target.value,
              });
            }}
          />

          <input
            value={item.value}
            placeholder={valuePlaceholder}
            onChange={(event) => {
              updateItem(item.id, {
                value: event.target.value,
              });
            }}
          />

          <BaseButton
            type="icon"
            size="medium"
            title="删除当前行"
            icon={<i className="codicon codicon-trash" />}
            onClick={() => {
              removeItem(item.id);
            }}
          />
        </div>
      ))}

      <BaseButton type="default" size="medium" className={styles['add-button']} icon={<i className="codicon codicon-add" />} onClick={addItem}>
        添加一行
      </BaseButton>
    </div>
  );
}
