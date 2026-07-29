export interface VditorAppProps {
  /**
   * true：作为独立路由页面使用
   * false：作为其它页面里的组件使用
   */
  pageMode?: boolean;
}

export interface VditorSkeletonProps {
  /**
   * @description 是否为只读预览模式
   */
  readMode: boolean;
}