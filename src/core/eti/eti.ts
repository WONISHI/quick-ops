import { ETILoader } from '@core/eti/loader/eti-loader';
import { PluginContainer } from '@core/eti/plugin/plugin-container';
import { RuntimeContainer } from '@/core/eti/runtime/runtime-container';
import { LifecycleManager } from '@core/eti/lifecycle/lifecycle-manager';

export class ETI {
  private readonly loader = new ETILoader();
  private readonly plugins = new PluginContainer();
  private readonly runtimes = new RuntimeContainer();
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
     * 3.加载runtime
     */
    for (const runtime of result.runtimes) {
      this.runtimes.register(runtime);
    }

    /**
     * 4.runtime注入plugin事件
     */
    this.runtimes.inject(this.plugins.getEvents());
  }
}
