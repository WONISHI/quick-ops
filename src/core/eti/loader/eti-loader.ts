import type { ETIGlobal, ETIPlugin, ETIPluginUse, ETIRuntime } from '@core/eti/eti.type';

type LoaderType = 'plugins' | 'runtimes';

interface LoaderExportResult {
  type: 'eti';
  plugins: ETIPlugin[];
  runtimes: ETIRuntime[];
}

interface WebpackRequireContext {
  keys(): string[];
  <T = any>(id: string): T;
}

interface WebpackRequire {
  context(directory: string, useSubdirectories: boolean, regExp: RegExp): WebpackRequireContext;
}

/**
 * @description webpack 提供的 require.context 类型声明
 *
 * 注意：
 * 这里只声明类型，不要写 typeof require 判断。
 * webpack 看到 require.context 的静态字符串路径后，
 * 才能在编译阶段收集依赖。
 */
declare const require: WebpackRequire;

/**
 * @description ETI Loader
 *
 * 只适配 webpack 打包环境。
 *
 * 这样可以避免：
 * - await import(file)
 * - new Function('return import(...)')
 * - fs 动态扫描
 *
 * 从而解决 webpack warning：
 * Critical dependency: require function is used in a way in which dependencies cannot be statically extracted
 */
export class ETILoader {
  private plugins: ETIPlugin[] = [];
  private runtimes: ETIRuntime[] = [];

  /**
   * @description runtime 暴露给 plugin 使用的全局变量
   */
  private globals: ETIGlobal = {};

  /**
   * @description 加载 ETI 扩展
   *
   * 注意顺序：
   * 1. 先加载 runtimes
   * 2. 收集 runtimes.provide().global
   * 3. 再加载 plugins，并把 use 需要的变量注入 plugin.init(params)
   */
  public async load(_rootPath?: string): Promise<void> {
    this.runtimes = await this.loadRuntimes();

    this.globals = this.collectRuntimeGlobals(this.runtimes);

    this.plugins = await this.loadPlugins();
  }

  /**
   * @description 加载 plugins
   *
   * 当前文件路径：
   * src/core/eti/loader/eti-loader.ts
   *
   * ../../../plugins => src/plugins
   */
  private async loadPlugins(): Promise<ETIPlugin[]> {
    const context = require.context('../../../plugins', true, /(?:index|.*\.plugin)\.(ts|js)$/);

    return this.loadModulesByContext<ETIPlugin>(context, 'plugins');
  }

  /**
   * @description 加载 workflow cores
   *
   * 当前文件路径：
   * src/core/eti/loader/eti-loader.ts
   *
   * ../../../workflow => src/workflow
   *
   * 会加载：
   *
   * 不会加载：
   * - type.ts
   * - types.ts
   */
  private async loadRuntimes(): Promise<ETIRuntime[]> {
    const context = require.context('../../../workflow', true, /(?:index|.*\.(runtime|workflow))\.(ts|js)$/);

    return this.loadModulesByContext<ETIRuntime>(context, 'runtimes');
  }

  /**
   * @description 从 webpack require.context 加载模块
   */
  private async loadModulesByContext<T>(context: WebpackRequireContext, type: LoaderType): Promise<T[]> {
    const result: T[] = [];

    for (const key of context.keys()) {
      try {
        const module = context(key);
        const Target = this.getModuleTarget(module);

        if (!Target) {
          continue;
        }

        const instance = new Target();
        const value = await this.initialize(instance, type);

        if (value) {
          result.push(value);
        }
      } catch (error) {
        console.error(`[ETILoader] ${type} context load failed:`, key, error);
      }
    }

    return result;
  }

  /**
   * @description 执行 plugin / runtime 初始化
   *
   * plugins:
   * - 执行 plugin.init()
   * - 收集 plugin.init() 返回的 { pluginId, on }
   *
   * runtimes:
   * - 不在 loader 里执行 provide()
   * - 直接返回 runtime 实例
   * - 交给 runtimeContainer 调用 runtime.provide()
   */
  private async initialize(instance: any, type: LoaderType): Promise<any> {
    if (type === 'plugins') {
      if (typeof instance.init !== 'function') {
        return undefined;
      }

      const params = this.resolvePluginInitParams(instance);

      return await instance.init(params);
    }

    if (type === 'runtimes') {
      return instance;
    }

    return undefined;
  }

