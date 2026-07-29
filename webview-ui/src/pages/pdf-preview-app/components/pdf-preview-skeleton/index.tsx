import Skeleton, { SkeletonTheme } from 'react-loading-skeleton';
import styles from '@pages/pdf-preview-app/components/pdf-preview-skeleton/index.module.css';

/**
 * @description PDF 文档加载骨架屏
 */
export default function PdfPreviewSkeleton() {
  const lineWidths = ['88%', '94%', '76%', '91%', '68%', '84%', '72%', '90%', '64%', '82%'];

  return (
    <SkeletonTheme baseColor="#e5e7eb" highlightColor="#f3f4f6" borderRadius={3} duration={1.35}>
      <div className={styles['pdf-skeleton']}>
        <div className={styles['pdf-skeleton-page']}>
          <div className={styles['pdf-skeleton-content']}>
            <Skeleton width="46%" height={22} />

            <div className={styles['pdf-skeleton-meta']}>
              <Skeleton width="28%" height={10} />
              <Skeleton width="20%" height={10} />
            </div>

            <div className={styles['pdf-skeleton-paragraph']}>
              {lineWidths.slice(0, 5).map((width, index) => (
                <Skeleton key={index} width={width} height={11} />
              ))}
            </div>

            <Skeleton className={styles['pdf-skeleton-image']} width="100%" height={170} />

            <div className={styles['pdf-skeleton-paragraph']}>
              {lineWidths.slice(5).map((width, index) => (
                <Skeleton key={index} width={width} height={11} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </SkeletonTheme>
  );
}
