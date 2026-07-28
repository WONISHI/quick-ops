import type { HistoryItem } from '@/pages/api-dev-tools-app/src/type';
export interface BottomPanelsProps {
  /**
   * @description 面板当前高度
   */
  size: number;

  /**
   * @description 面板最大高度
   */
  maxSize: number;

  /**
   * @description 请求历史列表
   */
  history: HistoryItem[];

  /**
   * @description 脚本日志列表
   */
  logs: string[];

  /**
   * @description 加载历史请求
   */
  onLoadHistory: (item: HistoryItem) => void | Promise<void>;
}