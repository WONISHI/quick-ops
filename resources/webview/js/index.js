(function () {
    const vscode = acquireVsCodeApi();
    const useCatalogue = [
        { label: '指令', value: 'shell' },
        { label: '服务', value: 'service' },
        { label: '设置', value: 'settings' }
    ]
    document.querySelector('.webview-title-text').innerText = useCatalogue[0].label
    // 接收插件发来的消息
    window.addEventListener('message', event => {
        const message = event.data
        // 初始化
        if (message.type === 'ready') {
            console.log('ready',message)
        }
    });
})();