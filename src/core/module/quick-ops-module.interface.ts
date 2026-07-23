import type { InjectableConstructor, InjectionToken, Provider } from '@core/container/container.type';

export interface QuickOpsModule {
  imports?: QuickOpsModule[];
  controllers?: InjectableConstructor[];
  providers?: Provider[];
  exports?: InjectionToken[];
  global?: boolean;
}
