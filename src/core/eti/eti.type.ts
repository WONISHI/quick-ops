export interface ETIPlugin {
  pluginId: string;
  on?: ETIEvent[];
}

export interface ETIEvent {
  name: string;
  callback: (...args: any[]) => any;
}

/**
 * @description Runtime 向外暴露给 plugin 使用的全局能力
 */
export type ETIGlobal = Record<string, any>;

/**
 * @description Plugin 声明需要使用哪些 runtime global
 *
 * 示例一：
 * public readonly use = ['workspaceOn', 'workspaceEvents'] as const;
 *
 * 示例二：
 * public readonly use = {
 *   on: 'workspaceOn',
 *   events: 'workspaceEvents',
 * } as const;
 */
export type ETIPluginUse = readonly string[] | { readonly [key: string]: string };

export interface ETIRuntime {
  runtimeId: string;
  provide(): ETIRuntimeProvide;
  inject?(events: Record<string, Function[]>): void;
}

export interface ETIRuntimeProvide {
  runtimeId: string;
  register: ETIEvent[];

  /**
   * @description 暴露给 plugin init 参数使用
   */
  global?: ETIGlobal;
}