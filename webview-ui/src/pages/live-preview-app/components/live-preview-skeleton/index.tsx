import Skeleton, { SkeletonTheme } from 'react-loading-skeleton';

import 'react-loading-skeleton/dist/skeleton.css';

import styles from './index.module.css';

/**
 * @description Live Preview 初始化骨架屏
 */
export default function LivePreviewSkeleton() {
  return (
    <SkeletonTheme
      baseColor="var(--vscode-list-inactiveSelectionBackground, rgba(127, 127, 127, 0.12))"
      highlightColor="var(--vscode-list-hoverBackground, rgba(127, 127, 127, 0.2))"
      borderRadius={4}
      duration={1.35}
    >
      <div className={styles.page}>
        <div className={styles.toolbar}>
          <div className={styles.actions}>
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} width={28} height={28} />
            ))}
          </div>

          <div className={styles['address-bar']}>
            <Skeleton width={20} height={20} borderRadius={5} />

            <Skeleton width="72%" height={12} />

            <Skeleton width={18} height={18} />
          </div>

          <Skeleton width={28} height={28} />

          <div className={styles.divider} />

          <Skeleton width={28} height={28} />

          <Skeleton width={28} height={28} />

          <Skeleton width={28} height={28} />

          <div className={styles.divider} />

          <Skeleton width={28} height={28} />

          <Skeleton width={28} height={28} />
        </div>

        <div className={styles.preview}>
          <div className={styles['preview-window']}>
            <div className={styles['preview-head']}>
              <Skeleton width="32%" height={11} />

              <div className={styles['preview-head-actions']}>
                <Skeleton width={12} height={12} circle />

                <Skeleton width={12} height={12} circle />

                <Skeleton width={12} height={12} circle />
              </div>
            </div>

            <div className={styles['preview-content']}>
              <Skeleton width="34%" height={28} />

              <Skeleton width="58%" height={13} />

              <Skeleton width="48%" height={13} />

              <div className={styles['preview-links']}>
                {Array.from({
                  length: 3,
                }).map((_, index) => (
                  <Skeleton key={index} width="100%" height={38} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </SkeletonTheme>
  );
}