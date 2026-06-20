import * as vscode from 'vscode';
import * as path from 'path';
import * as YAML from 'yaml';
import { nanoid } from 'nanoid';
import { getReactWebviewHtml } from '../../utils/WebviewHelper';
import { ExtensionContextProvider } from '../../common/providers/extension-context.provider';
import { ConfigurationService } from '../../common/services/configuration.service';
import type {
  MockFullConfig,
  MockHttpServer,
  MockProxyConfig,
  MockRuleConfig,
  MockRuleMode,
  MockSaveRulePayload,
  MockWebviewMessage,
  MockYamlDocument,
} from './mock-server.type';

export class MockServerService implements vscode.WebviewViewProvider {
  public static inject = [ExtensionContextProvider, ConfigurationService];

  private readonly servers = new Map<string, MockHttpServer>();
  private readonly yamlStore: MockYamlStore;

  private view?: vscode.WebviewView;
  private proxyPanel?: vscode.WebviewPanel;
  private rulePanel?: vscode.WebviewPanel;
  private draftProxies: MockProxyConfig[] = [];

  constructor(
    private readonly extensionContextProvider: ExtensionContextProvider,
    private readonly configurationService: ConfigurationService,
  ) {
    this.yamlStore = new MockYamlStore(configurationService);
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView;

    const extensionUri = this.extensionContextProvider.extensionUri;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [extensionUri],
    };

    webviewView.webview.html = getReactWebviewHtml(
      extensionUri,
      webviewView.webview,
      '/mock',
    );