  /**
   * @description 收集 runtime.provide().global
   */
  private collectRuntimeGlobals(runtimes: ETIRuntime[]): ETIGlobal {
    const globals: ETIGlobal = {};

    for (const runtime of runtimes) {
      const provideResult = runtime.provide();
      const runtimeGlobals = provideResult.global || {};

      for (const [key, value] of Object.entries(runtimeGlobals)) {
        if (Object.prototype.hasOwnProperty.call(globals, key)) {
          console.warn(`[ETILoader] global "${key}" from runtime "${runtime.runtimeId}" is overwritten.`);
        }

        globals[key] = value;
      }
    }

    return globals;
  }

  /**
   * @description 根据 plugin.use 生成 plugin.init(params)
   */
  private resolvePluginInitParams(instance: any): ETIGlobal {
    const use = this.getPluginUse(instance);

    if (!use) {
      return {};
    }

    if (this.isPluginUseArray(use)) {
      return this.pickGlobalsByArray(use);
    }

    if (this.isPluginUseAlias(use)) {
      return this.pickGlobalsByAlias(use);
    }

    return {};
  }

  /**
   * @description 判断 plugin.use 是否是数组写法
   *
   * 示例：
   * public readonly use = ['workspaceOn', 'workspaceEvents'] as const;
   */
  private isPluginUseArray(use: ETIPluginUse): use is readonly string[] {
    return Array.isArray(use);
  }

  /**
   * @description 判断 plugin.use 是否是别名对象写法
   *
   * 示例：
   * public readonly use = {
   *   on: 'workspaceOn',
   *   events: 'workspaceEvents',
   * } as const;
   */
  private isPluginUseAlias(use: ETIPluginUse): use is { readonly [key: string]: string } {
    return !Array.isArray(use) && typeof use === 'object' && use !== null;
  }

  /**
   * @description 获取插件声明的 use
   *
   * 支持：
   * public readonly use = ['workspaceOn'] as const;
   * public static use = ['workspaceOn'] as const;
   */
  private getPluginUse(instance: any): ETIPluginUse | undefined {
    return instance.use || instance.constructor?.use;
  }

  /**
   * @description 数组方式注入
   *
   * public readonly use = ['workspaceOn', 'workspaceEvents'] as const;
   *
   * init({ workspaceOn, workspaceEvents }) {}
   */
  private pickGlobalsByArray(use: readonly string[]): ETIGlobal {
    const params: ETIGlobal = {};

    for (const key of use) {
      if (!Object.prototype.hasOwnProperty.call(this.globals, key)) {
        console.warn(`[ETILoader] plugin use "${key}" not found in runtime globals.`);
        continue;
      }

      params[key] = this.globals[key];
    }

    return params;
  }

  /**
   * @description 别名方式注入
   *
   * public readonly use = {
   *   on: 'workspaceOn',
   *   events: 'workspaceEvents'
   * } as const;
   *
   * init({ on, events }) {}
   */
  private pickGlobalsByAlias(use: Record<string, string>): ETIGlobal {
    const params: ETIGlobal = {};

    for (const [alias, globalKey] of Object.entries(use)) {
      if (!Object.prototype.hasOwnProperty.call(this.globals, globalKey)) {
        console.warn(`[ETILoader] plugin use "${globalKey}" not found in runtime globals.`);
        continue;
      }

      params[alias] = this.globals[globalKey];
    }

    return params;
  }

  /**
   * @description 获取模块导出的类
   *
   * 支持：
   * 1. export default class Xxx
   * 2. export class Xxx
   */
  private getModuleTarget(module: any): any {
    if (module.default) {
      return module.default;
    }

    const namedExports = Object.values(module);

    return namedExports.find((value) => {
      return typeof value === 'function';
    });
  }

  public export(): LoaderExportResult {
    return {
      type: 'eti',
      plugins: this.plugins,
      runtimes: this.runtimes,
    };
  }
}
