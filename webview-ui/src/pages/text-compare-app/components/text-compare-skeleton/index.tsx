import Skeleton, { SkeletonTheme } from 'react-loading-skeleton';
import styles from "@pages/text-compare-app/components/text-compare-skeleton/index.module.css"

/**
 * @description 文本对比页面初始化骨架屏
 */
export default function TextCompareSkeleton() {
  return (
    <SkeletonTheme
      baseColor="var(--vscode-list-inactiveSelectionBackground, rgba(127, 127, 127, 0.12))"
      highlightColor="var(--vscode-list-hoverBackground, rgba(127, 127, 127, 0.2))"
      borderRadius={4}
      duration={1.35}
    >
      <div className={styles['compare-container']}>
        <div className={styles['skeleton-header']}>
          <Skeleton width={184} height={18} />

          <div className={styles['skeleton-actions']}>
            <Skeleton width={82} height={30} />
            <Skeleton width={108} height={30} />
          </div>
        </div>

        <div className={styles['skeleton-editors']}>
          {Array.from({ length: 2 }).map((_, index) => (
            <div key={index} className={styles['skeleton-editor-box']}>
              <div className={styles['skeleton-editor-label']}>
                <Skeleton width={126} height={12} />
                <Skeleton width={28} height={10} />
              </div>

              <div className={styles['skeleton-textarea']}>
                {Array.from({ length: 7 }).map((__, lineIndex) => (
                  <Skeleton key={lineIndex} width={`${92 - ((lineIndex + index) % 4) * 11}%`} height={11} />
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className={styles['skeleton-result']}>
          <Skeleton width={320} height={12} />

          <div className={styles['skeleton-result-tools']}>
            <Skeleton width={72} height={12} />
            <Skeleton width={72} height={12} />
            <Skeleton width={112} height={12} />
            <Skeleton width={96} height={12} />
          </div>

          <div className={styles['skeleton-diff-wrapper']}>
            <Skeleton width={62} height={18} />

            <div className={styles['skeleton-diff-lines']}>
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={index} width={`${88 - index * 8}%`} height={11} />
              ))}
            </div>

            <div className={styles['skeleton-divider']} />

            <Skeleton width={62} height={18} />

            <div className={styles['skeleton-diff-lines']}>
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={index} width={`${82 - index * 6}%`} height={11} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </SkeletonTheme>
  );
}