import React from 'react';
import Skeleton, { SkeletonTheme } from 'react-loading-skeleton';
import 'react-loading-skeleton/dist/skeleton.css';
import styles from './index.module.css';

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
            <Skeleton width={14} height={14} circle />
            <Skeleton width="68%" height={11} />
          </div>
        </div>

        <div className={styles['recent-projects-skeleton-list']}>
          <div className={styles['recent-projects-skeleton-active']}>
            <div className={styles['recent-projects-skeleton-chevron']}>
              <Skeleton width={10} height={10} />
            </div>

            <Skeleton width={18} height={18} />

            <div className={styles['recent-projects-skeleton-info']}>
              <div className={styles['recent-projects-skeleton-title']}>
                <Skeleton width="46%" height={12} />
                <Skeleton width={54} height={16} borderRadius={10} />
              </div>

              <Skeleton width="76%" height={9} />
            </div>
          </div>

          <div className={styles['recent-projects-skeleton-divider']} />

          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className={styles['recent-projects-skeleton-item']}>
              <div className={styles['recent-projects-skeleton-chevron']}>
                <Skeleton width={10} height={10} />
              </div>

              <Skeleton width={18} height={18} />

              <div className={styles['recent-projects-skeleton-info']}>
                <div className={styles['recent-projects-skeleton-title']}>
                  <Skeleton width={`${42 + (index % 3) * 9}%`} height={12} />

                  {index % 2 === 0 && <Skeleton width={48} height={16} borderRadius={10} />}
                </div>

                <Skeleton width={`${68 + (index % 4) * 6}%`} height={9} />
              </div>

              <Skeleton width={22} height={22} />
            </div>
          ))}
        </div>

        <div className={styles['recent-projects-skeleton-bottom']}>
          <Skeleton width="100%" height={30} />
          <Skeleton width="100%" height={30} />
        </div>
      </div>
    </SkeletonTheme>
  );
}
