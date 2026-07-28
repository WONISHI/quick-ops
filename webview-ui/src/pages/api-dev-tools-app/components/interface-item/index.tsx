import BaseButton from '@components/BaseButton';

import type { InterfaceItemProps } from '@pages/api-dev-tools-app/components/interface-item/src/type';

import styles from './index.module.css';

/**
 * @description 项目接口列表项
 */
export default function InterfaceItem({ api, active = false, shareMode = false, checked = false, onToggleShare, onSelect, onRemove }: InterfaceItemProps) {
  return (
    <div className={[styles.item, shareMode ? styles['share-mode'] : '', active ? styles.active : ''].filter(Boolean).join(' ')}>
      {shareMode && (
        <label
          className={styles['share-checkbox']}
          onClick={(event) => {
            event.stopPropagation();
          }}
        >
          <input
            type="checkbox"
            checked={checked}
            onChange={() => {
              onToggleShare?.();
            }}
          />
        </label>
      )}

      <button
        type="button"
        className={styles.main}
        onClick={(event) => {
          event.stopPropagation();
          onSelect();
        }}
      >
        <span className={styles[`method-${api.method.toLowerCase()}`]}>{api.method}</span>

        <span className={styles.name}>{api.name}</span>

        <span className={styles.url}>{api.url}</span>
      </button>

      <BaseButton
        type="icon"
        size="small"
        title={`删除接口：${api.name}`}
        icon={<i className="codicon codicon-trash" />}
        onClick={(event) => {
          event.stopPropagation();
          onRemove();
        }}
      />
    </div>
  );
}
