class VSCodeAPIWrapper {
    private readonly vsCodeApi: any;

    constructor() {
        if (typeof acquireVsCodeApi === 'function') {
            this.vsCodeApi = acquireVsCodeApi();
        }
    }

    public postMessage(message: any) {
        if (this.vsCodeApi) {
            this.vsCodeApi.postMessage(message);
        } else {
            console.log('在浏览器环境中拦截消息:', message);
        }
    }

    public getState() {
        if (this.vsCodeApi) {
            return this.vsCodeApi.getState();
        }
    }

    public setState(newState: any) {
        if (this.vsCodeApi) {
            return this.vsCodeApi.setState(newState);
        }
    }
}

// 导出单例对象
export const vscode = new VSCodeAPIWrapper();