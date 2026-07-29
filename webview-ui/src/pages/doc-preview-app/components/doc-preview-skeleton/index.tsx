import Skeleton, { SkeletonTheme } from 'react-loading-skeleton';
import styles from "@pages/doc-preview-app/components/doc-preview-skeleton/index.module.css"

/**
 * @description Word 文档加载骨架屏
 */
export default function DocPreviewSkeleton() {
  const lineWidths = ['92%', '86%', '78%', '94%', '72%', '88%', '64%', '90%', '82%', '70%'];

  return (
    <div className={styles['skeleton-view']}>
      <div className={styles['skeleton-page']}>
        <SkeletonTheme baseColor="#e5e7eb" highlightColor="#f3f4f6" borderRadius={3} duration={1.35}>
          <div className={styles['skeleton-page-content']}>
            <Skeleton width="42%" height={22} />

            <div className={styles['skeleton-meta']}>
              <Skeleton width="28%" height={10} />
              <Skeleton width="18%" height={10} />
            </div>

            <div className={styles['skeleton-paragraph']}>
              {lineWidths.slice(0, 5).map((width, index) => (
                <Skeleton key={index} width={width} height={11} />
              ))}
            </div>

            <div className={styles['skeleton-heading']}>
              <Skeleton width="34%" height={16} />
            </div>

            <div className={styles['skeleton-paragraph']}>
              {lineWidths.slice(5).map((width, index) => (
                <Skeleton key={index} width={width} height={11} />
              ))}
            </div>

            <div className={styles['skeleton-table']}>
              {Array.from({ length: 12 }).map((_, index) => (
                <Skeleton key={index} width="100%" height={28} borderRadius={0} />
              ))}
            </div>
          </div>
        </SkeletonTheme>
      </div>
    </div>
  );
}