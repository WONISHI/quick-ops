import * as vscode from 'vscode';
import * as http from 'http';
import * as httpProxy from 'http-proxy';
import { WebSocketServer, WebSocket } from 'ws';
import * as path from 'path';
import * as fs from 'fs';
import { IFeature } from '../core/interfaces/IFeature';
import ColorLog from '../utils/ColorLog';

interface LogMessage {
    type: 'log';
    level: string;
    args: any[];
    location: { file: string; line: number; col: number; };
}

export class ZeroConfigConsoleFeature implements IFeature {
    public readonly id = 'ZeroConfigConsoleFeature';

    private wss?: WebSocketServer;
    private wsPort: number = 0;

    private reporterServer?: http.Server;
    private reporterPort: number = 0;

    private proxyServer?: http.Server;
    private activeTargetPort: number | null = null;

    // 绿色的行内日志高亮样式
    private readonly logDecorationType = vscode.window.createTextEditorDecorationType({
        after: {
            margin: '0 0 0 30px',
            color: '#10B981',
            backgroundColor: '#10B9811A',
            fontWeight: '600',
            textDecoration: 'none; border-radius: 4px; padding: 2px 6px;',
        },
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    });

    private decorationsMap = new Map<string, vscode.DecorationOptions[]>();

    public async activate(context: vscode.ExtensionContext) {
        // 1. 启动接收前端日志的 WebSocket 服务器
        this.startWebSocketServer();

        // 2. 🌟 [Console Ninja 魔法] 启动底层汇报服务器并注入 NODE_OPTIONS
        await this.setupProcessInjection(context);

        // 3. 注册编辑器相关事件
        vscode.workspace.onDidChangeTextDocument((e) => {
            this.clearDecorationsOnEdit(e.document, e.contentChanges);
        }, null, context.subscriptions);

        vscode.window.onDidChangeActiveTextEditor((editor) => {
            if (editor) this.renderDecorations(editor);
        }, null, context.subscriptions);

        context.subscriptions.push(
            vscode.commands.registerCommand('quick-ops.clearInlineLogs', () => {
                this.decorationsMap.clear();
                vscode.window.visibleTextEditors.forEach((editor) => editor.setDecorations(this.logDecorationType, []));
            })
        );

        ColorLog.black(`[${this.id}]`, 'Ninja-Style Zero-Config Activated.');
    }

    // ==========================================
    // 🌟 核心魔法 1：Node.js 底层进程注入 (Console Ninja 同款)
    // ==========================================
    private async setupProcessInjection(context: vscode.ExtensionContext) {
        // A. 启动一个内部 HTTP 服务器，专门用来接收 boot.js 汇报的端口
        this.reporterServer = http.createServer((req, res) => {
            res.writeHead(200);
            res.end('OK');

            if (req.url && req.url.startsWith('/report?port=')) {
                const portStr = req.url.split('=')[1];
                const port = parseInt(portStr, 10);

                // 过滤掉一些无效端口或我们自己的代理端口
                if (port && port > 1024 && port !== this.activeTargetPort) {
                    console.log(`[NinjaHook] 成功在底层拦截到服务启动端口: ${port}`);
                    this.activeTargetPort = port;

                    // 收到目标端口后，立即启动我们的 0 入侵透明代理！
                    this.startTransparentProxy(port);
                }
            }
        });

        this.reporterServer.listen(0, '127.0.0.1', () => {
            const address = this.reporterServer?.address();
            if (address && typeof address === 'object') {
                this.reporterPort = address.port;
                this.injectNodeOptions(context);
            }
        });
    }

    private injectNodeOptions(context: vscode.ExtensionContext) {
        // B. 将底层劫持脚本 (boot.js) 写入到插件的全局存储目录中
        const storageUri = context.globalStorageUri;
        if (!fs.existsSync(storageUri.fsPath)) {
            fs.mkdirSync(storageUri.fsPath, { recursive: true });
        }

        const bootScriptPath = path.join(storageUri.fsPath, 'quickops-boot.js');

        // 🌟 这是即将注入到用户 Node.js 进程的最底层的劫持代码
        const bootScriptContent = `
      const net = require('net');
      const http = require('http');

      // 劫持底层 TCP Listen
      const originalListen = net.Server.prototype.listen;
      net.Server.prototype.listen = function(...args) {
          let port = null;
          if (typeof args[0] === 'number') {
              port = args[0];
          } else if (typeof args[0] === 'object' && args[0] !== null && args[0].port) {
              port = args[0].port;
          }

          // 发现服务绑定了端口，立刻向 VS Code 插件汇报
          if (port && port > 1024) {
              const req = http.request({
                  hostname: '127.0.0.1',
                  port: ${this.reporterPort}, // 动态填入我们的汇报端口
                  path: '/report?port=' + port,
                  method: 'GET'
              });
              req.on('error', () => {}); // 忽略错误，防止阻断正常流程
              req.end();
          }

          // 放行原始的 listen 逻辑，Vite/Webpack 正常启动
          return originalListen.apply(this, args);
      };
    `;

        // 每次启动都覆盖写入最新脚本
        fs.writeFileSync(bootScriptPath, bootScriptContent, 'utf-8');

        // C. 核心魔法：使用 VS Code API，为集成终端投毒 NODE_OPTIONS
        // 这意味着用户在 VS Code 终端里执行的任何 node 命令，都会先执行我们的 boot.js
        const envCollection = context.environmentVariableCollection;

        // 处理路径中可能存在的空格
        const safeBootPath = bootScriptPath.replace(/\\/g, '/');
        const nodeOptionsValue = ` --require="${safeBootPath}"`;

        // 追加到现有的 NODE_OPTIONS 中
        envCollection.append('NODE_OPTIONS', nodeOptionsValue);

        console.log(`[NinjaHook] 终端环境变量投毒成功: ${nodeOptionsValue}`);
    }

