import * as vscode from 'vscode';
// 修复 1: 使用 require 语法兼容 CommonJS 模块的导出
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const Mock = require('mockjs');
import { createProxyMiddleware } from 'http-proxy-middleware';
import { IFeature } from '../core/interfaces/IFeature';
import { ConfigurationService } from '../services/ConfigurationService';
import { MockWebviewProvider } from '../providers/MockWebviewProvider';
import { IMockRule } from '../core/types/config';

export class MockServerFeature implements IFeature {
  public readonly id = 'MockServerFeature';
  private server: any;
  private app: any; // 修复 2: 显式声明为 any 或者 express.Express，简化类型问题

  private webviewProvider!: MockWebviewProvider;

  constructor(private configService: ConfigurationService = ConfigurationService.getInstance()) {}

  public activate(context: vscode.ExtensionContext): void {
    this.webviewProvider = new MockWebviewProvider(context.extensionUri, this);

    context.subscriptions.push(vscode.window.registerWebviewViewProvider('quickOps.mockView', this.webviewProvider));

    context.subscriptions.push(
      vscode.commands.registerCommand('quick-ops.mock.start', () => this.startServer()),
      vscode.commands.registerCommand('quick-ops.mock.stop', () => this.stopServer()),
      vscode.commands.registerCommand('quick-ops.mock.openManager', () => this.openManagerPanel(context)),
    );
  }

  public async startServer() {
    if (this.server) {
      vscode.window.showInformationMessage('Mock Server 已经在运行中');
      return;
    }

    const config = this.configService.config.mock || { port: 3000, target: '', rules: [] };

    if (!config.target) {
      const target = await vscode.window.showInputBox({
        prompt: '未配置目标域名 (Target)，请输入真实后端地址 (例如 http://localhost:8080)',
        placeHolder: 'http://example.com',
      });
      if (target) {
        config.target = target;
        // 建议：这里应该调用 updateConfig 保存配置
        // await this.configService.updateConfig('mock', config);
      } else {
        vscode.window.showWarningMessage('无法启动：未配置转发目标地址');
        return;
      }
    }

    this.app = express();
    this.app.use(cors());
    this.app.use(bodyParser.json());
    this.app.use(bodyParser.urlencoded({ extended: true }));

    // --- 核心拦截中间件 ---
    this.app.use(async (req: any, res: any, next: any) => {
      const currentConfig = this.configService.config.mock;
      const rules = currentConfig?.rules || [];

      const matchedRule = rules.find((r) => r.enabled && req.method.toUpperCase() === r.method.toUpperCase() && (req.path === r.url || req.path.includes(r.url)));

      if (matchedRule) {
        console.log(`[Mock Intercept] ${req.method} ${req.path} -> Mocked`);
        try {
          const templateObj = typeof matchedRule.template === 'string' ? JSON.parse(matchedRule.template) : matchedRule.template;
          const mockData = Mock.mock(templateObj);
          res.set('Content-Type', matchedRule.contentType || 'application/json');
          res.send(mockData);
        } catch (e: any) {
          console.error('[Mock Error]', e);
          res.status(500).json({ error: 'Mock Generation Failed', details: e.message });
        }
        return;
      }
      next();
    });

    // --- 代理转发中间件 ---
    // 修复 3: 使用 as any 绕过 createProxyMiddleware 的严格类型检查
    // 或者移除不支持的 logLevel 选项
    const proxyOptions: any = {
      target: config.target,
      changeOrigin: true,
      // logLevel: 'error', // 如果报错就把这行去掉，新版可能不支持
      onProxyReq: (proxyReq: any, req: any, res: any) => {
        // console.log ...
        console.log(12322);
      },
      onError: (err: any, req: any, res: any) => {
        res.status(502).send(`Proxy Error: ${err.message}`);
      },
    };

    this.app.use('/', createProxyMiddleware(proxyOptions));

    try {
      this.server = this.app.listen(config.port, () => {
        const msg = `Mock Server 启动成功: http://localhost:${config.port} (转发至: ${config.target})`;
        vscode.window.showInformationMessage(msg);
        if (this.webviewProvider) {
          this.webviewProvider.updateStatus(true, config.port);
        }
      });

      this.server.on('error', (e: any) => {
        if (e.code === 'EADDRINUSE') {
          vscode.window.showErrorMessage(`端口 ${config.port} 被占用，请修改 .quickopsrc 中的端口配置`);
          this.stopServer();
        } else {
          vscode.window.showErrorMessage(`Mock Server 启动失败: ${e.message}`);
        }
      });
    } catch (e: any) {
      vscode.window.showErrorMessage(`启动失败: ${e.message}`);
    }
  }

  public stopServer() {
    if (this.server) {
      this.server.close();
      this.server = null;
      this.app = undefined;
      vscode.window.showInformationMessage('Mock Server 已停止');
      if (this.webviewProvider) {
        this.webviewProvider.updateStatus(false);
      }
    }
  }

  private openManagerPanel(context: vscode.ExtensionContext) {
    // 创建一个全屏的 Webview Panel
    const panel = vscode.window.createWebviewPanel(
      'mockManager', // viewType
      'Mock Manager', // title
      vscode.ViewColumn.One, // show in editor column 1
      {
        enableScripts: true, // 允许 JS
        localResourceRoots: [context.extensionUri],
        retainContextWhenHidden: true, // 切后台保持状态
      },
    );

    // 复用 Provider 的 HTML 生成逻辑 (稍微 hack 一下，或者让 Provider 暴露静态方法)
    // 这里为了简单，我们让 Provider 帮我们生成内容
    // 注意：需要 Provider 支持传入 webview 实例
    panel.webview.html = this.webviewProvider['getHtmlForWebview'](panel.webview);

    // 重新绑定消息监听，因为这是个新的 webview 实例
    panel.webview.onDidReceiveMessage(async (data) => {
      // 这里直接复用 Provider 里的处理逻辑，或者把处理逻辑抽离出来
      // 为简单起见，这里假设 Provider 内部已经处理好了，或者你需要把 onDidReceiveMessage 里的逻辑
      // 提取成一个 public 方法 handleMessage(data, webview)
      await this.webviewProvider.handleMessage(data, panel.webview);
    });
  }
}
