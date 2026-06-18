import type {
  FactoryProvider,
  InjectableConstructor,
  InjectionToken,
  Provider,
} from './container.type';

function isClassProvider(provider: Provider): provider is {
  provide: InjectionToken;
  useClass: InjectableConstructor;
} {
  return typeof provider === 'object' && provider !== null && 'useClass' in provider;
}

function isValueProvider(provider: Provider): provider is {
  provide: InjectionToken;
  useValue: any;
} {
  return typeof provider === 'object' && provider !== null && 'useValue' in provider;
}

function isFactoryProvider(provider: Provider): provider is FactoryProvider {
  return typeof provider === 'object' && provider !== null && 'useFactory' in provider;
}

export class Container {
  private readonly providers = new Map<InjectionToken, Provider>();
  private readonly instances = new Map<InjectionToken, any>();
  private readonly disposableInstances: any[] = [];

  public registerProvider(provider: Provider): void {
    const token = this.getProviderToken(provider);
    this.providers.set(token, provider);
  }

  public has(token: InjectionToken): boolean {
    return this.providers.has(token) || this.instances.has(token);
  }

  public resolve<T = any>(token: InjectionToken<T>): T {
    if (this.instances.has(token)) {
      return this.instances.get(token);
    }

    const provider = this.providers.get(token);

    if (!provider) {
      if (typeof token === 'function') {
        return this.instantiate(token as InjectableConstructor<T>, token);
      }

      throw new Error(`[Container] 未找到依赖: ${String(token)}`);
    }

    if (typeof provider === 'function') {
      return this.instantiate(provider as InjectableConstructor<T>, token);
    }

    if (isClassProvider(provider)) {
      return this.instantiate(provider.useClass, provider.provide);
    }

    if (isValueProvider(provider)) {
      this.instances.set(provider.provide, provider.useValue);
      this.trackDisposable(provider.useValue);
      return provider.useValue;
    }

    if (isFactoryProvider(provider)) {
      const deps = provider.inject?.map(dep => this.resolve(dep)) ?? [];
      const instance = provider.useFactory(...deps);

      this.instances.set(provider.provide, instance);
      this.trackDisposable(instance);

      return instance as T;
    }

    throw new Error(`[Container] 不支持的 Provider: ${String(token)}`);
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
  }

  private instantiate<T>(
    target: InjectableConstructor<T>,
    token?: InjectionToken<T>,
  ): T {
    const deps = target.inject?.map(dep => this.resolve(dep)) ?? [];
    const instance = new target(...deps);

    if (token) {
      this.instances.set(token, instance);
    }

    this.trackDisposable(instance);

    return instance;
  }

  private getProviderToken(provider: Provider): InjectionToken {
    if (typeof provider === 'function') {
      return provider;
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
}