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

    // 🌟 1. 核心修复：清理过期服务
    // 遍历所有正在运行的服务，如果服务被禁用、被删除，或者【端口号发生了修改】，立即 close 它
    for (const [proxyId, server] of this.servers.entries()) {
      const conf = proxies.find((c: any) => c.id === proxyId);
      
      // server._port 是我们在服务启动时绑定的实际端口
      if (!conf || !conf.enabled || server._port !== Number(conf.port)) {
        server.close(); // 优雅关闭底层的 HTTP Server
        this.servers.delete(proxyId); // 从运行队列中剔除
        console.log(`[MockServer] Stopped server for proxyId: ${proxyId}`);
      }
    }

    // 🌟 2. 启动服务
    // 如果是新服务，或者是刚才因为改端口被我们关闭的服务，就会在这里重新创建并启动
    for (const conf of proxies) {
      if (conf.enabled && !this.servers.has(conf.id)) {
        if (!conf.port) continue; 
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

        if (matchedRule.mode === 'file') {
          if (matchedRule.filePath) {
            let absFilePath = matchedRule.filePath;
            if (!path.isAbsolute(absFilePath)) {
              const root = this.getWorkspaceRoot();
              if (root) absFilePath = path.join(root, absFilePath);
            }
            
            if (fs.existsSync(absFilePath)) {
              const disposition = matchedRule.fileDisposition === 'attachment' ? 'attachment' : 'inline';
              res.set('Content-Disposition', `${disposition}; filename="${path.basename(absFilePath)}"`);
              
              if (matchedRule.contentType) {
                res.set('Content-Type', matchedRule.contentType);
              }
              
              return res.sendFile(absFilePath);
            } else {
              return res.status(404).json({ error: '配置返回的文件不存在', path: absFilePath });
            }
          } else {
             return res.status(400).json({ error: '文件路径未配置' });
          }
        }

        res.set('Content-Type', matchedRule.contentType || 'application/json');

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
              
              const isMockTemplate = matchedRule.mode === 'mock' || matchedRule.isTemplate;
              if (isMockTemplate) {
                return res.send(Mock.mock(parsedData));
              } else {
                return res.send(parsedData);
              }
            } catch (e: any) {
              return res.status(500).json({ error: '读取 Mock 配置文件失败', details: e.message });
            }
          } else {
            console.warn(`[MockServer:${serverConfig.port}] Mock 文件不存在: ${absPath}`);
          }
        }

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
        
        return res.send({});
      } else {
        return res.status(404).json({ error: `Mock Rule Not Found for ${req.path}` });
      }
    });

    try {
      const server = app.listen(serverConfig.port, () => {
        // 🌟 核心标记：在 HTTP Server 实例上挂载当前绑定的真实端口
        // 这让我们可以在 syncServers() 中判断它是不是被改过了
        server._port = Number(serverConfig.port);
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