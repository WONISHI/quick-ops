import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faClockRotateLeft, faXmark, faGlobe } from '@fortawesome/free-solid-svg-icons';
import styles from './index.module.css';

interface HistoryItem {
  url: string;
  title: string;
  timestamp: number;
  logo?: string;
}

interface HistoryModalProps {
  visible: boolean;
  historyStack: HistoryItem[];
  historyIdx: number;
  onClose: () => void;
  onNavigateToHistory: (index: number) => void;
  getKnownLogoByUrl: (url: string) => string;
}

export default function HistoryModal(props: HistoryModalProps) {
  const { visible, historyStack, historyIdx, onClose, onNavigateToHistory, getKnownLogoByUrl } = props;

  if (!visible) return null;

  return (
    <div className={styles['history-overlay']} onClick={onClose}>
      <div className={styles['history-modal']} onClick={(e) => e.stopPropagation()}>
        <div className={styles['history-header']}>
          <h3>
            <FontAwesomeIcon icon={faClockRotateLeft} className={styles['history-header-icon']} />
            历史记录
          </h3>

          <FontAwesomeIcon icon={faXmark} className={styles['history-close']} onClick={onClose} title="关闭" />
        </div>

        <div className={styles['history-list']}>
          {historyStack.length === 0 ? (
            <div className={styles['history-empty']}>暂无历史记录</div>
          ) : (
            [...historyStack].reverse().map((entry, index) => {
              const originalIndex = historyStack.length - 1 - index;
              const isCurrent = originalIndex === historyIdx;
              const logo = entry.logo || getKnownLogoByUrl(entry.url);

              return (
                <div
                  key={originalIndex}
                  className={`${styles['history-item']} ${isCurrent ? styles['current-history'] : ''}`}
                  onClick={() => {
                    if (!isCurrent) {
                      onNavigateToHistory(originalIndex);
                    }
                  }}
                >
                  <div className={styles['history-logo-wrap']}>
                    {logo ? (
                      <img
                        className={styles['history-logo']}
                        src={logo}
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                        }}
                      />
                    ) : (
                      <FontAwesomeIcon icon={faGlobe} className={styles['history-logo-placeholder']} />
                    )}
                  </div>

                  <div className={styles['history-item-info']}>
                    <div className={styles['history-title']} title={entry.title}>
                      {entry.title} {isCurrent ? '(当前)' : ''}
                    </div>

                    <div className={styles['history-url']} title={entry.url}>
                      {entry.url}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}