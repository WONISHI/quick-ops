import type { FactoryProvider, InjectableConstructor, InjectionToken, Provider, ClassProvider, ValueProvider } from './container.type';

function isClassProvider(provider: Provider): provider is ClassProvider {
  return typeof provider === 'object' && provider !== null && 'useClass' in provider;
}

function isValueProvider(provider: Provider): provider is ValueProvider {
  return typeof provider === 'object' && provider !== null && 'useValue' in provider;
}

function isFactoryProvider(provider: Provider): provider is FactoryProvider {
  return typeof provider === 'object' && provider !== null && 'useFactory' in provider;
}

export class Container {
  private readonly providers = new Map<InjectionToken, Provider>();
  private readonly instances = new Map<InjectionToken, any>();
  private readonly disposableInstances: any[] = [];

  /**
   * 用来定位循环依赖：
   * A -> B -> C -> A
   */
  private readonly resolvingStack: string[] = [];

  /**
   * @description 注册 Provider 到依赖注入容器。
   *
   * Provider 通常来自模块的 providers 配置。
   * 容器会根据 provider 解析出 token，并保存到 providers Map 中。
   *
   * 后续调用 container.resolve(token) 时，
   * 容器会通过这个 token 找到 provider，
   * 然后创建实例、注入依赖并缓存。
   *
   * 常见 Provider：
   * - 类 Provider：GitService
   * - useClass：{ provide, useClass }
   * - useValue：{ provide, useValue }
   * - useFactory：{ provide, useFactory, inject }
   *
   * @param provider 需要注册的 Provider
   */
  public registerProvider(provider: Provider): void {
    if (!provider) {
      throw new Error('[Container] 注册 provider 失败：provider 是 undefined，请检查 module.providers 里的 import/export。');
    }

    /**
     * 解析 provider 对应的 token。
     *
     * 类 Provider 的 token 是类本身；
     * 对象 Provider 的 token 是 provide 字段。
     */
    const token = this.getProviderToken(provider);

    if (!token) {
      throw new Error(`[Container] 注册 provider 失败：无法获取 provider token。provider=${this.safeStringify(provider)}`);
    }

    /**
     * 将 token 和 provider 绑定保存。
     *
     * 示例：
     * GitService -> GitService
     * ConfigurationService -> { provide, useValue }
     */
    this.providers.set(token, provider);
  }

  public has(token: InjectionToken): boolean {
    if (!token) return false;

    return this.providers.has(token) || this.instances.has(token);
  }

  public resolve<T = any>(token: InjectionToken<T>): T {
    return this.resolveInternal<T>(token);
  }

  public async dispose(): Promise<void> {
    for (let i = this.disposableInstances.length - 1; i >= 0; i--) {
      const instance = this.disposableInstances[i];

      try {
        await instance.dispose?.();
      } catch (error) {
        console.error('[Container] dispose failed:', error);
      }
    }

    this.disposableInstances.length = 0;
    this.instances.clear();
    this.providers.clear();
    this.resolvingStack.length = 0;
  }

  private resolveInternal<T = any>(token: InjectionToken<T>, requester?: string): T {
    if (!token) {
      const requesterText = requester ? `，请求方: ${requester}` : '';

      throw new Error(`[Container] 未找到依赖: undefined${requesterText}。请检查 static inject、module.providers、module.controllers 或循环引用。`);
    }

    if (this.instances.has(token)) {
      return this.instances.get(token);
    }

    const tokenName = this.describeToken(token);

    if (this.resolvingStack.includes(tokenName)) {
      throw new Error(`[Container] 检测到循环依赖: ${[...this.resolvingStack, tokenName].join(' -> ')}`);
    }

    const provider = this.providers.get(token);

    if (!provider) {
      if (typeof token === 'function') {
        return this.instantiate(token as InjectableConstructor<T>, token);
      }

      const requesterText = requester ? `，请求方: ${requester}` : '';

      throw new Error(`[Container] 未找到依赖: ${tokenName}${requesterText}`);
    }

    if (typeof provider === 'function') {
      return this.instantiate(provider as InjectableConstructor<T>, token);
    }

    if (isClassProvider(provider)) {
      if (!provider.useClass) {
        throw new Error(`[Container] ${this.describeToken(provider.provide)} 的 useClass 是 undefined，请检查 import/export。`);
      }

      return this.instantiate(provider.useClass, provider.provide);
    }

    if (isValueProvider(provider)) {
      this.instances.set(provider.provide, provider.useValue);
      this.trackDisposable(provider.useValue);

      return provider.useValue;
    }

    if (isFactoryProvider(provider)) {
      const deps = this.resolveInjectTokens(provider.inject || [], this.describeToken(provider.provide));

      const instance = provider.useFactory(...deps);

      this.instances.set(provider.provide, instance);
      this.trackDisposable(instance);

      return instance as T;
    }

    throw new Error(`[Container] 不支持的 Provider: ${tokenName}`);
  }

  private instantiate<T>(target: InjectableConstructor<T>, token?: InjectionToken<T>): T {
    if (!target) {
      throw new Error('[Container] instantiate 失败：target 是 undefined，请检查 provider.useClass 或 controllers/providers import。');
    }

    const targetName = this.describeToken(target);
    const instanceToken = token || target;

    if (this.instances.has(instanceToken)) {
      return this.instances.get(instanceToken);
    }

    if (this.resolvingStack.includes(targetName)) {
      throw new Error(`[Container] 检测到循环依赖: ${[...this.resolvingStack, targetName].join(' -> ')}`);
    }

    this.resolvingStack.push(targetName);

    try {
      const injectTokens = target.inject || [];
      const deps = this.resolveInjectTokens(injectTokens, targetName);
      const instance = new target(...deps);

      this.instances.set(instanceToken, instance);
      this.trackDisposable(instance);

      return instance;
    } finally {
      this.resolvingStack.pop();
    }
  }

  private resolveInjectTokens(injectTokens: InjectionToken[], ownerName: string): any[] {
    return injectTokens.map((dep, index) => {
      if (!dep) {
        const injectText = injectTokens.map((item) => this.describeToken(item)).join(', ');

        throw new Error(`[Container] ${ownerName} 的第 ${index + 1} 个 inject 依赖是 undefined。\n` + `inject=[${injectText}]\n` + '请检查对应 import 是否写错、是否忘记 export、或者是否存在循环引用。');
      }

      return this.resolveInternal(dep, ownerName);
    });
  }

  private getProviderToken(provider: Provider): InjectionToken {
    if (!provider) {
      throw new Error('[Container] provider 是 undefined');
    }

    if (typeof provider === 'function') {
      return provider;
    }

    if (!provider.provide) {
      throw new Error(`[Container] provider.provide 是 undefined。provider=${this.safeStringify(provider)}`);
    }

    return provider.provide;
  }

  private trackDisposable(instance: any): void {
    if (!instance) return;
    if (typeof instance.dispose !== 'function') return;

    if (!this.disposableInstances.includes(instance)) {
      this.disposableInstances.push(instance);
    }
  }

  private describeToken(token: any): string {
    if (!token) return 'undefined';

    if (typeof token === 'string') {
      return token;
    }

    if (typeof token === 'symbol') {
      return token.description ? `Symbol(${token.description})` : token.toString();
    }

    if (typeof token === 'function') {
      return token.name || '[anonymous class/function]';
    }

    if (typeof token === 'object') {
      if ('provide' in token) {
        return `Provider(${this.describeToken(token.provide)})`;
      }

      return token.constructor?.name || '[object]';
    }

    return String(token);
  }

  private safeStringify(value: unknown): string {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
}
