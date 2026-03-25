import * as vscode from 'vscode';
import * as path from 'path';

import { IFeature } from '../core/interfaces/IFeature';
import { ConfigurationService } from '../services/ConfigurationService';
import { MockWebviewProvider } from '../providers/MockWebviewProvider';
import ColorLog from '../utils/ColorLog';

export class MockServerFeature implements IFeature {
  public readonly id = 'MockServerFeature';

  public servers: Map<string, any> = new Map();
  private webviewProvider!: MockWebviewProvider;

  constructor(private configService: ConfigurationService = ConfigurationService.getInstance()) { }

  public activate(context: vscode.ExtensionContext): void {
    this.webviewProvider = new MockWebviewProvider(context.extensionUri, this);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider('quick-ops.mockView', this.webviewProvider, {
      webviewOptions: {
        retainContextWhenHidden: true
      }
    }));

    context.subscriptions.push(
      vscode.commands.registerCommand('quick-ops.mock.start', () => this.startAll()),
      vscode.commands.registerCommand('quick-ops.mock.stop', () => this.stopAll()),
    );

    this.configService.on('configChanged', () => {
      this.syncServers();
    });

    this.syncServers();

    ColorLog.black(`[${this.id}]`, 'Activated.');
  }

  // 🌟 优化 1：改为返回 vscode.Uri 以支持所有虚拟/远程文件系统
  private getWorkspaceRootUri(): vscode.Uri | undefined {
    const folders = vscode.workspace.workspaceFolders;
    return folders && folders.length > 0 ? folders[0].uri : undefined;
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

      if (!conf || !conf.enabled || server._port !== Number(conf.port)) {
        server.close();
        this.servers.delete(proxyId);
        console.log(`[MockServer] Stopped server for proxyId: ${proxyId}`);
      }
    }

    const hasEnabled = proxies.some((conf: any) => conf.enabled);
    if (!hasEnabled) {
      this.notifyStatusToWebview();
      return;
    }

    for (const conf of proxies) {
      if (conf.enabled && !this.servers.has(conf.id)) {
        if (!conf.port) continue;
        this.startServerInstance(conf);
      }
    }

    this.notifyStatusToWebview();
  }

  private startServerInstance(serverConfig: any) {
    const express = require('express');
    const cors = require('cors');
    const bodyParser = require('body-parser');
    const Mock = require('mockjs');

    const app = express();

    app.use(cors({
      origin: true,
      credentials: true,
      allowedHeaders: '*',
      exposedHeaders: '*',
    }));

    app.use(bodyParser.json({ limit: '50mb' }));
    app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));

    app.use(async (req: any, res: any, next: any) => {
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

        if (matchedRule.reqHeaders && typeof matchedRule.reqHeaders === 'object') {
          Object.assign(req.headers, matchedRule.reqHeaders);
        }

        if (matchedRule.delay && matchedRule.delay > 0) {
          await new Promise(resolve => setTimeout(resolve, matchedRule.delay));
        }

        if (matchedRule.mode === 'file') {
          if (matchedRule.filePath) {
            const filePaths = matchedRule.filePath.split('\n').map((p: string) => p.trim()).filter(Boolean);

            if (filePaths.length === 0) {
              return res.status(400).json({ error: '文件路径未配置或为空' });
            }

            let targetFile = '';

            if (filePaths.length > 1) {
              const fileIdx = req.query.fileIdx;

              if (fileIdx === undefined) {
                const protocol = req.protocol || 'http';
                const host = req.get('host');
                const baseUrl = `${protocol}://${host}${req.path}`;
                const urls = filePaths.map((_: any, idx: number) => `${baseUrl}?fileIdx=${idx}`);
                return res.json(urls);
              }

              const idx = Number(fileIdx);
              if (isNaN(idx) || idx < 0 || idx >= filePaths.length) {
                return res.status(404).json({ error: '文件索引不存在或越界' });
              }
              targetFile = filePaths[idx];
            } else {
              targetFile = filePaths[0];
            }

            // 🌟 优化 2：采用 vscode.Uri 处理绝对/相对文件路径
            let targetUri: vscode.Uri;
            if (path.isAbsolute(targetFile)) {
              targetUri = vscode.Uri.file(targetFile);
            } else {
              const rootUri = this.getWorkspaceRootUri();
              if (rootUri) {
                targetUri = vscode.Uri.joinPath(rootUri, targetFile);
              } else {
                targetUri = vscode.Uri.file(targetFile);
              }
            }

            try {
              // 检查文件是否存在
              await vscode.workspace.fs.stat(targetUri);

              // 🌟 优化 3：放弃 res.sendFile，改用 Buffer 传输，完美兼容虚拟文件系统
              const fileData = await vscode.workspace.fs.readFile(targetUri);
              const buffer = Buffer.from(fileData);

              const disposition = matchedRule.fileDisposition === 'attachment' ? 'attachment' : 'inline';
              // 从 Uri 提取文件名
              const fileName = targetUri.path.split('/').pop() || 'download_file';
              const encodedFileName = encodeURIComponent(fileName);
              res.set('Content-Disposition', `${disposition}; filename*=UTF-8''${encodedFileName}`);

              if (matchedRule.contentType && matchedRule.contentType !== 'application/json') {
                res.set('Content-Type', matchedRule.contentType);
              }

              return res.send(buffer);
            } catch (err: any) {
              console.error(`[MockServer] 读取发送文件失败:`, err);
              if (!res.headersSent) {
                return res.status(404).json({ error: '配置返回的文件不存在或无法读取', path: targetUri.toString() });
              }
            }
          } else {
            return res.status(400).json({ error: '文件路径未配置' });
          }
        }

        res.set('Content-Type', matchedRule.contentType || 'application/json');

        if (matchedRule.dataPath) {
          let dataUri: vscode.Uri;
          if (path.isAbsolute(matchedRule.dataPath)) {
            dataUri = vscode.Uri.file(matchedRule.dataPath);
          } else {
            const rootUri = this.getWorkspaceRootUri();
            if (rootUri) {
              dataUri = vscode.Uri.joinPath(rootUri, matchedRule.dataPath);
            } else {
              dataUri = vscode.Uri.file(matchedRule.dataPath);
            }
          }

          try {
            await vscode.workspace.fs.stat(dataUri);

            try {
              // 🌟 优化 4：异步读取 Mock 配置文件
              const fileData = await vscode.workspace.fs.readFile(dataUri);
              const fileContent = Buffer.from(fileData).toString('utf8');
              const parsedData = JSON.parse(fileContent);

              const isMockTemplate = matchedRule.mode === 'mock' || matchedRule.isTemplate;
              if (isMockTemplate) {
                return res.send(Mock.mock(parsedData));
              } else {
                return res.send(parsedData);
              }
            } catch (e: any) {
              return res.status(500).json({ error: '读取 Mock 配置文件失败，可能是 JSON 格式错误', details: e.message });
            }
          } catch (e) {
            console.warn(`[MockServer:${serverConfig.port}] Mock 配置文件不存在: ${dataUri.toString()}`);
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
        return next();
      }
    });

    app.use((req: any, res: any) => {
      res.status(404).json({
        error: 'Not Found in Mock Rules',
        path: req.path,
        message: '请求的接口没有匹配到任何已启用的拦截规则'
      });
    });

    try {
      const server = app.listen(serverConfig.port, '127.0.0.1', () => {
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