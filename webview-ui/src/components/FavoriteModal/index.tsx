import type { Dispatch, SetStateAction } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faStar as faStarSolid, faPlus, faXmark, faGlobe, faPen, faTrash, faCheck } from '@fortawesome/free-solid-svg-icons';
import { faCopy as faCopyRegular } from '@fortawesome/free-regular-svg-icons';
import styles from './index.module.css';

interface FavoriteItem {
  url: string;
  title: string;
  timestamp: number;
  description?: string;
  logo?: string;
  isDefault?: boolean;
  source?: 'builtin' | 'user';
}

interface FavFormState {
  visible: boolean;
  title: string;
  url: string;
  editingOriginalUrl: string;
}

interface FavoriteModalProps {
  visible: boolean;
  sortedFavorites: FavoriteItem[];
  favSort: 'time' | 'title';
  favForm: FavFormState;
  copiedUrl: string;
  onClose: () => void;
  onOpenUrl: (url: string) => void;
  onCopy: (url: string) => void;
  onSaveFavorite: () => void;
  onDeleteFavorite: (favorite: FavoriteItem) => void;
  setFavSort: (value: 'time' | 'title') => void;
  setFavForm: Dispatch<SetStateAction<FavFormState>>;
}

export default function FavoriteModal(props: FavoriteModalProps) {
  const {
    visible,
    sortedFavorites,
    favSort,
    favForm,
    copiedUrl,
    onClose,
    onOpenUrl,
    onCopy,
    onSaveFavorite,
    onDeleteFavorite,
    setFavSort,
    setFavForm,
  } = props;

  if (!visible) return null;

  return (
    <div className={styles['fav-overlay']} onClick={onClose}>
      <div className={styles['fav-modal']} onClick={(e) => e.stopPropagation()}>
        <div className={styles['fav-header']}>
          <h3>
            <FontAwesomeIcon icon={faStarSolid} className={styles['fav-header-icon']} />
            我的收藏夹
          </h3>

          <div className={styles['fav-header-actions']}>
            <select className={styles['fav-sort-select']} value={favSort} onChange={(e) => setFavSort(e.target.value as 'time' | 'title')}>
              <option value="time">按时间 (最新优先)</option>
              <option value="title">按标题 (A-Z)</option>
            </select>

            <FontAwesomeIcon
              icon={faPlus}
              className={`${styles['action-icon']} ${styles['fav-header-plus']}`}
              title="新增收藏"
              onClick={() => setFavForm({ visible: true, title: '', url: '', editingOriginalUrl: '' })}
            />

            <div className={styles['fav-header-divider']} />

            <FontAwesomeIcon icon={faXmark} className={styles['fav-close']} onClick={onClose} title="关闭" />
          </div>
        </div>

        {favForm.visible && (
          <div className={styles['fav-form']}>
            <input
              type="text"
              className={styles['fav-input']}
              placeholder="输入网站标题"
              value={favForm.title}
              onChange={(e) => setFavForm({ ...favForm, title: e.target.value })}
              autoFocus
            />

            <input
              type="text"
              className={styles['fav-input']}
              placeholder="输入规范的网址 (如 https://...)"
              value={favForm.url}
              onChange={(e) => setFavForm({ ...favForm, url: e.target.value })}
            />

            <div className={styles['fav-form-btns']}>
              <button className={styles['fav-btn']} onClick={() => setFavForm({ ...favForm, visible: false })}>
                取消
              </button>

              <button className={`${styles['fav-btn']} ${styles['primary']}`} onClick={onSaveFavorite}>
                保存
              </button>
            </div>
          </div>
        )}

        <div className={styles['fav-list']}>
          {sortedFavorites.length === 0 ? (
            <div className={styles['fav-empty']}>暂无收藏。点击右上角 + 号，或地址栏星号添加。</div>
          ) : (
            sortedFavorites.map((f, i) => (
              <div key={`${f.isDefault ? 'default' : 'user'}-${f.url}-${i}`} className={styles['fav-item']} onClick={() => onOpenUrl(f.url)}>
                <div className={styles['fav-logo-wrap']}>
                  {f.logo ? (
                    <img
                      className={styles['fav-logo']}
                      src={f.logo}
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                      }}
                    />
                  ) : (
                    <FontAwesomeIcon icon={faGlobe} className={styles['fav-logo-placeholder']} />
                  )}
                </div>

                <div className={styles['fav-item-info']}>
                  <div className={styles['fav-title-row']}>
                    <div className={styles['fav-title']} title={f.title}>
                      {f.title}
                    </div>

                    {f.isDefault && <span className={styles['fav-default-tag']}>默认</span>}
                  </div>

                  {f.description && (
                    <div className={styles['fav-description']} title={f.description}>
                      {f.description}
                    </div>
                  )}

                  <div className={styles['fav-url']} title={f.url}>
                    {f.url}
                  </div>
                </div>

                <div className={styles['fav-actions']}>
                  <FontAwesomeIcon
                    icon={copiedUrl === f.url ? faCheck : faCopyRegular}
                    className={`${styles['fav-action-btn']} ${styles['copy']} ${copiedUrl === f.url ? styles['copy-success'] : ''}`}
                    title="复制链接"
                    onClick={(e) => {
                      e.stopPropagation();
                      onCopy(f.url);
                    }}
                  />

                  {!f.isDefault && (
                    <>
                      <FontAwesomeIcon
                        icon={faPen}
                        className={`${styles['fav-action-btn']} ${styles['edit']}`}
                        title="编辑"
                        onClick={(e) => {
                          e.stopPropagation();
                          setFavForm({
                            visible: true,
                            title: f.title,
                            url: f.url,
                            editingOriginalUrl: f.url,
                          });
                        }}
                      />

                      <FontAwesomeIcon
                        icon={faTrash}
                        className={`${styles['fav-action-btn']} ${styles['delete']}`}
                        title="删除"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteFavorite(f);
                        }}
                      />
                    </>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}