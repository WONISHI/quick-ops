import type {
  ApiInterfaceItem,
} from '@/pages/api-dev-tools-app/src/type';

import styles from './index.module.css';

export interface InterfaceItemProps {
  /**
   * @description 接口数据
   */
  api: ApiInterfaceItem;

  /**
   * @description 是否为当前接口
   *
   * @default false
   */
  active?: boolean;

  /**
   * @description 是否处于分享选择模式
   *
   * @default false
   */
  shareMode?: boolean;

  /**
   * @description 分享选择状态
   *
   * @default false
   */
  checked?: boolean;

  /**
   * @description 切换分享选择状态
   */
  onToggleShare?: () => void;

  /**
   * @description 选择接口
   */
  onSelect: () => void;

  /**
   * @description 删除接口
   */
  onRemove: () => void;
}

/**
 * @description 项目接口列表项
 */
export default function InterfaceItem({
  api,
  active = false,
  shareMode = false,
  checked = false,
  onToggleShare,
  onSelect,
  onRemove,
}: InterfaceItemProps) {
  return (
    <div
      className={[
        styles.item,
        shareMode
          ? styles['share-mode']
          : '',
        active
          ? styles.active
          : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {shareMode && (
        <label
          className={
            styles['share-checkbox']
          }
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
        <span
          className={
            styles[
              `method-${api.method.toLowerCase()}`
            ]
          }
        >
          {api.method}
        </span>

        <span className={styles.name}>
          {api.name}
        </span>

        <span className={styles.url}>
          {api.url}
        </span>
      </button>

      <button
        type="button"
        className={styles.remove}
        title={`删除接口：${api.name}`}
        onClick={(event) => {
          event.stopPropagation();
          onRemove();
        }}
      >
        ×
      </button>
    </div>
  );
}