import * as vscode from 'vscode';
import * as path from 'path';

import { IFeature } from '../core/interfaces/IFeature';
import { ConfigurationService } from '../services/ConfigurationService';
import { MockWebviewProvider } from '../providers/MockWebviewProvider';
import ColorLog from '../utils/ColorLog';
import { IProxyConfig, MockYamlStore } from '../utils/MockYamlStore';

export class MockServerFeature implements IFeature {
  public readonly id = 'MockServerFeature';

  public servers: Map<string, any> = new Map();
  private webviewProvider!: MockWebviewProvider;
  private yamlStore = new MockYamlStore();

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

  private getWorkspaceRootUri(): vscode.Uri | undefined {
    const folders = vscode.workspace.workspaceFolders;
    return folders && folders.length > 0 ? folders[0].uri : undefined;
  }

  public notifyStatusToWebview() {
    const runningProxyIds = Array.from(this.servers.keys());
    this.webviewProvider.updateStatus(runningProxyIds);
  }

  public async startAll() {
    const services = await this.yamlStore.readAllServices();

    if (services.length === 0) {
      vscode.window.showWarningMessage('启动失败：请先添加接口规则 YAML！');
      this.notifyStatusToWebview();
      return;
    }

    const hasEnabled = services.some((item) => item.enabled);
    if (!hasEnabled) {
      await this.yamlStore.patchService(services[0].id, { enabled: true });
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
    const services = await this.yamlStore.readAllServices();
    const enabledServices = services.filter((item) => item.enabled);

    for (const [proxyId, server] of this.servers.entries()) {
      const conf = enabledServices.find((item) => item.id === proxyId);

      if (!conf || server._port !== Number(conf.port) || server._domain !== this.getListenHost(conf.domain)) {
        server.close();
        this.servers.delete(proxyId);
        console.log(`[MockServer] Stopped server for proxyId: ${proxyId}`);
      }
    }

    if (enabledServices.length === 0) {
      this.notifyStatusToWebview();
      return;
    }

    for (const conf of enabledServices) {
      if (!this.servers.has(conf.id)) {
        if (!conf.port) continue;
        this.startServerInstance(conf);
      }
    }

    this.notifyStatusToWebview();
  }

  private startServerInstance(serverConfig: IProxyConfig) {
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
      const allMocks = await this.yamlStore.readAllEndpoints();
      const rules = allMocks.filter((m) => m.proxyId === serverConfig.id);

      const matchedRule = rules.find((r) => {
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

        const statusCode = Number(matchedRule.statusCode || 200);

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
                return res.status(statusCode).json(urls);
              }

              const idx = Number(fileIdx);
              if (isNaN(idx) || idx < 0 || idx >= filePaths.length) {
                return res.status(404).json({ error: '文件索引不存在或越界' });
              }
              targetFile = filePaths[idx];
            } else {
              targetFile = filePaths[0];
            }

            let targetUri: vscode.Uri;
            if (path.isAbsolute(targetFile)) {
              targetUri = vscode.Uri.file(targetFile);
            } else {
              const rootUri = this.getWorkspaceRootUri();
              if (rootUri) {
                targetUri = vscode.Uri.joinPath(rootUri, ...targetFile.replace(/\\/g, '/').split('/').filter(Boolean));
              } else {
                targetUri = vscode.Uri.file(targetFile);
              }
            }

            try {
              await vscode.workspace.fs.stat(targetUri);

              const fileData = await vscode.workspace.fs.readFile(targetUri);
              const buffer = Buffer.from(fileData);

              const disposition = matchedRule.fileDisposition === 'attachment' ? 'attachment' : 'inline';
              const fileName = targetUri.path.split('/').pop() || 'download_file';
              const encodedFileName = encodeURIComponent(fileName);
              res.set('Content-Disposition', `${disposition}; filename*=UTF-8''${encodedFileName}`);

              if (matchedRule.contentType && matchedRule.contentType !== 'application/json') {
                res.set('Content-Type', matchedRule.contentType);
              }

              return res.status(statusCode).send(buffer);
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

        if (matchedRule.mode === 'mock') {
          try {
            const templateObj = this.parseMaybeJson(matchedRule.template || {});
            return res.status(statusCode).send(Mock.mock(templateObj));
          } catch (e: any) {
            return res.status(500).json({ error: 'Mock Parse Error', details: e.message });
          }
        }

        if (matchedRule.mode === 'custom') {
          try {
            const responseData = this.parseMaybeJson(matchedRule.data || {});
            return res.status(statusCode).send(responseData);
          } catch (e: any) {
            return res.status(500).json({ error: 'JSON Parse Error', details: e.message });
          }
        }

        return res.status(statusCode).send({});
      } else {
        return next();
      }
    });

    app.use((req: any, res: any) => {
      res.status(404).json({
        error: 'Not Found in Mock Rules',
        path: req.path,
        message: '请求的接口没有匹配到任何已启用的 YAML 拦截规则'
      });
    });

    try {
      const listenHost = this.getListenHost(serverConfig.domain);

      const server = app.listen(serverConfig.port, listenHost, () => {
        server._port = Number(serverConfig.port);
        server._domain = listenHost;
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

  private parseMaybeJson(value: any) {
    if (typeof value !== 'string') return value;

    try {
      return JSON.parse(value);
    } catch (e) {
      return value;
    }
  }

  private getListenHost(domain?: string): string {
    const value = (domain || '127.0.0.1').trim();
    const host = value.replace(/^https?:\/\//, '').split('/')[0].split(':')[0];

    if (!host || host === 'localhost') return '127.0.0.1';
    return host;
  }
}