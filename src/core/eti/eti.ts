import { ETILoader } from './loader/eti-loader';
import { PluginContainer } from './plugin/plugin-container';
import { CoreContainer } from './core/core-container';
import { LifecycleManager } from './lifecycle/lifecycle-manager';

export class ETI {
  private readonly loader = new ETILoader();
  private readonly plugins = new PluginContainer();
  private readonly cores = new CoreContainer();
  public readonly lifecycle = new LifecycleManager(this.plugins);

  async init() {
    /**
     * 1.加载plugin
     */
    await this.loader.load('plugins');

    const result = this.loader.export();

    /**
     * 2.注册plugin
     */
    for (const plugin of result.plugins) {
      this.plugins.register(plugin);
    }

    /**
     * 3.加载core
     */
    for (const core of result.cores) {
      this.cores.register(core);
    }

    /**
     * 4.core注入plugin事件
     */
    this.cores.inject(this.plugins.getEvents());

    /**
     * 5.plugin ready
     */
    await this.lifecycle.ready();
  }
}
