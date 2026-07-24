import BaseButton from '@components/BaseButton';

import type { KeyValueItem } from '@/pages/api-dev-tools-app/src/type';

import styles from './index.module.css';

export type KeyValueItemValueType = 'text' | 'file';

export type KeyValueEditorItem = KeyValueItem & {
  /**
   * @description 当前值类型
   */
  valueType?: KeyValueItemValueType;

  /**
   * @description 文件名称
   */
  fileName?: string;

  /**
   * @description 文件 MIME 类型
   */
  fileMimeType?: string;

  /**
   * @description 文件 Base64 内容
   */
  fileData?: string;
};

export interface KeyValueEditorProps {
  /**
   * @description 键值配置列表
   */
  items: KeyValueEditorItem[];

  /**
   * @description 键值配置列表变化事件
   */
  onChange: (items: KeyValueEditorItem[]) => void;

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

  /**
   * @description 是否展示 Text / File 类型列
   *
   * @default false
   */
  showType?: boolean;
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
function createKeyValueItem(): KeyValueEditorItem {
  return {
    id: createKeyValueId(),
    enabled: true,
    key: '',
    value: '',
    valueType: 'text',
  };
}

/**
 * @description 读取待上传文件的 Base64 内容
 */
function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      const result = String(reader.result || '');
      const separatorIndex = result.indexOf(',');

      resolve(separatorIndex >= 0 ? result.slice(separatorIndex + 1) : result);
    };

    reader.onerror = () => {
      reject(reader.error || new Error('文件读取失败'));
    };

    reader.readAsDataURL(file);
  });
}

/**
 * @description 渲染键值编辑器
 */
export default function KeyValueEditor({ items, onChange, keyPlaceholder = '名称', valuePlaceholder = '值', showType = false }: KeyValueEditorProps) {
  /**
   * @description 更新键值配置项
   */
  const updateItem = (id: string, patch: Partial<KeyValueEditorItem>) => {
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

  /**
   * @description 切换当前行 Text / File 类型
   */
  const changeItemType = (item: KeyValueEditorItem, valueType: KeyValueItemValueType) => {
    updateItem(item.id, {
      valueType,
      value: valueType === 'text' ? item.value : '',
      fileName: '',
      fileMimeType: '',
      fileData: '',
    });
  };

  /**
   * @description 选择当前行需要上传的文件
   */
  const selectFile = async (item: KeyValueEditorItem, file?: File) => {
    if (!file) return;

    const fileData = await readFileAsBase64(file);

    updateItem(item.id, {
      valueType: 'file',
      value: '',
      fileName: file.name,
      fileMimeType: file.type || 'application/octet-stream',
      fileData,
    });
  };

  return (
    <div className={styles.editor}>
      <div className={[styles.head, showType ? styles['with-type'] : ''].filter(Boolean).join(' ')}>
        <span />
        <span>{keyPlaceholder}</span>
        {showType && <span>类型</span>}
        <span>{valuePlaceholder}</span>
        <span />
      </div>

      {items.map((item) => (
        <div className={[styles.row, showType ? styles['with-type'] : ''].filter(Boolean).join(' ')} key={item.id}>
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

          {showType && (
            <select
              value={item.valueType === 'file' ? 'file' : 'text'}
              title="字段类型"
              onChange={(event) => {
                changeItemType(item, event.target.value as KeyValueItemValueType);
              }}
            >
              <option value="text">Text</option>
              <option value="file">File</option>
            </select>
          )}

          {showType && item.valueType === 'file' ? (
            <label className={styles['file-picker']} title={item.fileName || '选择上传文件'}>
              <i className="codicon codicon-attach" />
              <span>{item.fileName || '选择文件'}</span>

              <input
                type="file"
                onChange={(event) => {
                  const file = event.target.files?.[0];

                  void selectFile(item, file).catch(() => undefined);
                  event.target.value = '';
                }}
              />
            </label>
          ) : (
            <input
              value={item.value}
              placeholder={valuePlaceholder}
              onChange={(event) => {
                updateItem(item.id, {
                  value: event.target.value,
                });
              }}
            />
          )}

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
