import type { ETIRuntime, ETIRuntimeProvide } from '../eti.type';

export class RuntimeContainer {
  private runtimes: ETIRuntime[] = [];

  private registers: ETIRuntimeProvide['register'] = [];

  public register(runtime: ETIRuntime) {
    this.runtimes.push(runtime);

    const result = runtime.provide();

    this.registers.push(...result.register);
  }

  public inject(events: Record<string, Function[]>) {
    for (const runtime of this.runtimes) {
      runtime.inject?.(events);
    }
  }

  public getRegisters() {
    return this.registers;
  }
}
