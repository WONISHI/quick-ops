export interface ETIPlugin {
  pluginId: string;
  on?: ETIEvent[];
}

export interface ETIEvent {
  name: string;
  callback: (...args: any[]) => any;
}

export interface ETIRuntime {
  runtimeId: string;
  provide(): ETIRuntimeProvide;
  inject?(events: Record<string, Function[]>): void;
}

export interface ETIRuntimeProvide {
  runtimeId: string;
  register: ETIEvent[];
}
