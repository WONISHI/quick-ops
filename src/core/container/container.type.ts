export type Constructor<T = any> = new (...args: any[]) => T;

/**
 * 注意：
 * 这里不能写 Constructor<T> | string | symbol，
 * 因为你的 ConfigurationService 这种单例类 constructor 是 private。
 */
export type InjectionToken<T = any> = Function | string | symbol;

export type InjectableConstructor<T = any> = Constructor<T> & {
  inject?: InjectionToken[];
};

export interface ClassProvider<T = any> {
  provide: InjectionToken<T>;
  useClass: InjectableConstructor<T>;
}

export interface ValueProvider<T = any> {
  provide: InjectionToken<T>;
  useValue: T;
}

export interface FactoryProvider<T = any> {
  provide: InjectionToken<T>;
  useFactory: (...args: any[]) => T;
  inject?: InjectionToken[];
}

export type Provider<T = any> =
  | InjectableConstructor<T>
  | ClassProvider<T>
  | ValueProvider<T>
  | FactoryProvider<T>;