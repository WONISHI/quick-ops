import type { ETIPlugin, ETICore } from '../eti.type';

export class ETILoader {
  private plugins: any[] = [];
  private cores: any[] = [];
  async load(path: string) {
    /**
     * 后续替换 webpack require.context
     */
  }

  export() {
    return {
      plugins: this.plugins,
      cores: this.cores,
    };
  }
}
