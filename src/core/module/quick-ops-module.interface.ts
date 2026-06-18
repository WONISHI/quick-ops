import type {
  InjectableConstructor,
  InjectionToken,
  Provider,
} from '../container/container.type';

export interface QuickOpsModule {
  imports?: QuickOpsModule[];
  controllers?: InjectableConstructor[];
  providers?: Provider[];
  exports?: InjectionToken[];
  global?: boolean;
}