    webviewView.webview.onDidReceiveMessage(async data => {
      await this.handleMessage(data, webviewView.webview);
    });
  }

  public async startAll(): Promise<void> {
    const services = await this.yamlStore.readAllServices();

    if (services.length === 0) {
      vscode.window.showWarningMessage('启动失败：请先添加接口规则 YAML！');
      this.notifyStatusToWebview();
      return;
    }

    const hasEnabled = services.some(item => item.enabled);

    if (!hasEnabled) {
      await this.yamlStore.patchService(services[0].id, {
        enabled: true,
      });
    }

    await this.syncServers();

    if (this.servers.size > 0) {
      vscode.window.showInformationMessage(`已启动 ${this.servers.size} 个 Mock 服务`);
    }
  }

  public async stopAll(): Promise<void> {
    for (const server of this.servers.values()) {
      server.close();
    }

    this.servers.clear();

    vscode.window.showInformationMessage('所有 Mock 服务已停止');
    this.notifyStatusToWebview();
  }

  public async syncServers(): Promise<void> {
    const services = await this.yamlStore.readAllServices();
    const enabledServices = services.filter(item => item.enabled);

    for (const [proxyId, server] of this.servers.entries()) {
      const conf = enabledServices.find(item => item.id === proxyId);

      if (
        !conf ||
        server._port !== Number(conf.port) ||
        server._domain !== this.getListenHost(conf.domain)
      ) {
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
      if (this.servers.has(conf.id)) continue;
      if (!conf.port) continue;

      this.startServerInstance(conf);
    }

    this.notifyStatusToWebview();
  }

  public notifyStatusToWebview(): void {
    const runningProxyIds = Array.from(this.servers.keys());

    this.view?.webview.postMessage({
      type: 'status',
      runningProxies: runningProxyIds,
    });
  }

  public updateStatus(runningProxyIds: string[]): void {
    this.view?.webview.postMessage({
      type: 'status',
      runningProxies: runningProxyIds,
    });
  }

  public dispose(): void {
    void this.stopAll();

    this.proxyPanel?.dispose();
    this.rulePanel?.dispose();

    this.proxyPanel = undefined;
    this.rulePanel = undefined;
    this.view = undefined;
    this.draftProxies = [];
  }

  private async handleMessage(
    data: MockWebviewMessage,
    webview: vscode.Webview,
  ): Promise<void> {
    const { proxyList, mockList: fullMockList } = await this.getFullConfig();

    switch (data.type) {
      case 'webviewLoaded':
      case 'refresh':
        await this.refreshSidebar();
        break;

      case 'error':
        vscode.window.showErrorMessage(data.message || 'Mock 面板发生错误');
        break;

      case 'toggleServer':
        await this.handleToggleServer(data, proxyList);
        break;

      case 'copyText':
        await vscode.env.clipboard.writeText(String(data.payload || ''));
        vscode.window.showInformationMessage(`复制成功：${data.payload}`);
        break;

      case 'selectGlobalMockDir':
        await this.handleSelectGlobalMockDir(data, proxyList, fullMockList);
        break;

      case 'selectFileReturnPath':
        await this.handleSelectFileReturnPath(data);
        break;

      case 'openProxyPanel':
        await this.showProxyPanel(data.id);
        break;

      case 'openRulePanel':
        await this.showRulePanel(String(data.proxyId || ''), data.ruleId);
        break;

      case 'toggleProxy':
        await this.handleToggleProxy(data, proxyList);
        break;

      case 'deleteProxy':
        await this.handleDeleteProxy(data);
        break;

      case 'deleteRule':
        await this.handleDeleteRule(data);
        break;

      case 'toggleRule':
        if (data.ruleId) {
          await this.yamlStore.patchEndpoint(data.ruleId, {
            enabled: Boolean(data.enabled),
          });

          await this.syncServers();
          await this.refreshSidebar();
        }
        break;
    }

    void webview;
  }

  private async handleToggleServer(
    data: MockWebviewMessage,
    proxyList: MockProxyConfig[],
  ): Promise<void> {
    if (proxyList.length === 0) {
      vscode.window.showWarningMessage('操作失败：请先添加 Mock 服务！');
      return;
    }

    await this.yamlStore.setAllEnabled(Boolean(data.value));

    this.draftProxies = this.draftProxies.map(item => ({
      ...item,
      enabled: Boolean(data.value),
    }));

    await this.syncServers();
    await this.refreshSidebar();
  }

  private async handleToggleProxy(
    data: MockWebviewMessage,
    proxyList: MockProxyConfig[],
  ): Promise<void> {
    const target = proxyList.find(item => item.id === data.id);

    if (!target || !data.id) return;

    await this.yamlStore.patchService(data.id, {
      enabled: Boolean(data.enabled),
    });

    this.draftProxies = this.draftProxies.map(item =>
      item.id === data.id
        ? {
            ...item,
            enabled: Boolean(data.enabled),
          }
        : item,
    );

    await this.syncServers();
    await this.refreshSidebar();
  }

  private async handleDeleteProxy(data: MockWebviewMessage): Promise<void> {
    if (!data.id) return;

    const answer = await vscode.window.showWarningMessage(
      '确定要删除此服务吗？相关的 YAML 接口规则也会被移除。',
      {
        modal: true,
      },
      '删除',
    );

    if (answer !== '删除') return;

    await this.yamlStore.deleteService(data.id);

    this.draftProxies = this.draftProxies.filter(item => item.id !== data.id);

    await this.syncServers();
    await this.refreshSidebar();
  }

  private async handleDeleteRule(data: MockWebviewMessage): Promise<void> {
    if (!data.ruleId) return;

    const answer = await vscode.window.showWarningMessage(
      '确定要删除此规则 YAML 文件吗？',
      {
        modal: true,
      },
      '删除',
    );

    if (answer !== '删除') return;

    await this.yamlStore.deleteEndpoint(data.ruleId);

    await this.syncServers();
    await this.refreshSidebar();
  }

  private async handleSelectGlobalMockDir(
    data: MockWebviewMessage,
    proxyList: MockProxyConfig[],
    fullMockList: Array<Omit<MockRuleConfig, '_yamlUri'>>,
  ): Promise<void> {
    const defaultUri = this.getDefaultUri(data.currentPath);

    const uris = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      defaultUri,
      openLabel: '选择全局 Mock YAML 存放目录',
      title: '选择全局 Mock YAML 存放目录',
    });

    if (!uris?.[0]) return;

    const savePath = this.yamlStore.pathForConfig(uris[0]);
    const currentGeneral = this.configurationService.get<Record<string, any>>('general', {});
    const nextGeneral = {
      ...currentGeneral,
      mockDir: savePath,
    };

    await this.configurationService.updateConfig('general', nextGeneral);

    vscode.window.showInformationMessage(`已设置 Mock YAML 目录：${savePath}`);

    this.view?.webview.postMessage({
      type: 'config',
      proxy: proxyList,
      mock: fullMockList,
      mockDir: savePath,
    });

    await this.refreshSidebar();
  }

  private async handleSelectFileReturnPath(data: MockWebviewMessage): Promise<void> {
    const defaultUri = this.getDefaultUri(data.currentPath);

    const uris = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: data.multiple === true,
      defaultUri,
      openLabel: data.multiple ? '选择文件 (支持多选)' : '选择文件',
    });

    if (!uris?.length) return;

    const paths = uris.map(uri => this.yamlStore.pathForConfig(uri));

    this.rulePanel?.webview.postMessage({
      type: 'fileReturnPathSelected',
      path: paths.join('\n'),
    });
  }

  private async getFullConfig(): Promise<MockFullConfig> {
    const proxyList = await this.yamlStore.readAllServices();
    const endpoints = await this.yamlStore.readAllEndpoints();
    const proxyMap = new Map<string, MockProxyConfig>();

    for (const item of proxyList) {
      proxyMap.set(item.id, item);
    }

    for (const item of this.draftProxies) {
      if (!proxyMap.has(item.id)) {
        proxyMap.set(item.id, item);
      }
    }

    const mockList = endpoints.map(item => {
      const { _yamlUri, ...rest } = item;
      return rest;
    });

    return {
      proxyList: Array.from(proxyMap.values()),
      mockList,
      mockDir: this.yamlStore.getMockDir(),
    };
  }

  private async refreshSidebar(): Promise<void> {
    if (!this.view) return;

    const { proxyList, mockList, mockDir } = await this.getFullConfig();

    this.view.webview.postMessage({
      type: 'config',
      proxy: proxyList,
      mock: mockList,
      mockDir,
    });

    this.notifyStatusToWebview();
  }

  private async showProxyPanel(proxyId?: string): Promise<void> {
    this.rulePanel?.dispose();
    this.proxyPanel?.dispose();

    this.rulePanel = undefined;
    this.proxyPanel = undefined;

    const extensionUri = this.extensionContextProvider.extensionUri;

    this.proxyPanel = vscode.window.createWebviewPanel(
      'quickOps.mockProxyPanel',
      proxyId ? '编辑 Mock 服务' : '新增 Mock 服务',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: false,
        localResourceRoots: [extensionUri],
      },
    );

    this.proxyPanel.onDidDispose(() => {
      this.proxyPanel = undefined;
    });

    this.proxyPanel.webview.html = getReactWebviewHtml(
      extensionUri,
      this.proxyPanel.webview,
      '/mock/proxy',
    );

    this.proxyPanel.webview.onDidReceiveMessage(async data => {
      await this.handleProxyPanelMessage(data, proxyId);
    });
  }

  private async handleProxyPanelMessage(
    data: MockWebviewMessage,
    proxyId?: string,
  ): Promise<void> {
    if (data.type === 'webviewLoaded') {
      const { proxyList } = await this.getFullConfig();

      this.proxyPanel?.webview.postMessage({
        type: 'init',
        proxy: proxyList.find(item => item.id === proxyId),
      });

      return;
    }

    if (data.type === 'error') {
      vscode.window.showErrorMessage(data.message || 'Mock 服务面板发生错误');
      return;
    }

    if (data.type === 'cancel') {
      this.proxyPanel?.dispose();
      return;
    }

    if (data.type !== 'saveProxy') return;

    const mockDir = this.yamlStore.getMockDir();

    if (!mockDir) {
      vscode.window.showErrorMessage('请先设置全局 Mock YAML 存放目录！');
      return;
    }

    const newProxy = data.payload || {};
    const domain = newProxy.domain || '127.0.0.1';
    const port = Number(newProxy.port);
    const nextId = this.yamlStore.buildServiceId(domain, port);

    if (!port) {
      vscode.window.showErrorMessage('端口不能为空！');
      return;
    }

    if (newProxy.id) {
      const existedDraftIndex = this.draftProxies.findIndex(
        item => item.id === newProxy.id,
      );

      if (existedDraftIndex > -1) {
        this.draftProxies[existedDraftIndex] = {
          id: nextId,
          port,
          domain,
          enabled: true,
        };
      } else {
        await this.yamlStore.patchService(newProxy.id, {
          port,
          domain,
          enabled: true,
        });
      }
    } else {
      const existedDraftIndex = this.draftProxies.findIndex(item => item.id === nextId);

      if (existedDraftIndex > -1) {
        this.draftProxies[existedDraftIndex] = {
          id: nextId,
          port,
          domain,
          enabled: true,
        };
      } else {
        this.draftProxies.push({
          id: nextId,
          port,
          domain,
          enabled: true,
        });
      }
    }

    await this.syncServers();

    this.proxyPanel?.dispose();

    await this.refreshSidebar();
  }

  private async showRulePanel(proxyId: string, ruleId?: string): Promise<void> {
    this.proxyPanel?.dispose();
    this.rulePanel?.dispose();

    this.proxyPanel = undefined;
    this.rulePanel = undefined;

    const extensionUri = this.extensionContextProvider.extensionUri;

    this.rulePanel = vscode.window.createWebviewPanel(
      'quickOps.mockRulePanel',
      ruleId ? '编辑规则' : '新增规则',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: false,
        localResourceRoots: [extensionUri],
      },
    );

    this.rulePanel.onDidDispose(() => {
      this.rulePanel = undefined;
    });

    this.rulePanel.webview.html = getReactWebviewHtml(
      extensionUri,
      this.rulePanel.webview,
      '/mock/rule',
    );

    this.rulePanel.webview.onDidReceiveMessage(async data => {
      await this.handleRulePanelMessage(data, proxyId, ruleId);
    });
  }

  private async handleRulePanelMessage(
    data: MockWebviewMessage,
    proxyId: string,
    ruleId?: string,
  ): Promise<void> {
    if (data.type === 'webviewLoaded') {
      const { mockList } = await this.getFullConfig();
      const fullRule = ruleId ? mockList.find(item => item.id === ruleId) || null : null;

      this.rulePanel?.webview.postMessage({
        type: 'init',
        proxyId,
        rule: fullRule,
        globalMockDir: this.yamlStore.getMockDir(),
      });

      return;
    }

    if (data.type === 'error') {
      vscode.window.showErrorMessage(data.message || 'Mock 规则面板发生错误');
      return;
    }

    if (data.type === 'cancel') {
      this.rulePanel?.dispose();
      return;
    }

    if (data.type === 'simulate') {
      this.handleSimulate(data);
      return;
    }

    if (data.type === 'selectFileReturnPath') {
      await this.handleSelectFileReturnPath(data);
      return;
    }

    if (data.type !== 'saveRule') return;

    await this.handleSaveRule(data.payload);
  }

  private handleSimulate(data: MockWebviewMessage): void {
    try {
      const Mock = require('mockjs');
      const parsedTemplate =
        typeof data.template === 'string' ? JSON.parse(data.template) : data.template;

      const result = data.mode === 'mock' ? Mock.mock(parsedTemplate) : parsedTemplate;

      this.rulePanel?.webview.postMessage({
        type: 'simulateResult',
        result,
      });
    } catch (error: any) {
      this.rulePanel?.webview.postMessage({
        type: 'simulateResult',
        error: error.message,
      });
    }
  }

  private async handleSaveRule(payload: MockSaveRulePayload): Promise<void> {
    const mockDir = this.yamlStore.getMockDir();

    if (!mockDir) {
      vscode.window.showErrorMessage('请先设置全局 Mock YAML 存放目录！');
      return;
    }

    const newRuleData = {
      ...payload,
    };

    if (!newRuleData.id) {
      newRuleData.id = nanoid();
    }

    const { proxyList, mockList } = await this.getFullConfig();
    const proxy = proxyList.find(item => item.id === newRuleData.proxyId);

    if (!proxy) {
      vscode.window.showErrorMessage('保存失败：未找到对应 Mock 服务！');
      return;
    }

    const oldRule = mockList.find(item => item.id === newRuleData.id);

    const ruleDataPath = this.yamlStore.ensureYamlFilePath(
      oldRule?.yamlPath || oldRule?.dataPath || mockDir,
      newRuleData.id,
    );

    const ruleToSaveConfig: MockRuleConfig = {
      id: newRuleData.id,
      proxyId: proxy.id,
      method: newRuleData.method,
      url: newRuleData.url,
      contentType: newRuleData.contentType,
      enabled: newRuleData.enabled,
      dataPath: ruleDataPath,
      yamlPath: ruleDataPath,
      mode: newRuleData.mode,
      delay: newRuleData.delay,
      reqHeaders: newRuleData.reqHeaders,
      statusCode: newRuleData.statusCode,
      port: Number(proxy.port),
      domain: proxy.domain || '127.0.0.1',
    };

    if (newRuleData.mode === 'mock') {
      ruleToSaveConfig.template = newRuleData.template || {};
    } else if (newRuleData.mode === 'custom') {
      ruleToSaveConfig.data = newRuleData.data || {};
    } else if (newRuleData.mode === 'file') {
      ruleToSaveConfig.filePath = newRuleData.filePath;
      ruleToSaveConfig.fileDisposition = newRuleData.fileDisposition;
    }

    await this.yamlStore.saveEndpoint(ruleToSaveConfig, ruleDataPath);

    this.draftProxies = this.draftProxies.filter(item => item.id !== proxy.id);

    await this.syncServers();

    this.rulePanel?.dispose();

    await this.refreshSidebar();
  }

  private startServerInstance(serverConfig: MockProxyConfig): void {
    const express = require('express');
    const cors = require('cors');
    const bodyParser = require('body-parser');
    const Mock = require('mockjs');

    const app = express();

    app.use(
      cors({
        origin: true,
        credentials: true,
        allowedHeaders: '*',
        exposedHeaders: '*',
      }),
    );

    app.use(bodyParser.json({ limit: '50mb' }));
    app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));

    app.use(async (req: any, res: any, next: any) => {
      const allMocks = await this.yamlStore.readAllEndpoints();
      const rules = allMocks.filter(item => item.proxyId === serverConfig.id);

      const matchedRule = rules.find(rule => {
        if (!rule.enabled) return false;

        const rulePath = (rule.url || '').split('?')[0];

        return (
          req.method.toUpperCase() === rule.method.toUpperCase() &&
          req.path === rulePath
        );
      });

      if (!matchedRule) {
        return next();
      }

      console.log(`[MockServer:${serverConfig.port}] Mock Hit: ${req.path}`);

      if (matchedRule.reqHeaders && typeof matchedRule.reqHeaders === 'object') {
        Object.assign(req.headers, matchedRule.reqHeaders);
      }

      if (matchedRule.delay && matchedRule.delay > 0) {
        await new Promise(resolve => {
          setTimeout(resolve, matchedRule.delay);
        });
      }

      const statusCode = Number(matchedRule.statusCode || 200);

      if (matchedRule.mode === 'file') {
        return this.sendMockFile(req, res, matchedRule, statusCode);
      }

      res.set('Content-Type', matchedRule.contentType || 'application/json');

      if (matchedRule.mode === 'mock') {
        try {
          const templateObj = this.parseMaybeJson(matchedRule.template || {});
          return res.status(statusCode).send(Mock.mock(templateObj));
        } catch (error: any) {
          return res.status(500).json({
            error: 'Mock Parse Error',
            details: error.message,
          });
        }
      }

      if (matchedRule.mode === 'custom') {
        try {
          const responseData = this.parseMaybeJson(matchedRule.data || {});
          return res.status(statusCode).send(responseData);
        } catch (error: any) {
          return res.status(500).json({
            error: 'JSON Parse Error',
            details: error.message,
          });
        }
      }

      return res.status(statusCode).send({});
    });

    app.use((req: any, res: any) => {
      res.status(404).json({
        error: 'Not Found in Mock Rules',
        path: req.path,
        message: '请求的接口没有匹配到任何已启用的 YAML 拦截规则',
      });
    });

    try {
      const listenHost = this.getListenHost(serverConfig.domain);

      const server = app.listen(serverConfig.port, listenHost, () => {
        server._port = Number(serverConfig.port);
        server._domain = listenHost;

        this.servers.set(serverConfig.id, server);
        this.notifyStatusToWebview();
      }) as MockHttpServer;

      server.on('error', (error: any) => {
        if (error.code === 'EADDRINUSE') {
          vscode.window.showErrorMessage(`启动失败：端口 ${serverConfig.port} 被占用！`);
        } else {
          vscode.window.showErrorMessage(`Mock 服务异常: ${error.message}`);
        }

        this.servers.delete(serverConfig.id);
        this.notifyStatusToWebview();
      });
    } catch (error: any) {
      vscode.window.showErrorMessage(`创建服务异常: ${error.message}`);
    }
  }

  private async sendMockFile(
    req: any,
    res: any,
    matchedRule: MockRuleConfig,
    statusCode: number,
  ): Promise<any> {
    if (!matchedRule.filePath) {
      return res.status(400).json({
        error: '文件路径未配置',
      });
    }

    const filePaths = matchedRule.filePath
      .split('\n')
      .map(item => item.trim())
      .filter(Boolean);

    if (filePaths.length === 0) {
      return res.status(400).json({
        error: '文件路径未配置或为空',
      });
    }

    let targetFile = '';

    if (filePaths.length > 1) {
      const fileIdx = req.query.fileIdx;

      if (fileIdx === undefined) {
        const protocol = req.protocol || 'http';
        const host = req.get('host');
        const baseUrl = `${protocol}://${host}${req.path}`;
        const urls = filePaths.map((_, index) => `${baseUrl}?fileIdx=${index}`);

        return res.status(statusCode).json(urls);
      }

      const index = Number(fileIdx);

      if (Number.isNaN(index) || index < 0 || index >= filePaths.length) {
        return res.status(404).json({
          error: '文件索引不存在或越界',
        });
      }

      targetFile = filePaths[index];
    } else {
      targetFile = filePaths[0];
    }

    let targetUri: vscode.Uri;

    if (path.isAbsolute(targetFile)) {
      targetUri = vscode.Uri.file(targetFile);
    } else {
      const rootUri = this.getWorkspaceRootUri();

      if (rootUri) {
        targetUri = vscode.Uri.joinPath(
          rootUri,
          ...targetFile.replace(/\\/g, '/').split('/').filter(Boolean),
        );
      } else {
        targetUri = vscode.Uri.file(targetFile);
      }
    }

    try {
      await vscode.workspace.fs.stat(targetUri);

      const fileData = await vscode.workspace.fs.readFile(targetUri);
      const buffer = Buffer.from(fileData);
      const disposition =
        matchedRule.fileDisposition === 'attachment' ? 'attachment' : 'inline';

      const fileName = targetUri.path.split('/').pop() || 'download_file';
      const encodedFileName = encodeURIComponent(fileName);

      res.set(
        'Content-Disposition',
        `${disposition}; filename*=UTF-8''${encodedFileName}`,
      );

      if (matchedRule.contentType && matchedRule.contentType !== 'application/json') {
        res.set('Content-Type', matchedRule.contentType);
      }

      return res.status(statusCode).send(buffer);
    } catch (error: any) {
      console.error('[MockServer] 读取发送文件失败:', error);

      if (!res.headersSent) {
        return res.status(404).json({
          error: '配置返回的文件不存在或无法读取',
          path: targetUri.toString(),
        });
      }
    }
  }

  private getWorkspaceRootUri(): vscode.Uri | undefined {
    const folders = vscode.workspace.workspaceFolders;

    return folders && folders.length > 0 ? folders[0].uri : undefined;
  }

  private getDefaultUri(currentPath?: string): vscode.Uri | undefined {
    if (currentPath && currentPath.trim() !== '') {
      const currentUri = this.yamlStore.resolvePathToUri(currentPath);

      if (currentUri) return currentUri;
    }

    const mockDir = this.yamlStore.getMockDir();

    if (mockDir) {
      const mockDirUri = this.yamlStore.resolvePathToUri(mockDir);

      if (mockDirUri) return mockDirUri;
    }

    return this.getWorkspaceRootUri();
  }

  private parseMaybeJson(value: any): any {
    if (typeof value !== 'string') return value;

    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  private getListenHost(domain?: string): string {
    const value = (domain || '127.0.0.1').trim();

    const host = value
      .replace(/^https?:\/\//, '')
      .split('/')[0]
      .split(':')[0];

    if (!host || host === 'localhost') return '127.0.0.1';

    return host;
  }
}

class MockYamlStore {
  constructor(private readonly configurationService: ConfigurationService) {}

  public getMockDir(): string {
    const general = vscode.workspace
      .getConfiguration('quick-ops')
      .get<{ mockDir?: string }>('general');

    const serviceGeneral = this.configurationService.get<Record<string, any>>(
      'general',
      {},
    );

    return general?.mockDir || serviceGeneral?.mockDir || '';
  }

  public getWorkspaceRootUri(): vscode.Uri | undefined {
    const folders = vscode.workspace.workspaceFolders;

    return folders && folders.length > 0 ? folders[0].uri : undefined;
  }

  public buildServiceId(domain?: string, port?: number): string {
    return `${this.normalizeDomain(domain)}:${Number(port || 0)}`;
  }

  public resolvePathToUri(input?: string): vscode.Uri | undefined {
    const value = (input || '').trim();

    if (!value) return this.getWorkspaceRootUri();

    if (/^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(value)) {
      return vscode.Uri.parse(value);
    }

    if (path.isAbsolute(value)) {
      return vscode.Uri.file(value);
    }

    const rootUri = this.getWorkspaceRootUri();

    if (rootUri) {
      const parts = value
        .replace(/\\/g, '/')
        .split('/')
        .filter(item => item && item !== '.');

      return parts.length > 0 ? vscode.Uri.joinPath(rootUri, ...parts) : rootUri;
    }

    return vscode.Uri.file(value);
  }

  public pathForConfig(uri: vscode.Uri): string {
    const rootUri = this.getWorkspaceRootUri();

    if (
      rootUri &&
      uri.scheme === rootUri.scheme &&
      uri.authority === rootUri.authority
    ) {
      const rootPath = rootUri.path.replace(/\/+$/, '');
      const targetPath = uri.path;

      if (targetPath === rootPath) return '.';

      if (targetPath.startsWith(`${rootPath}/`)) {
        return targetPath.slice(rootPath.length + 1).replace(/\\/g, '/');
      }
    }

    if (uri.scheme === 'file') {
      return uri.fsPath.replace(/\\/g, '/');
    }

    return uri.toString();
  }

  public ensureYamlFilePath(input: string, id: string): string {
    const value = (input || '').trim().replace(/\\/g, '/');

    if (!value) {
      const mockDir = this.getMockDir();

      if (!mockDir) {
        throw new Error('请先设置全局 Mock YAML 存放目录');
      }

      return path.posix.join(mockDir.replace(/\\/g, '/'), `${id}.yaml`);
    }

    if (/\.ya?ml$/i.test(value)) return value;

    if (/^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(value)) {
      return vscode.Uri.joinPath(vscode.Uri.parse(value), `${id}.yaml`).toString();
    }

    return path.posix.join(value, `${id}.yaml`);
  }

  public async readAllServices(): Promise<MockProxyConfig[]> {
    const endpoints = await this.readAllEndpoints();
    const serviceMap = new Map<string, MockProxyConfig>();

    for (const item of endpoints) {
      const port = Number(item.port || 0);
      const domain = this.normalizeDomain(item.domain);

      if (!port) continue;

      const serviceId = this.buildServiceId(domain, port);
      const existed = serviceMap.get(serviceId);

      if (existed) {
        existed.enabled = existed.enabled || item.enabled;
      } else {
        serviceMap.set(serviceId, {
          id: serviceId,
          port,
          domain,
          enabled: !!item.enabled,
        });
      }
    }

    return Array.from(serviceMap.values());
  }

  public async readAllEndpoints(): Promise<MockRuleConfig[]> {
    const docs = await this.readAllYamlDocuments();

    return docs
      .map(doc => this.readEndpointFromRaw(doc.raw, doc.uri))
      .filter(Boolean) as MockRuleConfig[];
  }

  public async saveEndpoint(
    endpoint: MockRuleConfig,
    yamlPath?: string,
  ): Promise<MockRuleConfig> {
    const id = endpoint.id;

    const finalYamlPath = this.ensureYamlFilePath(
      yamlPath || endpoint.dataPath || endpoint.yamlPath || this.getMockDir(),
      id,
    );

    const yamlUri = this.resolvePathToUri(finalYamlPath);

    if (!yamlUri) {
      throw new Error('无法解析接口 YAML 文件路径');
    }

    const doc = this.toEndpointYamlDocument(endpoint);
    const yamlText = YAML.stringify(doc);

    await this.ensureParentDirectory(yamlUri);

    await vscode.workspace.fs.writeFile(yamlUri, Buffer.from(yamlText, 'utf8'));

    return {
      ...endpoint,
      dataPath: this.pathForConfig(yamlUri),
      yamlPath: this.pathForConfig(yamlUri),
      _yamlUri: yamlUri,
    };
  }

  public async patchEndpoint(
    ruleId: string,
    patch: Partial<MockRuleConfig>,
  ): Promise<void> {
    const endpoints = await this.readAllEndpoints();
    const target = endpoints.find(item => item.id === ruleId);

    if (!target) return;

    await this.saveEndpoint(
      {
        ...target,
        ...patch,
      },
      target.yamlPath || target.dataPath,
    );
  }

  public async patchService(
    serviceId: string,
    patch: Partial<MockProxyConfig>,
  ): Promise<void> {
    const endpoints = await this.readAllEndpoints();
    const targets = endpoints.filter(item => item.proxyId === serviceId);

    for (const item of targets) {
      const nextDomain = patch.domain === undefined ? item.domain : patch.domain;
      const nextPort = patch.port === undefined ? item.port : Number(patch.port);

      await this.saveEndpoint(
        {
          ...item,
          domain: nextDomain,
          port: nextPort,
          proxyId: this.buildServiceId(nextDomain, nextPort),
          enabled: patch.enabled === undefined ? item.enabled : !!patch.enabled,
        },
        item.yamlPath || item.dataPath,
      );
    }
  }

  public async setAllEnabled(enabled: boolean): Promise<void> {
    const endpoints = await this.readAllEndpoints();

    for (const item of endpoints) {
      await this.saveEndpoint(
        {
          ...item,
          enabled,
        },
        item.yamlPath || item.dataPath,
      );
    }
  }

  public async deleteEndpoint(ruleId: string): Promise<void> {
    const endpoints = await this.readAllEndpoints();
    const target = endpoints.find(item => item.id === ruleId);

    if (!target?._yamlUri) return;

    try {
      await vscode.workspace.fs.delete(target._yamlUri, {
        useTrash: false,
      });
    } catch {
      // ignore
    }
  }

  public async deleteService(serviceId: string): Promise<void> {
    const endpoints = await this.readAllEndpoints();
    const targets = endpoints.filter(item => item.proxyId === serviceId);

    for (const item of targets) {
      if (!item._yamlUri) continue;

      try {
        await vscode.workspace.fs.delete(item._yamlUri, {
          useTrash: false,
        });
      } catch {
        // ignore
      }
    }
  }

  private async readAllYamlDocuments(): Promise<MockYamlDocument[]> {
    const mockDir = this.getMockDir();

    if (!mockDir) return [];

    const dirUri = this.resolvePathToUri(mockDir);

    if (!dirUri) return [];

    try {
      const stat = await vscode.workspace.fs.stat(dirUri);

      if (stat.type === vscode.FileType.File) {
        if (!/\.ya?ml$/i.test(dirUri.path)) return [];

        const raw = await this.readYamlRaw(dirUri);

        return raw ? [{ uri: dirUri, raw }] : [];
      }

      const yamlUris = await this.readYamlFilesRecursive(dirUri);

      const docs = await Promise.all(
        yamlUris.map(async uri => {
          const raw = await this.readYamlRaw(uri);

          return raw
            ? {
                uri,
                raw,
              }
            : undefined;
        }),
      );

      return docs.filter(Boolean) as MockYamlDocument[];
    } catch {
      return [];
    }
  }

  private async readYamlRaw(uri: vscode.Uri): Promise<any | undefined> {
    try {
      const fileData = await vscode.workspace.fs.readFile(uri);
      return YAML.parse(Buffer.from(fileData).toString('utf8')) || {};
    } catch (error) {
      console.error('[MockYamlStore] 读取 YAML 失败:', uri.toString(), error);
      return undefined;
    }
  }

  private async readYamlFilesRecursive(dirUri: vscode.Uri): Promise<vscode.Uri[]> {
    const result: vscode.Uri[] = [];

    let entries: [string, vscode.FileType][] = [];

    try {
      entries = await vscode.workspace.fs.readDirectory(dirUri);
    } catch {
      return result;
    }

    for (const [name, type] of entries) {
      const childUri = vscode.Uri.joinPath(dirUri, name);

      if (type === vscode.FileType.Directory) {
        result.push(...(await this.readYamlFilesRecursive(childUri)));
      } else if (type === vscode.FileType.File && /\.ya?ml$/i.test(name)) {
        result.push(childUri);
      }
    }

    return result;
  }

  private readEndpointFromRaw(
    raw: any,
    uri: vscode.Uri,
  ): MockRuleConfig | undefined {
    const request = raw.request || {};
    const response = raw.response || {};
    const service = raw.service || {};

    const hasEndpointShape =
      raw.type === 'quickops-mock-endpoint' ||
      request.path ||
      raw.url ||
      raw.path ||
      response.mode ||
      raw.mode;

    if (!hasEndpointShape) return undefined;

    const port = Number(service.port ?? raw.port);

    if (!port) return undefined;

    const domain = this.normalizeDomain(service.domain || raw.domain || '127.0.0.1');
    const proxyId = this.buildServiceId(domain, port);
    const id = String(raw.id || this.getFileNameWithoutExt(uri));

    const method = String(
      request.method ||
        raw.method ||
        (Array.isArray(request.methods) ? request.methods[0] : undefined) ||
        (Array.isArray(raw.methods) ? raw.methods[0] : undefined) ||
        'GET',
    ).toUpperCase();

    const url = this.normalizeUrl(String(request.path || raw.url || raw.path || '/'));
    const responseFile = response.file || {};

    let mode = String(response.mode || raw.mode || '') as MockRuleMode;

    if (!mode) {
      if (responseFile.path || raw.filePath) {
        mode = 'file';
      } else if (response.template || raw.template) {
        mode = 'mock';
      } else {
        mode = 'custom';
      }
    }

    const data = response.data ?? response.content ?? raw.data ?? raw.content;
    const template =
      response.template ?? raw.template ?? (mode === 'mock' ? response.content : undefined);

    const yamlPath = this.pathForConfig(uri);

    return {
      id,
      proxyId,
      method,
      url,
      contentType: String(response.contentType || raw.contentType || 'application/json'),
      enabled: raw.enabled !== false,
      dataPath: yamlPath,
      yamlPath,
      mode,
      delay: Number(response.delay ?? raw.delay ?? 0),
      reqHeaders: request.headers || raw.reqHeaders || null,
      statusCode: Number(response.statusCode ?? raw.statusCode ?? 200),
      data,
      template,
      filePath: String(responseFile.path || raw.filePath || ''),
      fileDisposition: String(responseFile.disposition || raw.fileDisposition || 'inline'),
      port,
      domain,
      _yamlUri: uri,
    };
  }

  private toEndpointYamlDocument(endpoint: MockRuleConfig): any {
    const method = String(endpoint.method || 'GET').toUpperCase();
    const mode = endpoint.mode || 'mock';
    const statusCode = Number(endpoint.statusCode || 200);
    const delay = Number(endpoint.delay || 0);
    const domain = this.normalizeDomain(endpoint.domain || '127.0.0.1');
    const port = Number(endpoint.port || 0);

    const request: any = {
      method,
      methods: [method],
      path: this.normalizeUrl(endpoint.url || '/'),
    };

    if (endpoint.reqHeaders && typeof endpoint.reqHeaders === 'object') {
      request.headers = endpoint.reqHeaders;
    }

    const response: any = {
      statusCode,
      contentType: endpoint.contentType || 'application/json',
      delay,
      mode,
    };

    if (mode === 'file') {
      response.file = {
        path: endpoint.filePath || '',
        disposition: endpoint.fileDisposition || 'inline',
      };

      response.content = {
        type: 'file',
        path: endpoint.filePath || '',
      };
    } else if (mode === 'custom') {
      response.data = endpoint.data ?? {};
      response.content = endpoint.data ?? {};
    } else {
      response.template = endpoint.template ?? {};
      response.content = endpoint.template ?? {};
    }

    return {
      version: 1,
      type: 'quickops-mock-endpoint',
      id: endpoint.id,
      enabled: endpoint.enabled !== false,
      service: {
        domain,
        port,
      },
      request,
      response,
    };
  }

  private async ensureParentDirectory(fileUri: vscode.Uri): Promise<void> {
    const parentPath = fileUri.path.replace(/\/[^/]*$/, '') || '/';
    const parentUri = fileUri.with({
      path: parentPath,
    });

    try {
      await vscode.workspace.fs.createDirectory(parentUri);
    } catch {
      // ignore
    }
  }

  private getFileNameWithoutExt(uri: vscode.Uri): string {
    const baseName = uri.path.split('/').pop() || 'mock';

    return baseName.replace(/\.ya?ml$/i, '');
  }

  private normalizeUrl(url: string): string {
    const value = (url || '/').trim();

    return value.startsWith('/') ? value : `/${value}`;
  }

  private normalizeDomain(domain?: string): string {
    const value = String(domain || '127.0.0.1').trim();

    return (
      value
        .replace(/^https?:\/\//, '')
        .split('/')[0]
        .split(':')[0] || '127.0.0.1'
    );
  }
}