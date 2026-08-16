import Skeleton, { SkeletonTheme } from 'react-loading-skeleton';
import 'react-loading-skeleton/dist/skeleton.css';
import styles from './index.module.css';

const projectSkeletonItems = [
  { titleWidth: '42%', pathWidth: '68%', showBranch: true },
  { titleWidth: '56%', pathWidth: '82%', showBranch: false },
  { titleWidth: '48%', pathWidth: '74%', showBranch: true },
  { titleWidth: '64%', pathWidth: '88%', showBranch: false },
  { titleWidth: '45%', pathWidth: '70%', showBranch: true },
  { titleWidth: '58%', pathWidth: '80%', showBranch: false },
  { titleWidth: '50%', pathWidth: '76%', showBranch: true },
];

/**
 * @description 最近项目初始化骨架屏
 */
export default function RecentProjectsSkeleton() {
  return (
    <SkeletonTheme
      baseColor="var(--vscode-list-inactiveSelectionBackground, rgba(127, 127, 127, 0.12))"
      highlightColor="var(--vscode-list-hoverBackground, rgba(127, 127, 127, 0.2))"
      borderRadius={4}
      duration={1.35}
    >
      <div className={styles['recent-projects-skeleton-root']}>
        <div className={styles['recent-projects-skeleton-search']}>
          <div className={styles['recent-projects-skeleton-search-box']}>
            <div className={styles['recent-projects-skeleton-search-icon']}>
              <Skeleton width={14} height={14} circle />
            </div>

            <div className={styles['recent-projects-skeleton-search-text']}>
              <Skeleton width="100%" height={11} />
            </div>
          </div>
        </div>

        <div className={styles['recent-projects-skeleton-list']}>
          <div className={styles['recent-projects-skeleton-active']}>
            <div className={styles['recent-projects-skeleton-chevron']}>
              <Skeleton width={10} height={10} />
            </div>

            <div className={styles['recent-projects-skeleton-project-icon']}>
              <Skeleton width={18} height={18} />
            </div>

            <div className={styles['recent-projects-skeleton-info']}>
              <div className={styles['recent-projects-skeleton-title']}>
                <div className={styles['recent-projects-skeleton-active-title-line']}>
                  <Skeleton width="100%" height={11} />
                </div>

                <div className={styles['recent-projects-skeleton-branch']}>
                  <Skeleton width="100%" height={16} borderRadius={10} />
                </div>
              </div>

              <div className={styles['recent-projects-skeleton-active-path']}>
                <Skeleton width="100%" height={8} />
              </div>
            </div>
          </div>

          <div className={styles['recent-projects-skeleton-divider']} />

          {projectSkeletonItems.map((item, index) => (
            <div key={index} className={styles['recent-projects-skeleton-item']}>
              <div className={styles['recent-projects-skeleton-chevron']}>
                <Skeleton width={10} height={10} />
              </div>

              <div className={styles['recent-projects-skeleton-project-icon']}>
                <Skeleton width={18} height={18} />
              </div>

              <div className={styles['recent-projects-skeleton-info']}>
                <div className={styles['recent-projects-skeleton-title']}>
                  <div className={styles['recent-projects-skeleton-title-line']} style={{ width: item.titleWidth }}>
                    <Skeleton width="100%" height={11} />
                  </div>

                  {item.showBranch && (
                    <div className={styles['recent-projects-skeleton-branch']}>
                      <Skeleton width="100%" height={16} borderRadius={10} />
                    </div>
                  )}
                </div>

                <div className={styles['recent-projects-skeleton-path']} style={{ width: item.pathWidth }}>
                  <Skeleton width="100%" height={8} />
                </div>
              </div>

              <div className={styles['recent-projects-skeleton-action']}>
                <Skeleton width={22} height={22} />
              </div>
            </div>
          ))}
        </div>

        <div className={styles['recent-projects-skeleton-bottom']}>
          <div className={styles['recent-projects-skeleton-button']}>
            <Skeleton width="100%" height={28} />
          </div>

          <div className={styles['recent-projects-skeleton-button']}>
            <Skeleton width="100%" height={28} />
          </div>
        </div>
      </div>
    </SkeletonTheme>
  );
}
