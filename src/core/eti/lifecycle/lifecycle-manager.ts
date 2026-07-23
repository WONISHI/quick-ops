import { PluginContainer } from '@core/eti/plugin/plugin-container';

export class LifecycleManager {
  constructor(private readonly pluginContainer: PluginContainer) {}

  /**
   * 插件创建前
   */
  public async ready() {
    await this.pluginContainer.emit('ready');
  }

  /**
   * 插件创建后
   */
  public async readied() {
    await this.pluginContainer.emit('readied');
  }

  /**
   * 插件销毁后
   */
  public async disposed() {
    await this.pluginContainer.emit('disposed');
  }

  /**
   * 模块创建前
   */
  public async moduleInitReady(moduleName: string) {
    await this.pluginContainer.emit('moduleInitReady', moduleName);
  }

  /**
   * 模块创建后
   */
  public async moduleInitReadied(moduleName: string, result: any) {
    await this.pluginContainer.emit('moduleInitReadied', moduleName, result);
  }

  /**
   * 模块销毁前
   */
  public async moduleDispose(moduleName: string) {
    await this.pluginContainer.emit('moduleDispose', moduleName);
  }

  /**
   * 模块销毁后
   */
  public async moduleDisposed(moduleName: string, result: any) {
    await this.pluginContainer.emit('moduleDisposed', moduleName, result);
  }
}
