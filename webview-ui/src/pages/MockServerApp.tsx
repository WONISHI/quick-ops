import { useState, useEffect } from 'react';

const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;

// 定义接口类型
interface MockRoute {
    path: string;
    method: string;
    enabled: boolean;
    delay: number;
}

export default function MockServerApp() {
    const [isRunning, setIsRunning] = useState(false);
    const [port, setPort] = useState(3000);
    const [routes, setRoutes] = useState<MockRoute[]>([]);

    // 1. 监听 VS Code 发来的状态数据 (替代原生的 window.addEventListener)
    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            if (message.type === 'updateState') {
                setIsRunning(message.state.isRunning);
                setPort(message.state.port);
                setRoutes(message.state.routes || []);
            }
        };
        window.addEventListener('message', handleMessage);

        // 初始化时，向插件后台请求最新状态
        if (vscode) {
            vscode.postMessage({ type: 'webviewLoaded' });
        }

        return () => window.removeEventListener('message', handleMessage);
    }, []);

    // 2. 发送指令给 VS Code (替代原生按钮的 onclick)
    const toggleServer = () => {
        if (vscode) {
            vscode.postMessage({ type: isRunning ? 'stopServer' : 'startServer', port });
        }
    };

    const toggleRoute = (routePath: string) => {
        if (vscode) {
            vscode.postMessage({ type: 'toggleRoute', path: routePath });
        }
    };

    return (
        <div className="container">
            <div className="header">
                <h2>🚀 Mock 服务管理器</h2>
                {/* 动态绑定 className 和 disabled 状态 */}
                <button
                    className={isRunning ? "danger" : "primary"}
                    onClick={toggleServer}
                >
                    {isRunning ? "⏹ 停止服务" : "▶ 启动服务"}
                </button>
            </div>

            <div className="config-panel">
                <label>
                    端口号:
                    <input
                        type="number"
                        value={port}
                        onChange={e => setPort(Number(e.target.value))}
                        disabled={isRunning}
                    />
                </label>
                <span style={{ marginLeft: '10px', color: isRunning ? 'var(--vscode-testing-iconPassed)' : 'var(--vscode-descriptionForeground)' }}>
                    状态: {isRunning ? `运行中 (http://localhost:${port})` : "已停止"}
                </span>
            </div>

            <div className="route-list">
                <h3>接口列表 ({routes.length})</h3>
                {routes.length === 0 ? (
                    <div style={{ opacity: 0.5 }}>暂无 Mock 接口，请在项目中创建 mock 文件夹。</div>
                ) : (
                    <ul>
                        {routes.map((route, index) => (
                            <li key={index} className="route-item">
                                <span className={`method ${route.method.toLowerCase()}`}>{route.method}</span>
                                <span className="path">{route.path}</span>
                                <label className="switch">
                                    <input
                                        type="checkbox"
                                        checked={route.enabled}
                                        onChange={() => toggleRoute(route.path)}
                                    />
                                    启用
                                </label>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}