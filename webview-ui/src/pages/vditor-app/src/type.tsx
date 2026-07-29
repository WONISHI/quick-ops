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


export type MetaValueType = 'link' | 'tag' | 'boolean' | 'date' | 'text' | 'empty';

export type MetaRole = 'link' | 'copy' | 'icon';

export type MetaDomEventName = keyof HTMLElementEventMap | string;

export interface MetaActionContext {
  event: Event;
  element: HTMLElement;
  key: string;
  value: string;
  type: MetaValueType;
  role: MetaRole;
  iconType?: string;
}

export interface MetaActionTools {
  postMessage: (message: any) => void;
  copy: (text: string) => Promise<void>;
  openExternal: (url: string) => Promise<void>;
  toast: (message: string) => void;
  emit: (eventName: string, payload?: any) => void;
}

export interface MetaActionTrigger {
  on: MetaDomEventName;
  when?: (ctx: MetaActionContext) => boolean;
  preventDefault?: boolean | ((ctx: MetaActionContext) => boolean);
  stopPropagation?: boolean | ((ctx: MetaActionContext) => boolean);
  stopImmediatePropagation?: boolean | ((ctx: MetaActionContext) => boolean);
  run?: (ctx: MetaActionContext, tools: MetaActionTools) => void | Promise<void>;
  command?: string;
  payload?: Record<string, string>;
}

export interface MetaActionNodeConfig {
  enabled?: boolean;
  triggers?: MetaActionTrigger[];
}

export interface MetaCopyActionConfig extends MetaActionNodeConfig {
  visible?: 'hover' | 'always' | 'never';
  title?: string;
}

export interface MetaIconActionConfig {
  enabled?: boolean;
  default?: MetaActionNodeConfig;
  byType?: Partial<Record<MetaValueType, MetaActionNodeConfig>>;
}

export interface VditorMetaActionConfig {
  link?: MetaActionNodeConfig;
  copy?: MetaCopyActionConfig;
  icon?: MetaIconActionConfig;
}