(function () {
    const vscode = acquireVsCodeApi();
    // 接收插件发来的消息
    window.addEventListener('message', event => {
        const message = event.data; // { type, data }
        if (message.type === 'webview') {

        }
    });
})();