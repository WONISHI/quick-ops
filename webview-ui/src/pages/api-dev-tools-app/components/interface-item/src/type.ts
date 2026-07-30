import type { ApiInterfaceItem } from '@/pages/api-dev-tools-app/src/type';

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