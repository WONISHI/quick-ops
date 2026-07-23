import styles from './index.module.css';

export interface ShareCardProps {
  /**
   * @description 分享地址
   */
  url: string;

  /**
   * @description 打开分享地址
   */
  onOpen: () => void;

  /**
   * @description 复制分享地址
   */
  onCopy: () => void;

  /**
   * @description 关闭分享
   */
  onClose: () => void;
}

/**
 * @description 接口文档分享状态卡片
 */
export default function ShareCard({ url, onOpen, onCopy, onClose }: ShareCardProps) {
  return (
    <div className={styles.card}>
      <div className={styles.title}>文档分享中</div>

      <div className={styles['url-row']}>
        <button type="button" className={styles.url} title="点击后确认是否在外部浏览器打开" onClick={onOpen}>
          {url}
        </button>

        <button type="button" className={styles['copy-button']} title="复制链接" onClick={onCopy}>
          <i className="codicon codicon-copy" />
        </button>
      </div>

      <div className={styles.actions}>
        <button type="button" className={styles.button} onClick={onOpen}>
          预览链接
        </button>

        <button type="button" className={styles.button} onClick={onClose}>
          关闭分享
        </button>
      </div>
    </div>
  );
}
