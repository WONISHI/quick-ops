import type * as vscode from 'vscode';
import { ETI } from '@core/eti/eti';
import { Container } from '@core/container/container';
import type { InjectableConstructor, InjectionToken, Provider } from '@core/container/container.type';
import type { QuickOpsModule } from '@core/module/quick-ops-module.interface';

export class ModuleRunner {
  private readonly loadedModules = new Set<QuickOpsModule>();
  private readonly providerTokens: InjectionToken[] = [];
  private readonly controllerTypes: InjectableConstructor[] = [];
  private readonly initializedInstances = new Set<any>();

  constructor(
    private readonly container: Container,
    private readonly context: vscode.ExtensionContext,
    private readonly eti: ETI,
  ) {}

  public async bootstrap(rootModule: QuickOpsModule): Promise<void> {
    this.collectModule(rootModule);

    await this.initProviders();
    await this.initControllers();
  }

  /**
   * @description
   * 销毁所有模块
   *
   * 顺序：
   *
   * controller
   *      |
   * moduleDispose
   *      |
   * dispose
   *      |
   * moduleDisposed
   *
   * provider
   *      |
   * onModuleDestroy
   */
  public async dispose(): Promise<void> {
    await this.destroyControllers();
    await this.destroyProviders();
    await this.container.dispose();

    this.loadedModules.clear();
    this.providerTokens.length = 0;
    this.controllerTypes.length = 0;
    this.initializedInstances.clear();
  }

  /**
   * @description 递归收集模块。
   *
   * 负责读取模块中的 imports、providers、controllers：
   * - imports：递归收集依赖模块
   * - providers：注册到依赖注入容器
   * - controllers：注册到容器，并保存起来等待后续初始化
   *
   * loadedModules 用来避免同一个模块被重复注册，
   * 也可以防止循环 imports 导致无限递归。
   *
   * @param module 当前需要收集的模块
   */
  private collectModule(module: QuickOpsModule): void {
    /**
     * 模块已经收集过则跳过，避免重复注册和循环递归。
     */
    if (this.loadedModules.has(module)) return;

    /**
     * 标记模块已加载。
     */
    this.loadedModules.add(module);

    /**
     * 先收集 imports 中的依赖模块。
     *
     * 这样可以保证公共模块或依赖模块中的 provider
     * 先于当前模块完成注册。
     */
    for (const importedModule of module.imports ?? []) {
      this.collectModule(importedModule);
    }

    /**
     * 注册当前模块声明的 providers。
     *
     * providers 一般包括 service、provider、useValue、useFactory 等。
     */
    for (const provider of module.providers ?? []) {
      this.registerProvider(provider, true);
    }

    /**
     * 注册当前模块声明的 controllers。
     *
     * controller 也需要注册到容器中，后续才能通过 container.resolve()
     * 自动创建实例并注入依赖。
     */
    for (const controller of module.controllers ?? []) {
      this.registerProvider(controller, false);

      /**
       * 保存 controller 类型。
       *
       * 后续会统一实例化 controller，
       * 并调用 onModuleInit() 执行模块初始化逻辑。
       */
      this.controllerTypes.push(controller);
    }
  }

  private registerProvider(provider: Provider, needInit: boolean): void {
    const token = this.getProviderToken(provider);

    if (!this.container.has(token)) {
      this.container.registerProvider(provider);
    }

    if (needInit && !this.providerTokens.includes(token)) {
      this.providerTokens.push(token);
    }
  }

  private async initProviders(): Promise<void> {
    for (const token of this.providerTokens) {
      const instance = this.container.resolve(token);
      await this.initInstance(instance);
    }
  }

  private async initControllers(): Promise<void> {
    for (const controller of this.controllerTypes) {
      const instance = this.container.resolve(controller);
      await this.initInstance(instance);
    }
  }

  /**
   * @description
   * controller销毁
   *
   * 倒序销毁
   */
  private async destroyControllers(): Promise<void> {
    for (let i = this.controllerTypes.length - 1; i >= 0; i--) {
      const controller = this.controllerTypes[i];

      try {
        const instance = this.container.resolve(controller);

        const moduleName = instance.constructor.name;

        /**
         * 模块销毁前
         *
         * Plugin生命周期
         */
        await this.eti.lifecycle.moduleDispose(moduleName);

        /**
         * Nest生命周期
         */
        await instance.onModuleDestroy?.();

        /**
         * 模块自身销毁
         */
        const result = await instance.dispose?.();

        /**
         * 模块销毁后
         *
         * Plugin生命周期
         */
        await this.eti.lifecycle.moduleDisposed(moduleName, result);
      } catch (error) {
        console.error('[ModuleRunner] controller destroy failed:', error);
      }
    }
  }

  private async destroyProviders(): Promise<void> {
    for (let i = this.providerTokens.length - 1; i >= 0; i--) {
      const token = this.providerTokens[i];

      try {
        const instance = this.container.resolve(token);
        await instance.onModuleDestroy?.();
      } catch (error) {
        console.error('[ModuleRunner] provider destroy failed:', error);
      }
    }
  }

  /**
   * @description
   * 初始化实例
   *
   * 生命周期：
   *
   * moduleInitReady
   *          |
   * instance.init
   *          |
   * instance.onModuleInit
   *          |
   * moduleInitReadied
   */
  private async initInstance(instance: any): Promise<void> {
    if (!instance || this.initializedInstances.has(instance)) {
      return;
    }

    this.initializedInstances.add(instance);

    const moduleName = instance.constructor.name;

    /**
     * 模块创建前
     *
     * Plugin生命周期
     */
    if (typeof instance.onModuleInit === 'function') {
      await this.eti.lifecycle.moduleInitReady(moduleName);
    }

    /**
     * 普通初始化
     */
    if (typeof instance.init === 'function') {
      await instance.init(this.context);
    }

    if (typeof instance.onModuleInit === 'function') {
      const result = await instance.onModuleInit(this.context);

      /**
       * 模块创建后
       *
       * Plugin生命周期
       */
      await this.eti.lifecycle.moduleInitReadied(moduleName, result);
    }
  }

  private getProviderToken(provider: Provider): InjectionToken {
    if (typeof provider === 'function') {
      return provider;
    }

    return provider.provide;
  }
}
