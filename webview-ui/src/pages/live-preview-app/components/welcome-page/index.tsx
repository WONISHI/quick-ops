import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFolder, faGlobe, faLayerGroup, faPen, faXmark } from '@fortawesome/free-solid-svg-icons';
import { faVuejs, faNodeJs, faReact } from '@fortawesome/free-brands-svg-icons';
import Scrollbar from '@components/Scrollbar';
import styles from './index.module.css';

interface WelcomeFavoriteItem {
  url: string;
  title: string;
  description?: string;
  logo?: string;
  folderId?: string;
}

interface WelcomeFavoriteFolder {
  id: string;
  name: string;
}

interface WelcomePageProps {
  onQuickOpen: (url: string) => void;
  navigationFavorites: WelcomeFavoriteItem[];
  favoriteFolders: WelcomeFavoriteFolder[];
  onEditFolder: (folderId: string) => void;
  onRemoveNavigation: (favorite: WelcomeFavoriteItem) => void;
}

export default function WelcomePage(props: WelcomePageProps) {
  const { onQuickOpen, navigationFavorites, favoriteFolders, onEditFolder, onRemoveNavigation } = props;
  const folderNameMap = new Map(favoriteFolders.map((folder) => [folder.id, folder.name]));
  const groupedFavorites = new Map<string, WelcomeFavoriteItem[]>();

  navigationFavorites.forEach((favorite) => {
    const folderId = favorite.folderId || 'root';
    const current = groupedFavorites.get(folderId) || [];

    current.push(favorite);
    groupedFavorites.set(folderId, current);
  });

  const navigationGroups = [
    ...favoriteFolders
      .filter((folder) => groupedFavorites.has(folder.id))
      .map((folder) => ({
        id: folder.id,
        name: folder.name,
        favorites: groupedFavorites.get(folder.id) || [],
      })),
    ...Array.from(groupedFavorites.entries())
      .filter(([folderId]) => !folderNameMap.has(folderId))
      .map(([folderId, favorites]) => ({
        id: folderId,
        name: folderId === 'root' ? '未分组' : '其他书签',
        favorites,
      })),
  ];

  return (
    <div className={styles['welcome-page']}>
      <Scrollbar className={styles['welcome-scrollbar']} direction="vertical" height="100%" always>
        <div className={styles['welcome-content']}>
          <FontAwesomeIcon icon={faLayerGroup} className={styles['welcome-icon']} />

          <h1 className={styles['welcome-title']}>Live Preview</h1>

          <p className={styles['welcome-subtitle']}>
            在上方地址栏输入您的本地开发服务器地址，或直接输入关键词进行搜索。
            <br />
            您也可以点击下方快捷选项快速填入：
          </p>

          <div className={styles['quick-links']}>
            <button className={styles['quick-link-btn']} onClick={() => onQuickOpen('localhost:5173')}>
              <FontAwesomeIcon icon={faVuejs} className={styles['brand-icon-vue']} />
              <span>Vite 默认端口 (5173)</span>
            </button>

            <button className={styles['quick-link-btn']} onClick={() => onQuickOpen('localhost:8080')}>
              <FontAwesomeIcon icon={faNodeJs} className={styles['brand-icon-node']} />
              <span>Vue CLI / Webpack (8080)</span>
            </button>

            <button className={styles['quick-link-btn']} onClick={() => onQuickOpen('localhost:3000')}>
              <FontAwesomeIcon icon={faReact} className={styles['brand-icon-react']} />
              <span>React / Next.js (3000)</span>
            </button>
          </div>

          {navigationGroups.length > 0 && (
            <section className={styles['navigation-favorites']} aria-label="导航页书签">
              {navigationGroups.map((group) => (
                <div key={group.id} className={styles['navigation-folder']}>
                  <div className={styles['navigation-folder-title']}>
                    <FontAwesomeIcon icon={faFolder} />
                    <span className={styles['navigation-folder-name']}>{group.name}</span>
                    <span className={styles['navigation-folder-count']}>{group.favorites.length}</span>

                    <button
                      type="button"
                      className={styles['navigation-folder-edit']}
                      title={`编辑「${group.name}」`}
                      aria-label={`编辑「${group.name}」`}
                      onClick={() => onEditFolder(group.id)}
                    >
                      <FontAwesomeIcon icon={faPen} />
                    </button>
                  </div>

                  <div className={styles['navigation-bookmark-list']}>
                    {group.favorites.map((favorite) => (
                      <div
                        key={favorite.url}
                        className={styles['navigation-bookmark']}
                        title={favorite.url}
                        role="link"
                        tabIndex={0}
                        onClick={() => onQuickOpen(favorite.url)}
                        onKeyDown={(event) => {
                          if (event.key !== 'Enter' && event.key !== ' ') return;

                          event.preventDefault();
                          onQuickOpen(favorite.url);
                        }}
                      >
                        <button
                          type="button"
                          className={styles['navigation-bookmark-remove']}
                          title="从导航页移除"
                          aria-label={`从导航页移除「${favorite.title}」`}
                          onClick={(event) => {
                            event.stopPropagation();
                            onRemoveNavigation(favorite);
                          }}
                        >
                          <FontAwesomeIcon icon={faXmark} />
                        </button>

                        <span className={styles['navigation-bookmark-logo']}>
                          <FontAwesomeIcon icon={faGlobe} className={styles['navigation-bookmark-placeholder']} />
                          {favorite.logo && (
                            <img
                              src={favorite.logo}
                              alt=""
                              onError={(event) => {
                                event.currentTarget.style.display = 'none';
                              }}
                            />
                          )}
                        </span>

                        <span className={styles['navigation-bookmark-info']}>
                          <span className={styles['navigation-bookmark-title']}>{favorite.title}</span>
                          <span className={styles['navigation-bookmark-url']}>{favorite.url}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </section>
          )}
        </div>
      </Scrollbar>
    </div>
  );
}
