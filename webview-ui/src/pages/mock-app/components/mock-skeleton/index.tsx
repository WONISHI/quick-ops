import Skeleton, { SkeletonTheme } from 'react-loading-skeleton';

import 'react-loading-skeleton/dist/skeleton.css';

import styles from './index.module.css';

export type MockSkeletonVariant = 'sidebar' | 'proxy' | 'rule';

export interface MockSkeletonProps {
  /**
   * @description 骨架屏页面类型
   */
  variant: MockSkeletonVariant;
}

/**
 * @description Mock 服务侧栏骨架屏
 */
function MockSidebarSkeleton() {
  return (
    <div className={styles.sidebar}>
      <div className={styles['sidebar-header']}>
        <div className={styles['sidebar-header-top']}>
          <div className={styles['sidebar-title']}>
            <Skeleton width={14} height={14} />

            <Skeleton width={82} height={11} />
          </div>

          <Skeleton width={58} height={20} borderRadius={20} />
        </div>

        <div className={styles['sidebar-path']}>
          <Skeleton width={14} height={14} />

          <Skeleton width="72%" height={10} />
        </div>
      </div>

      <div className={styles['sidebar-content']}>
        {Array.from({ length: 3 }).map((_, proxyIndex) => (
          <div key={proxyIndex} className={styles['proxy-card']}>
            <div className={styles['proxy-header']}>
              <Skeleton width={108} height={18} />

              <div className={styles['proxy-header-actions']}>
                <Skeleton width={30} height={16} borderRadius={16} />

                <Skeleton width={16} height={16} />

                <Skeleton width={16} height={16} />
              </div>
            </div>

            <div className={styles['proxy-rules']}>
              {Array.from({
                length: proxyIndex === 0 ? 3 : 2,
              }).map((_, ruleIndex) => (
                <div key={ruleIndex} className={styles['sidebar-rule']}>
                  <div className={styles['sidebar-rule-main']}>
                    <div className={styles['sidebar-rule-line']}>
                      <Skeleton width={34} height={14} />

                      <Skeleton width="68%" height={11} />
                    </div>

                    <Skeleton width="82%" height={9} />
                  </div>

                  <div className={styles['sidebar-rule-actions']}>
                    <Skeleton width={30} height={16} borderRadius={16} />

                    <Skeleton width={16} height={16} />

                    <Skeleton width={16} height={16} />
                  </div>
                </div>
              ))}

              <Skeleton width="100%" height={28} />
            </div>
          </div>
        ))}
      </div>

      <div className={styles['sidebar-footer']}>
        <Skeleton width="100%" height={30} />
      </div>
    </div>
  );
}

/**
 * @description Mock 服务配置面板骨架屏
 */
function MockProxySkeleton() {
  return (
    <div className={styles.panel}>
      <div className={styles['proxy-panel-container']}>
        <Skeleton width={156} height={22} />

        <div className={styles['form-item']}>
          <Skeleton width={186} height={11} />

          <Skeleton width="100%" height={28} />
        </div>

        <div className={styles['form-item']}>
          <Skeleton width={178} height={11} />

          <Skeleton width="100%" height={28} />
        </div>

        <div className={styles.actions}>
          <Skeleton width={58} height={28} />

          <Skeleton width={82} height={28} />
        </div>
      </div>
    </div>
  );
}

/**
 * @description Mock 规则配置面板骨架屏
 */
function MockRuleSkeleton() {
  return (
    <div className={styles.panel}>
      <div className={styles['rule-panel-container']}>
        <Skeleton width={148} height={22} />

        <div className={styles['form-row']}>
          <div className={styles['form-item']}>
            <Skeleton width={42} height={11} />

            <Skeleton width="100%" height={28} />
          </div>

          <div className={styles['form-item-wide']}>
            <Skeleton width={66} height={11} />

            <Skeleton width="100%" height={28} />
          </div>

          <div className={styles['form-item']}>
            <Skeleton width={64} height={11} />

            <Skeleton width="100%" height={28} />
          </div>
        </div>

        <div className={styles['form-row']}>
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className={styles['form-item']}>
              <Skeleton width={72} height={11} />

              <Skeleton width="100%" height={28} />
            </div>
          ))}
        </div>

        <div className={styles.tabs}>
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} width={index === 0 ? 74 : 62} height={12} />
          ))}
        </div>

        <div className={styles['rule-content']}>
          <div className={styles['rule-content-head']}>
            <Skeleton width={126} height={12} />

            <Skeleton width={78} height={26} />
          </div>

          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className={styles['field-row']}>
              <Skeleton width="24%" height={28} />

              <Skeleton width="18%" height={28} />

              <Skeleton width="48%" height={28} />

              <Skeleton width={24} height={24} />
            </div>
          ))}

          <div className={styles['preview-block']}>
            <Skeleton width={92} height={11} />

            <div className={styles['preview-lines']}>
              {Array.from({
                length: 5,
              }).map((_, index) => (
                <Skeleton key={index} width={`${88 - index * 9}%`} height={10} />
              ))}
            </div>
          </div>
        </div>

        <div className={styles.actions}>
          <Skeleton width={58} height={28} />

          <Skeleton width={78} height={28} />
        </div>
      </div>
    </div>
  );
}

/**
 * @description Mock Server Webview 通用初始化骨架屏
 */
export default function MockSkeleton({ variant }: MockSkeletonProps) {
  return (
    <SkeletonTheme
      baseColor="var(--vscode-list-inactiveSelectionBackground, rgba(127, 127, 127, 0.12))"
      highlightColor="var(--vscode-list-hoverBackground, rgba(127, 127, 127, 0.2))"
      borderRadius={4}
      duration={1.35}
    >
      {variant === 'sidebar' && <MockSidebarSkeleton />}

      {variant === 'proxy' && <MockProxySkeleton />}

      {variant === 'rule' && <MockRuleSkeleton />}
    </SkeletonTheme>
  );
}
