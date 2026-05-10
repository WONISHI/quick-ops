import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faTriangleExclamation, faArrowUpRightFromSquare, faRotateRight } from '@fortawesome/free-solid-svg-icons';
import styles from './index.module.css';

interface PreviewErrorProps {
  url: string;
  title?: string;
  message?: string;
  onRetry: () => void;
  onOpenExternal: () => void;
}

export default function PreviewError(props: PreviewErrorProps) {
  const { url, title = '页面无法在预览中打开', message, onRetry, onOpenExternal } = props;

  return (
    <div className={styles['preview-error-page']}>
      <div className={styles['preview-error-card']}>
        <FontAwesomeIcon icon={faTriangleExclamation} className={styles['preview-error-icon']} />

        <div className={styles['preview-error-title']}>{title}</div>

        <div className={styles['preview-error-message']}>
          {message || '该页面可能禁止被 iframe 嵌入，或者当前地址无法访问。'}
        </div>

        <div className={styles['preview-error-url']} title={url}>
          {url}
        </div>

        <div className={styles['preview-error-actions']}>
          <button className={styles['preview-error-btn']} onClick={onRetry}>
            <FontAwesomeIcon icon={faRotateRight} />
            重试
          </button>

          <button className={`${styles['preview-error-btn']} ${styles['primary']}`} onClick={onOpenExternal}>
            <FontAwesomeIcon icon={faArrowUpRightFromSquare} />
            外部浏览器打开
          </button>
        </div>
      </div>
    </div>
  );
}