import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const Mock = require('mockjs');

import { IFeature } from '../core/interfaces/IFeature';
import { ConfigurationService } from '../services/ConfigurationService';
import { MockWebviewProvider } from '../providers/MockWebviewProvider';
import ColorLog from '../utils/ColorLog';

export class MockServerFeature implements IFeature {
  public readonly id = 'MockServerFeature';

  public servers: Map<string, any> = new Map();
  private webviewProvider!: MockWebviewProvider;

  constructor(private configService: ConfigurationService = ConfigurationService.getInstance()) {}

  public activate(context: vscode.ExtensionContext): void {
    this.webviewProvider = new MockWebviewProvider(context.extensionUri, this);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider('quickOps.mockView', this.webviewProvider));

    context.subscriptions.push(
      vscode.commands.registerCommand('quick-ops.mock.start', () => this.startAll()),
      vscode.commands.registerCommand('quick-ops.mock.stop', () => this.stopAll()),
    );

    setTimeout(() => {
      this.syncServers();
    }, 1000);
    ColorLog.black(`[${this.id}]`, 'Activated.');
  }

  private getWorkspaceRoot(): string | undefined {
    const folders = vscode.workspace.workspaceFolders;
    return folders && folders.length > 0 ? folders[0].uri.fsPath : undefined;
  }

  public notifyStatusToWebview() {
    const runningProxyIds = Array.from(this.servers.keys());
    this.webviewProvider.updateStatus(runningProxyIds);
  }

  public async startAll() {
    let proxies = this.configService.config.proxy || [];
    if (!Array.isArray(proxies)) proxies = [];

    if (proxies.length === 0) {
      vscode.window.showWarningMessage('启动失败：请先添加 Mock 服务！');
      this.notifyStatusToWebview();
      return;
    }

    const hasEnabled = proxies.some((c: any) => c.enabled);
    if (!hasEnabled && proxies.length > 0) {
      proxies[0].enabled = true;
      await this.configService.updateConfig('proxy', proxies);
    }

    await this.syncServers();

    if (this.servers.size > 0) {
      vscode.window.showInformationMessage(`已启动 ${this.servers.size} 个 Mock 服务`);
    }
  }

  public async stopAll() {
    for (const [id, server] of this.servers.entries()) {
      server.close();
    }
    this.servers.clear();
    vscode.window.showInformationMessage('所有 Mock 服务已停止');
    this.notifyStatusToWebview();
  }

  public async syncServers() {
    let proxies = this.configService.config.proxy || [];
    if (!Array.isArray(proxies)) proxies = [];

    for (const [proxyId, server] of this.servers.entries()) {
      const conf = proxies.find((c: any) => c.id === proxyId);
      if (!conf || !conf.enabled) {
        server.close();
        this.servers.delete(proxyId);
      }
    }

    for (const conf of proxies) {
      if (conf.enabled && !this.servers.has(conf.id)) {
        if (!conf.port) continue; // 移除了 target 检查
        this.startServerInstance(conf);
      }
    }

    this.notifyStatusToWebview();
  }

  private startServerInstance(serverConfig: any) {
    const app = express();
    app.use(cors());
    app.use(bodyParser.json({ limit: '50mb' }));
    app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));

    // 🌟 修复点：使用 app.use 替代 app.all('*')，拦截所有请求且不会触发路由通配符报错
    app.use(async (req: any, res: any) => {
      let allMocks = this.configService.config.mock || [];
      if (!Array.isArray(allMocks)) allMocks = [];

      const rules = allMocks.filter((m: any) => m.proxyId === serverConfig.id);

      const matchedRule = rules.find((r: any) => {
        if (!r.enabled) return false;
        const rulePath = (r.url || '').split('?')[0];
        return req.method.toUpperCase() === r.method.toUpperCase() && req.path === rulePath;
      });

      if (matchedRule) {
        console.log(`[MockServer:${serverConfig.port}] Mock Hit: ${req.path}`);
        res.set('Content-Type', matchedRule.contentType || 'application/json');

        // 读取文件数据
        if (matchedRule.dataPath) {
          let absPath = matchedRule.dataPath;
          if (!path.isAbsolute(absPath)) {
            const root = this.getWorkspaceRoot();
            if (root) {
              absPath = path.join(root, absPath);
            }
          }

          if (fs.existsSync(absPath)) {
            try {
              const fileContent = fs.readFileSync(absPath, 'utf8');
              const parsedData = JSON.parse(fileContent);
              if (matchedRule.isTemplate) {
                return res.send(Mock.mock(parsedData));
              } else {
                return res.send(parsedData);
              }
            } catch (e: any) {
              return res.status(500).json({ error: '读取 Mock 文件失败', details: e.message });
            }
          } else {
            console.warn(`[MockServer:${serverConfig.port}] Mock 文件不存在: ${absPath}`);
          }
        }

        // 兼容行内数据
        if (matchedRule.data) {
          const responseData = typeof matchedRule.data === 'string' ? JSON.parse(matchedRule.data) : matchedRule.data;
          return res.send(responseData);
        }
        if (matchedRule.template) {
          try {
            const templateObj = typeof matchedRule.template === 'string' ? JSON.parse(matchedRule.template) : matchedRule.template;
            return res.send(Mock.mock(templateObj));
          } catch (e: any) {
            return res.status(500).json({ error: 'Mock Parse Error', details: e.message });
          }
        }
      } else {
        // 移除了 target 转发，未命中规则直接返回 404
        return res.status(404).json({ error: `Mock Rule Not Found for ${req.path}` });
      }
    });

    try {
      const server = app.listen(serverConfig.port, () => {
        this.servers.set(serverConfig.id, server);
        this.notifyStatusToWebview();
      });

      server.on('error', (e: any) => {
        if (e.code === 'EADDRINUSE') {
          vscode.window.showErrorMessage(`启动失败：端口 ${serverConfig.port} 被占用！`);
        } else {
          vscode.window.showErrorMessage(`Mock 服务异常: ${e.message}`);
        }
        this.servers.delete(serverConfig.id);
        this.notifyStatusToWebview();
      });
    } catch (e: any) {
      vscode.window.showErrorMessage(`创建服务异常: ${e.message}`);
    }
  }
}