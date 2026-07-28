import Skeleton, { SkeletonTheme } from 'react-loading-skeleton';

import 'react-loading-skeleton/dist/skeleton.css';

import styles from './index.module.css';

import type { ApiDevToolsSkeletonProps } from '@pages/api-dev-tools-app/components/api-dev-tools-skeleton/src/type';

/**
 * @description 渲染项目接口列表骨架
 */
function WorkspaceSkeleton() {
  return (
    <aside className={styles.workspace}>
      <div className={styles['workspace-head']}>
        <Skeleton width={72} height={14} />

        <Skeleton width={30} height={11} />
      </div>

      <div className={styles['project-list']}>
        {Array.from({ length: 3 }).map((_, projectIndex) => (
          <div key={projectIndex} className={styles['project-card']}>
            <div className={styles['project-card-head']}>
              <Skeleton width="58%" height={13} />

              <Skeleton width={16} height={16} />

              <Skeleton width={16} height={16} />
            </div>

            <div className={styles['project-card-content']}>
              {Array.from({
                length: projectIndex === 0 ? 3 : 2,
              }).map((_, interfaceIndex) => (
                <div key={interfaceIndex} className={styles['interface-row']}>
                  <Skeleton width={38} height={11} />

                  <div className={styles['interface-main']}>
                    <Skeleton width="64%" height={11} />

                    <Skeleton width="88%" height={9} />
                  </div>

                  <Skeleton width={16} height={16} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}

/**
 * @description 渲染请求配置面板骨架
 */
function RequestSkeleton() {
  return (
    <section className={styles.request}>
      <div className={styles['request-line']}>
        <Skeleton height={26} />

        <Skeleton height={26} />

        <Skeleton height={26} />
      </div>

      <div className={styles['request-name-line']}>
        <Skeleton height={26} />

        <Skeleton width={92} height={11} />
      </div>

      <div className={styles.tabs}>
        {Array.from({ length: 7 }).map((_, index) => (
          <Skeleton key={index} width={index === 1 || index === 2 ? 56 : 42} height={12} />
        ))}
      </div>

      <div className={styles['request-panel']}>
        <div className={styles['kv-head']}>
          <Skeleton width={13} height={10} />

          <Skeleton width={42} height={10} />

          <Skeleton width={36} height={10} />

          <span />
        </div>

        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className={styles['kv-row']}>
            <Skeleton width={13} height={13} borderRadius={3} />

            <Skeleton height={26} />

            <Skeleton height={26} />

            <Skeleton width={18} height={18} />
          </div>
        ))}

        <Skeleton width={72} height={24} />
      </div>
    </section>
  );
}

/**
 * @description 渲染历史记录与日志骨架
 */
function BottomSkeleton({ size }: { size: number }) {
  return (
    <div
      className={styles['bottom-panels']}
      style={{
        height: `${size}px`,
        flexBasis: `${size}px`,
      }}
    >
      <div className={styles['bottom-panel']}>
        <Skeleton width={52} height={12} />

        <div className={styles['bottom-panel-list']}>
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className={styles['history-row']}>
              <Skeleton width={34} height={10} />

              <Skeleton width="100%" height={10} />

              <Skeleton width={24} height={10} />
            </div>
          ))}
        </div>
      </div>

      <div className={styles['bottom-panel']}>
        <Skeleton width={52} height={12} />

        <div className={styles['bottom-panel-list']}>
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} width={index % 2 === 0 ? '88%' : '68%'} height={10} />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * @description 渲染请求响应面板骨架
 */
function ResponseSkeleton({ bottomPanelSize }: { bottomPanelSize: number }) {
  return (
    <section className={styles.response}>
      <div className={styles['response-head']}>
        <Skeleton width={96} height={24} />

        <div className={styles['response-head-actions']}>
          <Skeleton width={56} height={11} />

          <Skeleton width={24} height={24} />
        </div>
      </div>

      <div className={styles.tabs}>
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} width={index === 1 ? 62 : 44} height={12} />
        ))}
      </div>

      <div className={styles['response-panel']}>
        <div className={styles['response-code']}>
          {Array.from({ length: 11 }).map((_, index) => (
            <Skeleton key={index} width={`${Math.max(38, 92 - (index % 5) * 11)}%`} height={11} />
          ))}
        </div>
      </div>

      <div className={styles['bottom-resizer']} />

      <BottomSkeleton size={bottomPanelSize} />
    </section>
  );
}

/**
 * @description API 调试工具初始化骨架屏
 */
export default function ApiDevToolsSkeleton({ workspacePaneWidth, workspaceResizerSize, bottomPanelSize }: ApiDevToolsSkeletonProps) {
  return (
    <SkeletonTheme
      baseColor="var(--vscode-list-inactiveSelectionBackground, rgba(127, 127, 127, 0.12))"
      highlightColor="var(--vscode-list-hoverBackground, rgba(127, 127, 127, 0.2))"
      borderRadius={4}
      duration={1.35}
    >
      <div className={styles.page}>
        <main
          className={styles.main}
          style={
            {
              '--api-skeleton-workspace-width': `${workspacePaneWidth}px`,
              '--api-skeleton-workspace-resizer-size': `${workspaceResizerSize}px`,
            } as React.CSSProperties
          }
        >
          <WorkspaceSkeleton />

          <div className={styles['workspace-resizer']} />

          <RequestSkeleton />

          <ResponseSkeleton bottomPanelSize={bottomPanelSize} />
        </main>
      </div>
    </SkeletonTheme>
  );
}
