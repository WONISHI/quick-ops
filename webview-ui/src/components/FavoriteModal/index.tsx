import type { Dispatch, SetStateAction } from 'react';
import { useMemo, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faStar as faStarSolid,
  faPlus,
  faXmark,
  faGlobe,
  faPen,
  faTrash,
  faCheck,
  faFolder,
  faFolderPlus,
  faFileImport,
  faFileExport,
} from '@fortawesome/free-solid-svg-icons';
import { faCopy as faCopyRegular } from '@fortawesome/free-regular-svg-icons';
import styles from './index.module.css';

interface FavoriteItem {
  url: string;
  title: string;
  timestamp: number;
  description?: string;
  logo?: string;
  folderId?: string;
  isDefault?: boolean;
  source?: 'builtin' | 'user';
}

interface FavoriteFolder {
  id: string;
  name: string;
  timestamp: number;
  isDefault?: boolean;
  source?: 'builtin' | 'user';
}

interface FavFormState {
  visible: boolean;
  title: string;
  url: string;
  description: string;
  logo: string;
  editingOriginalUrl: string;
  folderId: string;
}

interface FavoriteModalProps {
  visible: boolean;
  sortedFavorites: FavoriteItem[];
  favoriteFolders: FavoriteFolder[];
  selectedFolderId: string;
  favSort: 'time' | 'title';
  favForm: FavFormState;
  copiedUrl: string;
  onClose: () => void;
  onOpenUrl: (url: string) => void;
  onCopy: (url: string) => void;
  onSaveFavorite: () => void;
  onDeleteFavorite: (favorite: FavoriteItem) => void;
  onCreateFolder: (name: string) => void;
  onRenameFolder: (folder: FavoriteFolder, nextName: string) => void;
  onDeleteFolder: (folder: FavoriteFolder) => void;
  onMoveFavoriteToFolder: (favorite: FavoriteItem, folderId: string) => void;
  onImportFavorites: () => void;
  onExportFavorites: () => void;
  setSelectedFolderId: (value: string) => void;
  setFavSort: (value: 'time' | 'title') => void;
  setFavForm: Dispatch<SetStateAction<FavFormState>>;
}

const ALL_FOLDER_ID = 'all';
const ROOT_FOLDER_ID = 'root';

