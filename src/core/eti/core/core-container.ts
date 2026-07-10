import type { ETICore, ETICoreProvide } from '../eti.type';

export class CoreContainer {
  private cores: ETICore[] = [];

  private registers: ETICoreProvide['register'] = [];

  public register(core: ETICore) {
    this.cores.push(core);

    const result = core.provide();

    this.registers.push(...result.register);
  }

  public inject(events: Record<string, Function[]>) {
    for (const core of this.cores) {
      core.inject?.(events);
    }
  }

  public getRegisters() {
    return this.registers;
  }
}
