import Skeleton, { SkeletonTheme } from 'react-loading-skeleton';
import styles from "@pages/excel-preview-app/components/excel-preview-skeletion/index.module.css"

/**
 * @description Excel 表格加载骨架屏
 */
export default function ExcelPreviewSkeleton() {
  const columns = Array.from({ length: 8 });
  const rows = Array.from({ length: 16 });

  return (
    <SkeletonTheme
      baseColor="var(--vscode-list-inactiveSelectionBackground, rgba(127, 127, 127, 0.12))"
      highlightColor="var(--vscode-list-hoverBackground, rgba(127, 127, 127, 0.2))"
      borderRadius={3}
      duration={1.35}
    >
      <div className={styles.container}>
        <div className={styles['skeleton-table-container']}>
          <div className={styles['skeleton-table']}>
            <div className={styles['skeleton-corner']} />

            {columns.map((_, columnIndex) => (
              <div key={`skeleton-column-${columnIndex}`} className={styles['skeleton-column-header']}>
                <Skeleton width={18} height={10} />
              </div>
            ))}

            {rows.map((_, rowIndex) => (
              <div key={`skeleton-row-${rowIndex}`} className={styles['skeleton-row']}>
                <div className={styles['skeleton-row-header']}>
                  <Skeleton width={16} height={10} />
                </div>

                {columns.map((_, columnIndex) => (
                  <div key={`skeleton-cell-${rowIndex}-${columnIndex}`} className={styles['skeleton-cell']}>
                    <Skeleton width={`${58 + ((rowIndex + columnIndex) % 4) * 9}%`} height={10} />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        <div className={styles['skeleton-sheet-tabs']}>
          <Skeleton width={72} height={18} />
          <Skeleton width={84} height={18} />
          <Skeleton width={64} height={18} />
        </div>
      </div>
    </SkeletonTheme>
  );
}