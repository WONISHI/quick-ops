import { useState, useRef, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faRotateRight,
  faPlus,
  faStar as faStarSolid,
  faClockRotateLeft,
  faBroom,
  faChevronRight,
  faDatabase,
  faBoxArchive,
  faCookieBite,
  faTerminal,
} from '@fortawesome/free-solid-svg-icons';
import styles from './index.module.css';

interface ContextMenuProps {
  visible: boolean;
  position: { x: number; y: number };
  onRefresh: () => void;
  onNewTab: () => void;
  onOpenFav: () => void;
  onOpenHistory: () => void;
  onClearCache: (type: 'local' | 'session' | 'cookie') => void;
  onOpenDevTools: () => void;
  onClose: () => void;
}

export default function LivePreviewContextMenu({
  visible,
  position,
  onRefresh,
  onNewTab,
  onOpenFav,
  onOpenHistory,
  onClearCache,
  onOpenDevTools,
  onClose,
}: ContextMenuProps) {
  const [cacheSubmenuOpen, setCacheSubmenuOpen] = useState(false);
  const cacheMenuTimer = useRef<number | null>(null);

  // 每次菜单关闭时，重置子菜单状态
  useEffect(() => {
    if (!visible) {
      setCacheSubmenuOpen(false);

      if (cacheMenuTimer.current) {
        window.clearTimeout(cacheMenuTimer.current);
        cacheMenuTimer.current = null;
      }
    }
  }, [visible]);

  if (!visible) return null;

  return (
    <div className={styles['context-menu']} style={{ left: position.x, top: position.y }}>
      <div
        className={styles['menu-item']}
        onClick={() => {
          onRefresh();
          onClose();
        }}
      >
        <FontAwesomeIcon icon={faRotateRight} className={styles['menu-icon']} /> 刷新页面
      </div>

      <div
        className={styles['menu-item']}
        onClick={() => {
          onNewTab();
          onClose();
        }}
      >
        <FontAwesomeIcon icon={faPlus} className={styles['menu-icon']} /> 新建标签页
      </div>

      <div
        className={styles['menu-item']}
        onClick={() => {
          onOpenFav();
          onClose();
        }}
      >
        <FontAwesomeIcon icon={faStarSolid} className={`${styles['menu-icon']} ${styles['fav-star']}`} /> 打开收藏夹
      </div>

      <div
        className={styles['menu-item']}
        onClick={() => {
          onOpenHistory();
          onClose();
        }}
      >
        <FontAwesomeIcon icon={faClockRotateLeft} className={styles['menu-icon']} /> 历史记录
      </div>

      <div className={styles['menu-divider']} />

      <div
        className={`${styles['menu-item']} ${styles['has-submenu']}`}
        onMouseEnter={() => {
          if (cacheMenuTimer.current) {
            window.clearTimeout(cacheMenuTimer.current);
            cacheMenuTimer.current = null;
          }

          setCacheSubmenuOpen(true);
        }}
        onMouseLeave={() => {
          cacheMenuTimer.current = window.setTimeout(() => setCacheSubmenuOpen(false), 300);
        }}
      >
        <FontAwesomeIcon icon={faBroom} className={styles['menu-icon']} /> 清理页面缓存
        <FontAwesomeIcon icon={faChevronRight} className={styles['menu-chevron']} />

        {cacheSubmenuOpen && (
          <div
            className={styles['submenu']}
            onMouseEnter={() => {
              if (cacheMenuTimer.current) {
                window.clearTimeout(cacheMenuTimer.current);
                cacheMenuTimer.current = null;
              }

              setCacheSubmenuOpen(true);
            }}
            onMouseLeave={() => {
              cacheMenuTimer.current = window.setTimeout(() => setCacheSubmenuOpen(false), 300);
            }}
          >
            <div
              className={styles['menu-item']}
              onClick={() => {
                onClearCache('local');
                onClose();
              }}
            >
              <FontAwesomeIcon icon={faDatabase} className={styles['menu-icon']} /> 清理 LocalStorage
            </div>

            <div
              className={styles['menu-item']}
              onClick={() => {
                onClearCache('session');
                onClose();
              }}
            >
              <FontAwesomeIcon icon={faBoxArchive} className={styles['menu-icon']} /> 清理 SessionStorage
            </div>

            <div
              className={styles['menu-item']}
              onClick={() => {
                onClearCache('cookie');
                onClose();
              }}
            >
              <FontAwesomeIcon icon={faCookieBite} className={styles['menu-icon']} /> 清理 Cookie 数据
            </div>
          </div>
        )}
      </div>

      <div className={styles['menu-divider']} />

      <div
        className={styles['menu-item']}
        onClick={() => {
          onOpenDevTools();
          onClose();
        }}
      >
        <FontAwesomeIcon icon={faTerminal} className={styles['menu-icon']} /> 开发者工具
      </div>
    </div>
  );
}
