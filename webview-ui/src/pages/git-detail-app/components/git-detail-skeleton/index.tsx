import Skeleton, { SkeletonTheme } from 'react-loading-skeleton';

import 'react-loading-skeleton/dist/skeleton.css';

import styles from './index.module.css';

const SKELETON_ROW_COUNT = 18;

/**
 * @description Git 提交图形占位
 *
 * 骨架阶段不模拟真实分支连线，
 * 每条提交记录只显示一个小圆点。
 */
function GraphSkeleton() {
  return (
    <div className={styles.graph}>
      <span className={styles['graph-line']} />

      <span className={styles['graph-dot']} />
    </div>
  );
}

/**
 * @description 单条 Git 提交记录骨架
 */
function CommitRowSkeleton({ rowIndex }: { rowIndex: number }) {
  const descriptionWidth = 52 + (rowIndex % 4) * 9;

  const authorWidth = 48 + (rowIndex % 3) * 12;

  return (
    <div className={styles.row}>
      <GraphSkeleton />

      <div className={styles.description}>
        <span
          className={styles['description-line']}
          style={{
            width: `${descriptionWidth}%`,
          }}
        >
          <Skeleton width="100%" height={11} />
        </span>

        {rowIndex % 4 === 0 && (
          <span className={styles['description-tag']}>
            <Skeleton width="100%" height={16} borderRadius={5} />
          </span>
        )}
      </div>

      <div className={styles.date}>
        <Skeleton width={rowIndex % 2 === 0 ? 116 : 92} height={10} />
      </div>

      <div className={styles.author}>
        <span
          className={styles['author-line']}
          style={{
            width: `${authorWidth}%`,
          }}
        >
          <Skeleton width="100%" height={10} />
        </span>
      </div>

      <div className={styles.commit}>
        <Skeleton width={58} height={10} />
      </div>
    </div>
  );
}

/**
 * @description Git 提交详情初始化骨架屏
 */
export default function GitDetailSkeleton() {
  return (
    <SkeletonTheme
      baseColor="var(--vscode-list-inactiveSelectionBackground, rgba(127, 127, 127, 0.12))"
      highlightColor="var(--vscode-list-hoverBackground, rgba(127, 127, 127, 0.22))"
      borderRadius={4}
      duration={1.35}
    >
      <div className={styles.root} aria-label="正在加载提交记录" aria-busy="true">
        {Array.from({
          length: SKELETON_ROW_COUNT,
        }).map((_, rowIndex) => (
          <CommitRowSkeleton key={rowIndex} rowIndex={rowIndex} />
        ))}
      </div>
    </SkeletonTheme>
  );
}