export default function FavoriteModal(props: FavoriteModalProps) {
  const {
    visible,
    sortedFavorites,
    favoriteFolders,
    selectedFolderId,
    favSort,
    favForm,
    copiedUrl,
    onClose,
    onOpenUrl,
    onCopy,
    onSaveFavorite,
    onDeleteFavorite,
    onCreateFolder,
    onRenameFolder,
    onDeleteFolder,
    onMoveFavoriteToFolder,
    onImportFavorites,
    onExportFavorites,
    setSelectedFolderId,
    setFavSort,
    setFavForm,
  } = props;
  const [folderName, setFolderName] = useState('');

  const folderCountMap = useMemo(() => {
    const countMap = new Map<string, number>();

    sortedFavorites.forEach((favorite) => {
      const folderId = favorite.folderId || ROOT_FOLDER_ID;

      countMap.set(folderId, (countMap.get(folderId) || 0) + 1);
      countMap.set(ALL_FOLDER_ID, (countMap.get(ALL_FOLDER_ID) || 0) + 1);
    });

    return countMap;
  }, [sortedFavorites]);

  const displayFavorites = useMemo(() => {
    if (selectedFolderId === ALL_FOLDER_ID) return sortedFavorites;

    return sortedFavorites.filter((favorite) => (favorite.folderId || ROOT_FOLDER_ID) === selectedFolderId);
  }, [selectedFolderId, sortedFavorites]);

  const editableFolders = favoriteFolders.filter((folder) => !folder.isDefault);

  if (!visible) return null;

  const handleCreateFolder = () => {
    const name = folderName.trim();

    if (!name) return;

    onCreateFolder(name);
    setFolderName('');
  };

  const handleRenameFolder = (folder: FavoriteFolder) => {
    const nextName = window.prompt('请输入新的文件夹名称', folder.name);

    if (nextName === null) return;

    onRenameFolder(folder, nextName);
  };

  const handleDeleteFolder = (folder: FavoriteFolder) => {
    const count = folderCountMap.get(folder.id) || 0;
    const ok = window.confirm(`确定要删除文件夹「${folder.name}」吗？\n\n其中的 ${count} 个收藏会移动到「未分组」。`);

    if (!ok) return;

    onDeleteFolder(folder);
  };

  return (
    <div className={styles['fav-overlay']} onClick={onClose}>
      <div className={styles['fav-modal']} onClick={(e) => e.stopPropagation()}>
        <div className={styles['fav-header']}>
          <h3>
            <FontAwesomeIcon icon={faStarSolid} className={styles['fav-header-icon']} />
            我的收藏夹
          </h3>

          <div className={styles['fav-header-actions']}>
            <button className={styles['fav-tool-btn']} onClick={onImportFavorites} title="导入浏览器书签 HTML">
              <FontAwesomeIcon icon={faFileImport} />
              导入
            </button>

            <button className={styles['fav-tool-btn']} onClick={onExportFavorites} title="导出为浏览器书签 HTML">
              <FontAwesomeIcon icon={faFileExport} />
              导出
            </button>

            <select className={styles['fav-sort-select']} value={favSort} onChange={(e) => setFavSort(e.target.value as 'time' | 'title')}>
              <option value="time">按时间</option>
              <option value="title">按标题</option>
            </select>

            <FontAwesomeIcon
              icon={faPlus}
              className={`${styles['action-icon']} ${styles['fav-header-plus']}`}
              title="新增收藏"
              onClick={() =>
                setFavForm({
                  visible: true,
                  title: '',
                  url: '',
                  description: '',
                  logo: '',
                  editingOriginalUrl: '',
                  folderId: selectedFolderId === ALL_FOLDER_ID ? ROOT_FOLDER_ID : selectedFolderId,
                })
              }
            />

            <div className={styles['fav-header-divider']} />

            <FontAwesomeIcon icon={faXmark} className={styles['fav-close']} onClick={onClose} title="关闭" />
          </div>
        </div>

        <div className={styles['fav-page-body']}>
          <aside className={styles['fav-sidebar']}>
            <div className={styles['fav-folder-create']}>
              <input
                className={styles['fav-folder-input']}
                value={folderName}
                placeholder="新增文件夹"
                onChange={(e) => setFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleCreateFolder();
                  }
                }}
              />

              <button className={styles['fav-folder-add']} onClick={handleCreateFolder} title="新增文件夹">
                <FontAwesomeIcon icon={faFolderPlus} />
              </button>
            </div>

            <button
              className={`${styles['fav-folder-item']} ${selectedFolderId === ALL_FOLDER_ID ? styles['fav-folder-active'] : ''}`}
              onClick={() => setSelectedFolderId(ALL_FOLDER_ID)}
            >
              <span className={styles['fav-folder-title']}>
                <FontAwesomeIcon icon={faStarSolid} />
                全部收藏
              </span>
              <span className={styles['fav-folder-count']}>{folderCountMap.get(ALL_FOLDER_ID) || 0}</span>
            </button>

            {favoriteFolders.map((folder) => {
              const active = selectedFolderId === folder.id;

              return (
                <button
                  key={folder.id}
                  className={`${styles['fav-folder-item']} ${active ? styles['fav-folder-active'] : ''}`}
                  onClick={() => setSelectedFolderId(folder.id)}
                >
                  <span className={styles['fav-folder-title']} title={folder.name}>
                    <FontAwesomeIcon icon={faFolder} />
                    {folder.name}
                  </span>

                  <span className={styles['fav-folder-count']}>{folderCountMap.get(folder.id) || 0}</span>

                  {!folder.isDefault && (
                    <span className={styles['fav-folder-actions']} onClick={(e) => e.stopPropagation()}>
                      <FontAwesomeIcon icon={faPen} title="重命名" onClick={() => handleRenameFolder(folder)} />
                      <FontAwesomeIcon icon={faTrash} title="删除文件夹" onClick={() => handleDeleteFolder(folder)} />
                    </span>
                  )}
                </button>
              );
            })}
          </aside>

          <main className={styles['fav-main']}>
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

                <select
                  className={styles['fav-input']}
                  value={favForm.folderId || ROOT_FOLDER_ID}
                  onChange={(e) => setFavForm({ ...favForm, folderId: e.target.value })}
                >
                  {favoriteFolders.map((folder) => (
                    <option key={folder.id} value={folder.id}>
                      {folder.name}
                    </option>
                  ))}
                </select>

                <input
                  type="text"
                  className={styles['fav-input']}
                  placeholder="输入备注信息"
                  value={favForm.description}
                  onChange={(e) => setFavForm({ ...favForm, description: e.target.value })}
                />

                <input
                  type="text"
                  className={styles['fav-input']}
                  placeholder="输入图片地址 / Logo 地址"
                  value={favForm.logo}
                  onChange={(e) => setFavForm({ ...favForm, logo: e.target.value })}
                />

                <div className={styles['fav-form-btns']}>
                  <button
                    className={styles['fav-btn']}
                    onClick={() =>
                      setFavForm({
                        ...favForm,
                        visible: false,
                      })
                    }
                  >
                    取消
                  </button>

                  <button className={`${styles['fav-btn']} ${styles['primary']}`} onClick={onSaveFavorite}>
                    保存
                  </button>
                </div>
              </div>
            )}

            <div className={styles['fav-list']}>
              {displayFavorites.length === 0 ? (
                <div className={styles['fav-empty']}>暂无收藏。点击右上角 + 号，或地址栏星号添加。</div>
              ) : (
                displayFavorites.map((f, i) => (
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
                      {!f.isDefault && (
                        <select
                          className={styles['fav-folder-select']}
                          value={f.folderId || ROOT_FOLDER_ID}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => onMoveFavoriteToFolder(f, e.target.value)}
                        >
                          {favoriteFolders.map((folder) => (
                            <option key={folder.id} value={folder.id}>
                              {folder.name}
                            </option>
                          ))}
                        </select>
                      )}

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
                                description: f.description || '',
                                logo: f.logo || '',
                                editingOriginalUrl: f.url,
                                folderId: f.folderId || ROOT_FOLDER_ID,
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
          </main>
        </div>
      </div>
    </div>
  );
}
