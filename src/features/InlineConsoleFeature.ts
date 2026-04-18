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
        this.startWebSocketServer();
        await this.setupProcessInjection(context);

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

        // 🌟 新增指令：手动召唤带有强制注入环境的专属终端
        context.subscriptions.push(
            vscode.commands.registerCommand('quick-ops.openInjectedTerminal', () => {
                this.openInjectedTerminal(context);
            })
        );

        ColorLog.black(`[${this.id}]`, 'Ninja-Style Zero-Config Activated.');
    }

    private async setupProcessInjection(context: vscode.ExtensionContext) {
        this.reporterServer = http.createServer((req, res) => {
            res.writeHead(200, { 'Access-Control-Allow-Origin': '*' });
            res.end('OK');

            if (req.url && req.url.startsWith('/report?port=')) {
                const port = parseInt(req.url.split('=')[1], 10);
                if (port && port > 1024) {
                    if (this.activeTargetPort === null) {
                        console.log(`[NinjaHook] 🎯 VS Code 收到前端服务端口: ${port}`);
                        this.activeTargetPort = port;
                        this.startTransparentProxy(port);
                    }
                }
            } else if (req.url && req.url.startsWith('/close?port=')) {
                const port = parseInt(req.url.split('=')[1], 10);
                if (this.activeTargetPort === port) {
                    console.log(`[NinjaHook] 🛑 目标主服务已关闭，释放端口: ${port}`);
                    this.activeTargetPort = null;
                    if (this.proxyServer) {
                        this.proxyServer.close();
                        this.proxyServer = undefined;
                    }
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
        const storageUri = context.globalStorageUri;
        if (!fs.existsSync(storageUri.fsPath)) {
            fs.mkdirSync(storageUri.fsPath, { recursive: true });
        }

        const bootScriptPath = path.join(storageUri.fsPath, 'quickops-boot.js');

        const bootScriptContent = `
      const net = require('net');
      const http = require('http');

      console.log('\\x1b[36m[QuickOps Boot] 🚀 成功潜入 Node.js 底层进程！等待捕获端口...\\x1b[0m');

      const originalListen = net.Server.prototype.listen;
      net.Server.prototype.listen = function(...args) {
          const server = originalListen.apply(this, args);

          server.once('listening', () => {
              try {
                  const addr = server.address();
                  if (addr && typeof addr === 'object' && addr.port && addr.port > 1024) {
                      const finalPort = addr.port;
                      
                      console.log('\\x1b[36m[QuickOps Boot] 🎯 捕获到服务监听端口: ' + finalPort + '\\x1b[0m');

                      const req = http.request({
                          hostname: '127.0.0.1',
                          port: ${this.reporterPort}, 
                          path: '/report?port=' + finalPort,
                          method: 'GET'
                      });
                      req.on('error', () => {}); 
                      req.end();

                      server.once('close', () => {
                          console.log('\\x1b[36m[QuickOps Boot] 🛑 服务已关闭: ' + finalPort + '\\x1b[0m');
                          const reqClose = http.request({
                              hostname: '127.0.0.1',
                              port: ${this.reporterPort}, 
                              path: '/close?port=' + finalPort,
                              method: 'GET'
                          });
                          reqClose.on('error', () => {}); 
                          reqClose.end();
                      });
                  }
              } catch (e) {}
          });

          return server;
      };
    `;

        fs.writeFileSync(bootScriptPath, bootScriptContent, 'utf-8');

        // 依然保留全局注入尝试，将 append 改为 prepend，提高执行优先级
        const envCollection = context.environmentVariableCollection;
        const safeBootPath = bootScriptPath.replace(/\\/g, '/');
        // Node_OPTIONS 前置注入，防冲突
        envCollection.prepend('NODE_OPTIONS', `--require="${safeBootPath}" `);
    }

    // 🌟 核心破局点：手动创建终端并强制捆绑环境变量
    private openInjectedTerminal(context: vscode.ExtensionContext) {
        const storageUri = context.globalStorageUri;
        const bootScriptPath = path.join(storageUri.fsPath, 'quickops-boot.js');
        const safeBootPath = bootScriptPath.replace(/\\/g, '/');

        // 通过 VS Code API 直接创建终端，环境变量 100% 生效，无视系统外壳限制
        const terminal = vscode.window.createTerminal({
            name: '🚀 QuickOps Console Ninja',
            env: {
                NODE_OPTIONS: `--require="${safeBootPath}"`
            }
        });

        terminal.show();
        vscode.window.showInformationMessage('✅ 专属拦截终端已就绪！请在此终端内运行 npm run dev');
        
        // 自动帮你把命令输入进去，你只需要敲回车
        terminal.sendText('npm run dev', false); 
    }

    private async waitForTargetReady(port: number): Promise<boolean> {
        return new Promise((resolve) => {
            let attempts = 0;
            const maxAttempts = 60; 
            
            const interval = setInterval(() => {
                attempts++;
                const req = http.request({
                    hostname: 'localhost', 
                    port: port,
                    method: 'HEAD',
                    timeout: 1000
                }, (res) => {
                    clearInterval(interval);
                    resolve(true);
                });

                req.on('error', (err) => {
                    if (attempts >= maxAttempts) {
                        clearInterval(interval);
                        resolve(false);
                    }
                });
                
                req.on('timeout', () => req.destroy());
                req.end();
            }, 1000);
        });
    }

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

        this.proxyServer.listen(0, '127.0.0.1', async () => {
            const address = this.proxyServer?.address();
            if (address && typeof address === 'object') {
                const proxyPort = address.port;
                const proxyUrl = `http://127.0.0.1:${proxyPort}`;

                console.log(`[QuickOps] 代理注入成功！准备等待底层服务 ${targetPort} 就绪...`);

                const isReady = await this.waitForTargetReady(targetPort);

                if (isReady) {
                    console.log(`[QuickOps] 底层服务就绪！代理地址: ${proxyUrl}`);
                    vscode.window.showInformationMessage(
                        `🚀 QuickOps 已从底层接管进程并注入日志分析！`, 
                        '在外部浏览器打开', 
                        '在内部预览打开'
                    ).then(selection => {
                        if (selection === '在内部预览打开') {
                            vscode.commands.executeCommand('simpleBrowser.api.open', vscode.Uri.parse(proxyUrl), {
                                viewColumn: vscode.ViewColumn.Beside
                            });
                        } else if (selection === '在外部浏览器打开') {
                            vscode.env.openExternal(vscode.Uri.parse(proxyUrl));
                        }
                    });
                } else {
                    vscode.window.showWarningMessage(`[QuickOps] 代理启动超时，未检测到前端服务就绪，请检查终端输出。`);
                }
            }
        });
    }

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