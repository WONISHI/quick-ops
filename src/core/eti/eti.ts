import { ETILoader } from '@core/eti/loader/eti-loader';
import { PluginContainer } from '@core/eti/plugin/plugin-container';
import { CoreContainer } from '@core/eti/core/core-container';
import { LifecycleManager } from '@core/eti/lifecycle/lifecycle-manager';

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

    console.log('this', this);
  }
}
