import type * as vscode from 'vscode';
import { Container } from '../container/container';
import type {
  InjectableConstructor,
  InjectionToken,
  Provider,
} from '../container/container.type';
import type { QuickOpsModule } from './quick-ops-module.interface';

export class ModuleRunner {
  private readonly loadedModules = new Set<QuickOpsModule>();
  private readonly providerTokens: InjectionToken[] = [];
  private readonly controllerTypes: InjectableConstructor[] = [];
  private readonly initializedInstances = new Set<any>();

  constructor(
    private readonly container: Container,
    private readonly context: vscode.ExtensionContext,
  ) {}

  public async bootstrap(rootModule: QuickOpsModule): Promise<void> {
    this.collectModule(rootModule);

    await this.initProviders();
    await this.initControllers();
  }

  public async dispose(): Promise<void> {
    await this.destroyControllers();
    await this.destroyProviders();
    await this.container.dispose();

    this.loadedModules.clear();
    this.providerTokens.length = 0;
    this.controllerTypes.length = 0;
    this.initializedInstances.clear();
  }

  private collectModule(module: QuickOpsModule): void {
    if (this.loadedModules.has(module)) return;

    this.loadedModules.add(module);

    for (const importedModule of module.imports ?? []) {
      this.collectModule(importedModule);
    }

    for (const provider of module.providers ?? []) {
      this.registerProvider(provider, true);
    }

    for (const controller of module.controllers ?? []) {
      this.registerProvider(controller, false);
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

  private async destroyControllers(): Promise<void> {
    for (let i = this.controllerTypes.length - 1; i >= 0; i--) {
      const controller = this.controllerTypes[i];

      try {
        const instance = this.container.resolve(controller);
        await instance.onModuleDestroy?.();
        await instance.dispose?.();
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

  private async initInstance(instance: any): Promise<void> {
    if (!instance || this.initializedInstances.has(instance)) return;

    this.initializedInstances.add(instance);

    if (typeof instance.init === 'function') {
      await instance.init(this.context);
    }

    if (typeof instance.onModuleInit === 'function') {
      await instance.onModuleInit(this.context);
    }
  }

  private getProviderToken(provider: Provider): InjectionToken {
    if (typeof provider === 'function') {
      return provider;
    }

    return provider.provide;
  }
}