    // ==========================================
    // 🌟 核心魔法 2：内存透明代理注入 (无缝塞入 JS)
    // ==========================================
    private async startTransparentProxy(targetPort: number) {
        if (this.proxyServer) {
            this.proxyServer.close();
        }

        // @ts-ignore
        const proxy: any = httpProxy.createProxyServer({
            target: `http://localhost:${targetPort}`,
            ws: true,
            selfHandleResponse: true
        });

        proxy.on('proxyRes', (proxyRes: any, req: any, res: any) => {
            let bodyChunks: Buffer[] = [];

            proxyRes.on('data', (chunk: Buffer) => bodyChunks.push(chunk));

            proxyRes.on('end', () => {
                let content: Buffer = Buffer.concat(bodyChunks);
                const contentType: string | undefined = proxyRes.headers['content-type'];

                if (contentType && contentType.includes('text/html')) {
                    let htmlString: string = content.toString('utf-8');
                    const injectScript: string = this.getInjectScript();

                    // 在 <head> 标签内部注入劫持脚本
                    htmlString = htmlString.replace(/(<head[^>]*>)/i, `$1\n${injectScript}\n`);
                    content = Buffer.from(htmlString, 'utf-8');

                    proxyRes.headers['content-length'] = content.length.toString();
                }

                res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
                res.end(content);
            });
        });

        proxy.on('error', (err: any, req: any, res: any) => {
            const response = res as http.ServerResponse;
            if (response && response.writeHead && !response.headersSent) {
                response.writeHead(502);
                response.end(`QuickOps Proxy Error: 无法连接到本地服务 http://localhost:${targetPort}。错误信息: ${err.message}`);
            }
        });

        this.proxyServer = http.createServer((req, res) => {
            delete req.headers['accept-encoding'];
            proxy.web(req, res);
        });

        this.proxyServer.on('upgrade', (req, socket, head) => {
            proxy.ws(req, socket, head);
        });

        // 🌟 修复 2：代理服务器也绑定到 localhost
        this.proxyServer.listen(0, 'localhost', () => {
            const address = this.proxyServer?.address();
            if (address && typeof address === 'object') {
                const proxyPort = address.port;
                const proxyUrl = `http://localhost:${proxyPort}`;

                // 🌟 修复 3：在终端/输出面板明确打印出代理 URL，防止你点错
                console.log(`[QuickOps] 代理注入成功！请访问此链接查看页面 (不要点终端里的原始链接): ${proxyUrl}`);

                setTimeout(() => {
                    vscode.window.showInformationMessage(`🚀 QuickOps 已从底层接管进程并注入日志分析！`, '在外部浏览器打开', '在内部预览打开').then(selection => {
                        if (selection === '在内部预览打开') {
                            vscode.commands.executeCommand('simpleBrowser.api.open', vscode.Uri.parse(proxyUrl), {
                                viewColumn: vscode.ViewColumn.Beside
                            });
                        } else if (selection === '在外部浏览器打开') {
                            // 允许你一键在谷歌浏览器打开正确的代理地址
                            vscode.env.openExternal(vscode.Uri.parse(proxyUrl));
                        }
                    });
                }, 1000);
            }
        });
    }

    // ==========================================
    // 日志接收与行内渲染引擎 (保持高效逻辑)
    // ==========================================
    private startWebSocketServer() {
        this.wss = new WebSocketServer({ port: 0 });

        this.wss.on('listening', () => {
            const address = this.wss?.address();
            if (address && typeof address === 'object') this.wsPort = address.port;
        });

        this.wss.on('connection', (ws: WebSocket) => {
            ws.on('message', (message: string) => {
                try {
                    const data = JSON.parse(message.toString()) as LogMessage;
                    if (data.type === 'log' && data.location) this.handleIncomingLog(data);
                } catch (e) { }
            });
        });
    }

