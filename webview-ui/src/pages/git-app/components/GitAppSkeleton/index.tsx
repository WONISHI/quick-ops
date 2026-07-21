import Skeleton, { SkeletonTheme } from 'react-loading-skeleton';

import 'react-loading-skeleton/dist/skeleton.css';

import styles from './index.module.css';

const CHANGE_ROW_COUNT = 9;
const GRAPH_ROW_COUNT = 12;

/**
 * @description 工具栏图标占位
 */
function ToolbarActionSkeleton() {
  return (
    <span className={styles['toolbar-action']}>
      <Skeleton width="100%" height="100%" borderRadius={4} />
    </span>
  );
}

/**
 * @description 文件变更行占位
 */
function ChangeRowSkeleton({ rowIndex }: { rowIndex: number }) {
  const fileWidth = 42 + (rowIndex % 4) * 11;

  return (
    <div className={styles['change-row']}>
      <span className={styles['change-row-chevron']}>
        <Skeleton width={10} height={10} />
      </span>

      <span className={styles['change-row-icon']}>
        <Skeleton width={14} height={14} borderRadius={3} />
      </span>

      <span
        className={styles['change-row-name']}
        style={{
          width: `${fileWidth}%`,
        }}
      >
        <Skeleton width="100%" height={10} />
      </span>

      <span className={styles['change-row-status']}>
        <Skeleton width={12} height={10} />
      </span>
    </div>
  );
}

/**
 * @description Git 图形行占位
 */
function GraphRowSkeleton({ rowIndex }: { rowIndex: number }) {
  const messageWidth = 48 + (rowIndex % 5) * 8;

  return (
    <div className={styles['graph-row']}>
      <div className={styles['graph-lane']}>
        <span className={styles['graph-line']} />
        <span className={styles['graph-dot']} />
      </div>

      <span
        className={styles['graph-message']}
        style={{
          width: `${messageWidth}%`,
        }}
      >
        <Skeleton width="100%" height={10} />
      </span>

      <span className={styles['graph-hash']}>
        <Skeleton width={48} height={9} />
      </span>
    </div>
  );
}

/**
 * @description Git 侧边栏首次加载骨架屏
 */
export default function GitAppSkeleton() {
  return (
    <SkeletonTheme
      baseColor="var(--vscode-list-inactiveSelectionBackground, rgba(127, 127, 127, 0.12))"
      highlightColor="var(--vscode-list-hoverBackground, rgba(127, 127, 127, 0.22))"
      borderRadius={4}
      duration={1.35}
    >
      <div className={styles.root} aria-label="正在加载 Git 信息" aria-busy="true">
        <div className={styles.toolbar}>
          <span className={styles['toolbar-title']}>
            <Skeleton width="100%" height={12} />
          </span>

          <div className={styles['toolbar-actions']}>
            {Array.from({
              length: 5,
            }).map((_, index) => (
              <ToolbarActionSkeleton key={index} />
            ))}
          </div>
        </div>

        <div className={styles['commit-box']}>
          <span className={styles['commit-input']}>
            <Skeleton width="100%" height="100%" borderRadius={4} />
          </span>

          <span className={styles['commit-button']}>
            <Skeleton width="100%" height="100%" borderRadius={4} />
          </span>
        </div>

        <div className={styles.content}>
          <section className={styles['changes-section']}>
            <div className={styles['section-header']}>
              <div className={styles['section-title']}>
                <Skeleton width={12} height={12} />

                <span className={styles['section-title-text']}>
                  <Skeleton width="100%" height={10} />
                </span>

                <Skeleton width={20} height={16} borderRadius={999} />
              </div>

              <div className={styles['section-actions']}>
                <ToolbarActionSkeleton />
                <ToolbarActionSkeleton />
              </div>
            </div>

            <div className={styles['change-list']}>
              {Array.from({
                length: CHANGE_ROW_COUNT,
              }).map((_, rowIndex) => (
                <ChangeRowSkeleton key={rowIndex} rowIndex={rowIndex} />
              ))}
            </div>

            <div className={styles['secondary-header']}>
              <Skeleton width={12} height={12} />

              <span className={styles['secondary-title']}>
                <Skeleton width="100%" height={10} />
              </span>

              <Skeleton width={20} height={16} borderRadius={999} />
            </div>
          </section>

          <section className={styles['graph-section']}>
            <div className={styles['section-header']}>
              <div className={styles['section-title']}>
                <Skeleton width={12} height={12} />

                <span className={styles['section-title-text']}>
                  <Skeleton width="100%" height={10} />
                </span>

                <Skeleton width={28} height={16} borderRadius={999} />
              </div>

              <div className={styles['section-actions']}>
                {Array.from({
                  length: 5,
                }).map((_, index) => (
                  <ToolbarActionSkeleton key={index} />
                ))}
              </div>
            </div>

            <div className={styles['graph-list']}>
              {Array.from({
                length: GRAPH_ROW_COUNT,
              }).map((_, rowIndex) => (
                <GraphRowSkeleton key={rowIndex} rowIndex={rowIndex} />
              ))}
            </div>
          </section>
        </div>
      </div>
    </SkeletonTheme>
  );
}
