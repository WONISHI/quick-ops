import type { ETIPlugin } from '@core/eti/eti.type';

export class PluginContainer {
  private plugins: ETIPlugin[] = [];

  private on: Record<string, Function[]> = {};

  public register(plugin: ETIPlugin) {
    this.plugins.push(plugin);

    for (const event of plugin.on ?? []) {
      if (!this.on[event.name]) {
        this.on[event.name] = [];
      }

      this.on[event.name].push(event.callback);
    }
  }

  public async emit(name: string, ...args: any[]) {
    const callbacks = this.on[name] ?? [];

    for (const callback of callbacks) {
      await callback(...args);
    }
  }

  public getEvents() {
    return this.on;
  }

  public getPlugins() {
    return this.plugins;
  }
}
