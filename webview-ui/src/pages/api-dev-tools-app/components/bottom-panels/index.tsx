import type { HistoryItem } from '@/pages/api-dev-tools-app/src/type';

import styles from './index.module.css';

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

/**
 * @description 历史记录与脚本日志面板
 */
export default function BottomPanels({ size, maxSize, history, logs, onLoadHistory }: BottomPanelsProps) {
  return (
    <div
      className={styles.panels}
      style={{
        height: `${size}px`,
        flexBasis: `${size}px`,
        maxHeight: `${maxSize}px`,
      }}
    >
      <div className={styles.history}>
        <div className={styles.title}>历史记录</div>

        {history.length === 0 ? (
          <div className={styles.empty}>暂无历史</div>
        ) : (
          history.map((item) => (
            <button
              key={item.id}
              type="button"
              className={styles['history-item']}
              onClick={() => {
                onLoadHistory(item);
              }}
            >
              <span className={styles[`method-${item.method.toLowerCase()}`]}>{item.method}</span>

              <span className={styles['history-url']}>{item.url}</span>

              <span>{item.status}</span>
            </button>
          ))
        )}
      </div>

      <div className={styles.logs}>
        <div className={styles.title}>脚本日志</div>

        {logs.length === 0 ? (
          <div className={styles.empty}>暂无日志</div>
        ) : (
          logs.map((item, index) => (
            <div key={`${item}-${index}`} className={styles['log-item']}>
              {item}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
