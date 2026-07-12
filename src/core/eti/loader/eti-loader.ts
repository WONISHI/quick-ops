import type { ETIRuntime, ETIPlugin } from '../eti.type';

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
   * @description 加载 ETI 扩展
   *
   * rootPath 参数暂时保留，方便以后扩展，
   * 但 webpack 场景下不需要使用它。
   */
  public async load(_rootPath?: string): Promise<void> {
    this.plugins = await this.loadPlugins();
    this.runtimes = await this.loadRuntimes();
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

      return await instance.init();
    }

    if (type === 'runtimes') {
      return instance;
    }

    return undefined;
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
