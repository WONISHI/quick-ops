import type { Dispatch, SetStateAction } from 'react';
import { useMemo, useRef, useState } from 'react';
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
  faMagnifyingGlass,
} from '@fortawesome/free-solid-svg-icons';
import { faCopy as faCopyRegular } from '@fortawesome/free-regular-svg-icons';
import BaseDialog from '@components/BaseDialog';
import BaseSearch from '@components/BaseSearch';
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
  onCreateFolder: (name: string) => string | void;
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
  const [folderSearchKeyword, setFolderSearchKeyword] = useState('');
  const [favoriteSearchOpen, setFavoriteSearchOpen] = useState(false);
  const [favoriteSearchKeyword, setFavoriteSearchKeyword] = useState('');
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [folderName, setFolderName] = useState('');
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const isFolderComposingRef = useRef(false);

  const folderCountMap = useMemo(() => {
    const countMap = new Map<string, number>();

    sortedFavorites.forEach((favorite) => {
      const folderId = favorite.folderId || ROOT_FOLDER_ID;

      countMap.set(folderId, (countMap.get(folderId) || 0) + 1);
      countMap.set(ALL_FOLDER_ID, (countMap.get(ALL_FOLDER_ID) || 0) + 1);
    });

    return countMap;
  }, [sortedFavorites]);

  const folderFavorites = useMemo(() => {
    if (selectedFolderId === ALL_FOLDER_ID) return sortedFavorites;

    return sortedFavorites.filter((favorite) => (favorite.folderId || ROOT_FOLDER_ID) === selectedFolderId);
  }, [selectedFolderId, sortedFavorites]);

  const displayFavorites = useMemo(() => {
    const keyword = favoriteSearchKeyword.trim().toLocaleLowerCase();

    if (!keyword) return folderFavorites;

    return folderFavorites.filter((favorite) => {
      return [favorite.title, favorite.url, favorite.description || ''].some((value) => value.toLocaleLowerCase().includes(keyword));
    });
  }, [favoriteSearchKeyword, folderFavorites]);

  const visibleFolders = useMemo(() => {
    const keyword = folderSearchKeyword.trim().toLocaleLowerCase();

    if (!keyword) return favoriteFolders;

    return favoriteFolders.filter((folder) => folder.name.toLocaleLowerCase().includes(keyword));
  }, [favoriteFolders, folderSearchKeyword]);

  const showAllFolder = !folderSearchKeyword.trim() || '全部收藏'.includes(folderSearchKeyword.trim());

  if (!visible) return null;

  const closeFolderDialog = () => {
    setFolderDialogOpen(false);
    setFolderName('');
    isFolderComposingRef.current = false;
  };

  const openFolderDialog = () => {
    setFavoriteSearchOpen(false);
    setFavoriteSearchKeyword('');
    setFolderName('');
    setFolderDialogOpen(true);
  };

  const handleCloseModal = () => {
    closeFolderDialog();
    setFolderSearchKeyword('');
    setFavoriteSearchOpen(false);
    setFavoriteSearchKeyword('');
    onClose();
  };

  const handleCreateFolder = () => {
    /**
     * 这里不要只依赖 folderName state。
     * 中文输入法刚结束组合输入后立即点击“新增”时，React state 可能还没来得及同步，
     * 直接读 input 当前值可以避免“点了没反应 / 新建不了文件夹”。
     */
    const name = (folderInputRef.current?.value || folderName).trim();

    if (!name) {
      folderInputRef.current?.focus();
      return;
    }

    const createdFolderId = onCreateFolder(name);

    if (createdFolderId) {
      setSelectedFolderId(createdFolderId);
      closeFolderDialog();
    }
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
    <div
      className={[styles['fav-overlay'], folderDialogOpen ? styles['fav-overlay-dialog-open'] : ''].filter(Boolean).join(' ')}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          handleCloseModal();
        }
      }}
    >
      <div className={styles['fav-modal']} onClick={(e) => e.stopPropagation()}>
        <div className={styles['fav-header']}>
          <h3>
            <FontAwesomeIcon icon={faStarSolid} className={styles['fav-header-icon']} />
            我的收藏夹
          </h3>

          <div className={styles['fav-header-actions']}>
            <button
              type="button"
              className={styles['fav-tool-btn']}
              onClick={() => setFavoriteSearchOpen(true)}
              title="搜索当前文件夹中的书签"
            >
              <FontAwesomeIcon icon={faMagnifyingGlass} />
              搜索
            </button>

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

            <FontAwesomeIcon icon={faXmark} className={styles['fav-close']} onClick={handleCloseModal} title="关闭" />
          </div>
        </div>

        <BaseSearch
          open={favoriteSearchOpen}
          standalone
          draggable
          text=""
          placeholder="搜索当前文件夹的标题、地址或备注"
          maxWidth={420}
          size={42}
          initialOffset={{ y: 44 }}
          showNavigation={false}
          result={{
            query: favoriteSearchKeyword,
            current: 0,
            total: displayFavorites.length,
          }}
          formatCount={(_current, total, query) => (query.trim() ? `${total} 条` : '0 条')}
          onQueryChange={setFavoriteSearchKeyword}
          onClose={() => {
            setFavoriteSearchOpen(false);
            setFavoriteSearchKeyword('');
          }}
        />

        <div className={styles['fav-page-body']}>
          <aside className={styles['fav-sidebar']}>
            <div className={styles['fav-folder-search']}>
              <input
                className={styles['fav-folder-input']}
                value={folderSearchKeyword}
                placeholder="搜索文件夹名称"
                onChange={(e) => setFolderSearchKeyword(e.target.value)}
              />

              {folderSearchKeyword && (
                <button type="button" className={styles['fav-folder-search-clear']} title="清空文件夹搜索" onClick={() => setFolderSearchKeyword('')}>
                  <FontAwesomeIcon icon={faXmark} />
                </button>
              )}
            </div>

            <div className={styles['fav-folder-list']}>
              {showAllFolder && (
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
              )}

              {visibleFolders.map((folder) => {
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

              {!showAllFolder && visibleFolders.length === 0 && <div className={styles['fav-folder-empty']}>未找到匹配的文件夹</div>}
            </div>

            <button type="button" className={`${styles['fav-folder-item']} ${styles['fav-folder-add']}`} onClick={openFolderDialog} title="新增文件夹">
              <span className={styles['fav-folder-title']}>
                <FontAwesomeIcon icon={faFolderPlus} />
                新增文件夹
              </span>
            </button>
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
                <div className={styles['fav-empty']}>
                  {favoriteSearchKeyword.trim() ? '未找到匹配的书签。' : '暂无收藏。点击右上角 + 号，或地址栏星号添加。'}
                </div>
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

      <BaseDialog
        open={folderDialogOpen}
        title="新增文件夹"
        width={360}
        placement="center"
        onClose={closeFolderDialog}
        actions={[
          {
            key: 'cancel',
            label: '取消',
            onClick: closeFolderDialog,
          },
          {
            key: 'confirm',
            label: '新增',
            type: 'primary',
            disabled: !folderName.trim(),
            onClick: handleCreateFolder,
          },
        ]}
      >
        <label className={styles['fav-folder-dialog-field']}>
          <span>文件夹名称</span>

          <input
            ref={folderInputRef}
            autoFocus
            className={styles['fav-folder-dialog-input']}
            value={folderName}
            placeholder="请输入文件夹名称"
            onChange={(event) => setFolderName(event.target.value)}
            onCompositionStart={() => {
              isFolderComposingRef.current = true;
            }}
            onCompositionEnd={(event) => {
              isFolderComposingRef.current = false;
              setFolderName(event.currentTarget.value);
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || isFolderComposingRef.current) return;

              event.preventDefault();
              handleCreateFolder();
            }}
          />
        </label>
      </BaseDialog>
    </div>
  );
}
