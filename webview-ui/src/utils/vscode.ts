interface WebviewApi<StateType> {
  postMessage(message: unknown): void;
  getState(): StateType | undefined;
  setState(newState: StateType): StateType;
}


declare global {
  function acquireVsCodeApi<StateType = unknown>(): WebviewApi<StateType>;
}


class VSCodeAPIWrapper<StateType = unknown> {
    private readonly vsCodeApi?: WebviewApi<StateType>;

    constructor() {
        if (typeof acquireVsCodeApi === 'function') {
            this.vsCodeApi = acquireVsCodeApi();
        }
    }

  public postMessage<M = unknown>(message: M): void {
    if (this.vsCodeApi) {
      this.vsCodeApi.postMessage(message);
    } else {
      console.log('在浏览器环境中拦截消息:', message);
    }
  }

  public getState(): StateType | undefined {
    if (this.vsCodeApi) {
      return this.vsCodeApi.getState();
    }
    return undefined;
  }

  public setState(newState: StateType): StateType | undefined {
    if (this.vsCodeApi) {
      return this.vsCodeApi.setState(newState);
    }
    return undefined; // 明确返回 undefined
  }
}


export const vscode = new VSCodeAPIWrapper<Record<string, unknown>>();