    private handleIncomingLog(data: LogMessage) {
        if (!data.location.file) return;

        const displayValue = data.args.map(arg => {
            if (arg === null) return 'null';
            if (arg === undefined) return 'undefined';
            if (typeof arg === 'object') return JSON.stringify(arg);
            return String(arg);
        }).join(' ');

        const truncatedValue = displayValue.length > 150 ? displayValue.substring(0, 150) + '...' : displayValue;
        const contentText = `🚀 ${truncatedValue}`;

        const targetPathSuffix = data.location.file.split('?')[0];

        for (const editor of vscode.window.visibleTextEditors) {
            const fsPath = editor.document.uri.fsPath.replace(/\\/g, '/');
            if (fsPath.endsWith(targetPathSuffix)) {
                const lineIndex = Math.max(0, data.location.line - 1);

                const range = new vscode.Range(lineIndex, 0, lineIndex, Number.MAX_VALUE);
                const decoration: vscode.DecorationOptions = {
                    range,
                    renderOptions: { after: { contentText } },
                    hoverMessage: `**Console ${data.level.toUpperCase()}**\n\n\`\`\`json\n${JSON.stringify(data.args, null, 2)}\n\`\`\``
                };

                let fileDecorations = this.decorationsMap.get(fsPath) || [];
                fileDecorations = fileDecorations.filter(d => d.range.start.line !== lineIndex);
                fileDecorations.push(decoration);

                if (fileDecorations.length > 100) fileDecorations.shift();

                this.decorationsMap.set(fsPath, fileDecorations);
                this.renderDecorations(editor);
                break;
            }
        }
    }

    private renderDecorations(editor: vscode.TextEditor) {
        const fsPath = editor.document.uri.fsPath.replace(/\\/g, '/');
        const decorations = this.decorationsMap.get(fsPath) || [];
        editor.setDecorations(this.logDecorationType, decorations);
    }

    private clearDecorationsOnEdit(document: vscode.TextDocument, changes: readonly vscode.TextDocumentContentChangeEvent[]) {
        if (changes.length === 0) return;
        const fsPath = document.uri.fsPath.replace(/\\/g, '/');
        let decorations = this.decorationsMap.get(fsPath);
        if (!decorations) return;

        let needsUpdate = false;
        for (const change of changes) {
            const changedLine = change.range.start.line;
            const originalLen = decorations.length;
            decorations = decorations.filter(d => Math.abs(d.range.start.line - changedLine) > 1);
            if (decorations.length !== originalLen) needsUpdate = true;
        }

        if (needsUpdate) {
            this.decorationsMap.set(fsPath, decorations);
            const editor = vscode.window.visibleTextEditors.find(e => e.document === document);
            if (editor) this.renderDecorations(editor);
        }
    }

    public getInjectScript(): string {
        return INJECT_SCRIPT_TEMPLATE.replace('__WS_PORT__', this.wsPort.toString());
    }
}

// ==========================================
// 注入的浏览器端代码
// ==========================================
const INJECT_SCRIPT_TEMPLATE = `
<script>
(function() {
    if (window.__QUICK_OPS_CONSOLE_INJECTED__) return;
    window.__QUICK_OPS_CONSOLE_INJECTED__ = true;

    const ws = new WebSocket('ws://localhost:__WS_PORT__');
    let wsReady = false;
    let logQueue = [];

    ws.onopen = () => {
        wsReady = true;
        logQueue.forEach(msg => ws.send(msg));
        logQueue = [];
    };

    function safeStringify(obj) {
        let cache = new Set();
        try {
            return JSON.parse(JSON.stringify(obj, (key, value) => {
                if (typeof value === 'object' && value !== null) {
                    if (cache.has(value)) return '[Circular]';
                    cache.add(value);
                }
                return value;
            }));
        } catch(e) { return String(obj); }
    }

    function getCallerLocation() {
        try { throw new Error(); } catch (e) {
            const stack = e.stack;
            if (!stack) return null;
            const lines = stack.split('\\n');
            for (let i = 3; i < lines.length; i++) {
                const line = lines[i];
                if (line.includes('node_modules') || line.includes('__QUICK_OPS')) continue;
                const match = line.match(/(http:\\/\\/[^/]+)?(\\/[^?:]+)[^:]*:(\\d+):(\\d+)/);
                if (match) {
                    return { file: match[2], line: parseInt(match[3]), col: parseInt(match[4]) };
                }
            }
        }
        return null;
    }

    const originalConsole = {
        log: console.log,
        info: console.info,
        warn: console.warn,
        error: console.error
    };

    ['log', 'info', 'warn', 'error'].forEach(level => {
        console[level] = function(...args) {
            originalConsole[level].apply(console, args);
            
            const location = getCallerLocation();
            if (!location) return; 

            const msg = JSON.stringify({
                type: 'log',
                level,
                args: args.map(a => typeof a === 'object' ? safeStringify(a) : a),
                location
            });

            if (wsReady) ws.send(msg);
            else logQueue.push(msg);
        };
    });
})();
</script>
`;