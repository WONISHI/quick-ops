import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import type { ETIPlugin, ETICore } from '../eti.type';

type LoaderType = 'plugins' | 'cores';

export class ETILoader {
  private plugins: ETIPlugin[] = [];
  private cores: ETICore[] = [];

  /**
   * @description
   * 加载 ETI 扩展目录
   *
   * @param rootPath
   * plugins / cores目录路径
   */
  public async load(rootPath: string): Promise<void> {
    const pluginPath = path.join(rootPath, 'plugins');
    const corePath = path.join(rootPath, 'cores');

    /**
     * 加载plugins
     */
    this.plugins = await this.loadModules<ETIPlugin>(pluginPath, 'plugins');
    /**
     * 加载cores
     */
    this.cores = await this.loadModules<ETICore>(corePath, 'cores');
  }

  /**
   * @description
   * 扫描目录加载模块
   */
  private async loadModules<T>(directory: string, type: LoaderType): Promise<T[]> {
    const result: T[] = [];

    /**
     * 目录不存在直接跳过
     */
    if (!(await this.exists(directory))) {
      return result;
    }
    const files = await this.readFiles(directory);
    for (const file of files) {
      /**
       * 只加载ts/js
       */
      if (!file.endsWith('.js') && !file.endsWith('.ts')) {
        continue;
      }

      try {
        const module = await import(this.normalizePath(file));
        /**
         * 支持:
         *
         * export default class
         *
         */
        const Target = module.default;
        if (!Target) {
          continue;
        }
        const instance = new Target();
        const value = await this.initialize(instance, type);
        if (value) {
          result.push(value);
        }
      } catch (error) {
        console.error(`[ETILoader] ${type} load failed:`, file, error);
      }
    }

    return result;
  }

  /**
   * @description
   * 执行插件/core初始化
   */
  private async initialize(instance: any, type: LoaderType) {
    /**
     * Plugin
     *
     * plugin.init()
     */
    if (type === 'plugins') {
      if (typeof instance.init !== 'function') {
        return undefined;
      }

      return await instance.init();
    }

    /**
     * Core
     *
     * core 不在这里执行provide
     *
     * 交给 CoreContainer
     *
     */
    if (type === 'cores') {
      return instance;
    }
  }

  /**
   * @description
   * 递归读取文件
   */
  private async readFiles(directory: string): Promise<string[]> {
    const result: string[] = [];

    const entries = await fs.readdir(directory, {
      withFileTypes: true,
    });

    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        result.push(...(await this.readFiles(fullPath)));
      } else {
        result.push(fullPath);
      }
    }

    return result;
  }

  private async exists(file: string) {
    try {
      await fs.access(file);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Windows路径兼容
   */
  private normalizePath(file: string) {
    return file.replace(/\\/g, '/');
  }
  public export() {
    return {
      type: 'eti',
      plugins: this.plugins,
      cores: this.cores,
    };
  }
}
