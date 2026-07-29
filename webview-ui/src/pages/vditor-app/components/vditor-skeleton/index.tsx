import Skeleton, { SkeletonTheme } from 'react-loading-skeleton';
import type { VditorSkeletonProps } from '@pages/vditor-app/src/type';
import styles from "@pages/vditor-app/components/vditor-skeleton/index.module.css"
/**
 * @description Markdown 阅读器与编辑器加载骨架屏
 */
export default function VditorSkeleton({ readMode }: VditorSkeletonProps) {
  const lineWidths = ['92%', '84%', '96%', '72%', '88%', '64%', '90%', '76%'];

  return (
    <SkeletonTheme
      baseColor="var(--vscode-list-inactiveSelectionBackground, rgba(127, 127, 127, 0.12))"
      highlightColor="var(--vscode-list-hoverBackground, rgba(127, 127, 127, 0.2))"
      borderRadius={4}
      duration={1.35}
    >
      <div className={styles['vditor-skeleton']}>
        {!readMode && (
          <div className={styles['vditor-skeleton-toolbar']}>
            {Array.from({ length: 12 }).map((_, index) => (
              <Skeleton key={index} width={22} height={22} />
            ))}
          </div>
        )}

        <div className={styles['vditor-skeleton-body']}>
          <Skeleton width="46%" height={28} />

          <div className={styles['vditor-skeleton-meta']}>
            <Skeleton width="28%" height={11} />
            <Skeleton width="18%" height={11} />
          </div>

          <div className={styles['vditor-skeleton-paragraph']}>
            {lineWidths.slice(0, 4).map((width, index) => (
              <Skeleton key={index} width={width} height={12} />
            ))}
          </div>

          <Skeleton className={styles['vditor-skeleton-heading']} width="34%" height={20} />

          <div className={styles['vditor-skeleton-paragraph']}>
            {lineWidths.slice(4).map((width, index) => (
              <Skeleton key={index} width={width} height={12} />
            ))}
          </div>

          <div className={styles['vditor-skeleton-code']}>
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} width={`${88 - index * 8}%`} height={11} />
            ))}
          </div>

          <div className={styles['vditor-skeleton-table']}>
            {Array.from({ length: 12 }).map((_, index) => (
              <Skeleton key={index} width="100%" height={28} borderRadius={0} />
            ))}
          </div>
        </div>
      </div>
    </SkeletonTheme>
  );
}