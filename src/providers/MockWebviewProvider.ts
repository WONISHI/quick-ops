import * as vscode from 'vscode';
import { nanoid } from 'nanoid';

import { ConfigurationService } from '../common/services/configuration.service';
import { MockServerFeature } from '../features/MockServerFeature';
import { getReactWebviewHtml } from '../utils/WebviewHelper';
import { IMockRuleConfig, IProxyConfig, MockYamlStore } from '../services/MockYamlStore';

export class MockWebviewProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;

  private proxyPanel: vscode.WebviewPanel | undefined;
  private rulePanel: vscode.WebviewPanel | undefined;

  private yamlStore = new MockYamlStore();
  private draftProxies: IProxyConfig[] = [];

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _mockFeature: MockServerFeature,
  ) {}

  public resolveWebviewView(webviewView: vscode.WebviewView, context: vscode.WebviewViewResolveContext, _token: vscode.CancellationToken) {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true, localResourceRoots: [this._extensionUri] };

    webviewView.webview.html = getReactWebviewHtml(this._extensionUri, webviewView.webview, '/mock');

    webviewView.webview.onDidReceiveMessage(async (data) => {
      await this.handleMessage(data, webviewView.webview);
    });
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

  private async getFullConfig() {
    const proxyList = await this.yamlStore.readAllServices();
    const endpoints = await this.yamlStore.readAllEndpoints();

    const proxyMap = new Map<string, IProxyConfig>();

    for (const item of proxyList) {
      proxyMap.set(item.id, item);
    }

    for (const item of this.draftProxies) {
      if (!proxyMap.has(item.id)) {
        proxyMap.set(item.id, item);
      }
    }

    const mockList = endpoints.map((item) => {
      const { _yamlUri, ...rest } = item;
      return rest;
    });

    const mockDir = this.yamlStore.getMockDir();

    return {
      proxyList: Array.from(proxyMap.values()),
      mockList,
      mockDir,
    };
  }

  public async handleMessage(data: any, webview: vscode.Webview) {
    const configService = ConfigurationService.getInstance();
    const { proxyList, mockList: fullMockList } = await this.getFullConfig();

    switch (data.type) {
      case 'webviewLoaded':
        this.refreshSidebar();
        break;

      case 'error':
        vscode.window.showErrorMessage(data.message);
        break;

      case 'refresh':
        this.refreshSidebar();
        break;

      case 'toggleServer': {
        if (proxyList.length === 0) {
          vscode.window.showWarningMessage('操作失败：请先添加 Mock 服务！');
          break;
        }

        await this.yamlStore.setAllEnabled(data.value);
        this.draftProxies = this.draftProxies.map((item) => ({
          ...item,
          enabled: data.value,
        }));

        await this._mockFeature.syncServers();
        this.refreshSidebar();
        break;
      }

      case 'copyText':
        vscode.env.clipboard.writeText(data.payload).then(() => vscode.window.showInformationMessage('复制成功：' + data.payload));
        break;

      case 'selectGlobalMockDir': {
        const defaultUri = this.getDefaultUri(data.currentPath);
        const uri = await vscode.window.showOpenDialog({
          canSelectFiles: false,
          canSelectFolders: true,
          canSelectMany: false,
          defaultUri,
          openLabel: '选择全局 Mock YAML 存放目录',
          title: '选择全局 Mock YAML 存放目录',
        });

        if (uri && uri[0]) {
          const savePath = this.yamlStore.pathForConfig(uri[0]);

          const general = {
            ...(configService.config.general || {}),
            mockDir: savePath,
          };

          await configService.updateConfig('general', general);

          (configService.config as any).general = general;

          vscode.window.showInformationMessage(`已设置 Mock YAML 目录：${savePath}`);

          this._view?.webview.postMessage({
            type: 'config',
            proxy: proxyList,
            mock: fullMockList,
            mockDir: savePath,
          });

          this.refreshSidebar();
        }

        break;
      }

      case 'selectFileReturnPath': {
        const defaultUri = this.getDefaultUri(data.currentPath);
        const uris = await vscode.window.showOpenDialog({
          canSelectFiles: true,
          canSelectFolders: false,
          canSelectMany: data.multiple === true,
          defaultUri,
          openLabel: data.multiple ? '选择文件 (支持多选)' : '选择文件',
        });

        if (uris && uris.length > 0) {
          const paths = uris.map((uri) => this.yamlStore.pathForConfig(uri));
          this.rulePanel?.webview.postMessage({ type: 'fileReturnPathSelected', path: paths.join('\n') });
        }
        break;
      }

      case 'openProxyPanel':
        this.showProxyPanel(data.id);
        break;

      case 'openRulePanel':
        this.showRulePanel(data.proxyId, data.ruleId);
        break;

      case 'toggleProxy': {
        const pGroup = proxyList.find((p: IProxyConfig) => p.id === data.id);
        if (pGroup) {
          await this.yamlStore.patchService(data.id, { enabled: data.enabled });
          this.draftProxies = this.draftProxies.map((item) => (item.id === data.id ? { ...item, enabled: data.enabled } : item));

          await this._mockFeature.syncServers();
          this.refreshSidebar();
        }
        break;
      }

      case 'deleteProxy': {
        const ansProxy = await vscode.window.showWarningMessage(`确定要删除此服务吗？相关的 YAML 接口规则也会被移除。`, { modal: true }, '删除');
        if (ansProxy === '删除') {
          await this.yamlStore.deleteService(data.id);
          this.draftProxies = this.draftProxies.filter((item) => item.id !== data.id);

          await this._mockFeature.syncServers();
          this.refreshSidebar();
        }
        break;
      }

      case 'deleteRule': {
        const ansRule = await vscode.window.showWarningMessage(`确定要删除此规则 YAML 文件吗？`, { modal: true }, '删除');
        if (ansRule === '删除') {
          await this.yamlStore.deleteEndpoint(data.ruleId);
          await this._mockFeature.syncServers();
          this.refreshSidebar();
        }
        break;
      }

      case 'toggleRule': {
        await this.yamlStore.patchEndpoint(data.ruleId, { enabled: data.enabled });
        await this._mockFeature.syncServers();
        this.refreshSidebar();
        break;
      }
    }
  }

  public updateStatus(runningProxyIds: string[]) {
    this._view?.webview.postMessage({ type: 'status', runningProxies: runningProxyIds });
  }

  private async refreshSidebar() {
    if (this._view) {
      const { proxyList, mockList, mockDir } = await this.getFullConfig();
      this._view.webview.postMessage({ type: 'config', proxy: proxyList, mock: mockList, mockDir });
      this._mockFeature.notifyStatusToWebview();
    }
  }

  public async showProxyPanel(proxyId?: string) {
    if (this.rulePanel) {
      this.rulePanel.dispose();
      this.rulePanel = undefined;
    }

    if (this.proxyPanel) {
      this.proxyPanel.dispose();
      this.proxyPanel = undefined;
    }

    this.proxyPanel = vscode.window.createWebviewPanel('quickOps.mockProxyPanel', proxyId ? '编辑 Mock 服务' : '新增 Mock 服务', vscode.ViewColumn.One, {
      enableScripts: true,
      retainContextWhenHidden: false,
      localResourceRoots: [this._extensionUri],
    });

    this.proxyPanel.onDidDispose(() => {
      this.proxyPanel = undefined;
    });

    this.proxyPanel.webview.html = getReactWebviewHtml(this._extensionUri, this.proxyPanel.webview, '/mock/proxy');

    this.proxyPanel.webview.onDidReceiveMessage(async (data) => {
      if (data.type === 'webviewLoaded') {
        const { proxyList } = await this.getFullConfig();

        this.proxyPanel?.webview.postMessage({
          type: 'init',
          proxy: proxyList.find((p: any) => p.id === proxyId),
        });
      } else if (data.type === 'error') {
        vscode.window.showErrorMessage(data.message);
      } else if (data.type === 'cancel') {
        this.proxyPanel?.dispose();
      } else if (data.type === 'saveProxy') {
        const mockDir = this.yamlStore.getMockDir();

        if (!mockDir) {
          vscode.window.showErrorMessage('请先设置全局 Mock YAML 存放目录！');
          return;
        }

        const newProxy = data.payload;
        const domain = newProxy.domain || '127.0.0.1';
        const port = Number(newProxy.port);
        const nextId = this.yamlStore.buildServiceId(domain, port);

        if (!port) {
          vscode.window.showErrorMessage('端口不能为空！');
          return;
        }

        if (newProxy.id) {
          const existedDraftIndex = this.draftProxies.findIndex((item) => item.id === newProxy.id);

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
          const existedDraftIndex = this.draftProxies.findIndex((item) => item.id === nextId);

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

        await this._mockFeature.syncServers();
        this.proxyPanel?.dispose();
        this.refreshSidebar();
      }
    });
  }

  public async showRulePanel(proxyId: string, ruleId?: string) {
    if (this.proxyPanel) {
      this.proxyPanel.dispose();
      this.proxyPanel = undefined;
    }

    if (this.rulePanel) {
      this.rulePanel.dispose();
      this.rulePanel = undefined;
    }

    this.rulePanel = vscode.window.createWebviewPanel('quickOps.mockRulePanel', ruleId ? '编辑规则' : '新增规则', vscode.ViewColumn.One, {
      enableScripts: true,
      retainContextWhenHidden: false,
      localResourceRoots: [this._extensionUri],
    });

    this.rulePanel.onDidDispose(() => {
      this.rulePanel = undefined;
    });

    this.rulePanel.webview.html = getReactWebviewHtml(this._extensionUri, this.rulePanel.webview, '/mock/rule');

    this.rulePanel.webview.onDidReceiveMessage(async (data) => {
      if (data.type === 'webviewLoaded') {
        const { mockList } = await this.getFullConfig();
        const fullRule = ruleId ? mockList.find((r: any) => r.id === ruleId) || null : null;

        this.rulePanel?.webview.postMessage({
          type: 'init',
          proxyId,
          rule: fullRule,
          globalMockDir: this.yamlStore.getMockDir(),
        });
      } else if (data.type === 'error') {
        vscode.window.showErrorMessage(data.message);
      } else if (data.type === 'cancel') {
        this.rulePanel?.dispose();
      } else if (data.type === 'simulate') {
        try {
          const Mock = require('mockjs');

          let parsedTemplate = typeof data.template === 'string' ? JSON.parse(data.template) : data.template;
          let result = data.mode === 'mock' ? Mock.mock(parsedTemplate) : parsedTemplate;

          this.rulePanel?.webview.postMessage({ type: 'simulateResult', result });
        } catch (e: any) {
          this.rulePanel?.webview.postMessage({ type: 'simulateResult', error: e.message });
        }
      } else if (data.type === 'selectFileReturnPath') {
        await this.handleMessage(data, this.rulePanel!.webview);
      } else if (data.type === 'saveRule') {
        const mockDir = this.yamlStore.getMockDir();

        if (!mockDir) {
          return vscode.window.showErrorMessage('请先设置全局 Mock YAML 存放目录！');
        }

        const newRuleData = data.payload;

        if (!newRuleData.id) newRuleData.id = nanoid();

        const { proxyList, mockList } = await this.getFullConfig();
        const proxy = proxyList.find((p) => p.id === newRuleData.proxyId);

        if (!proxy) {
          return vscode.window.showErrorMessage('保存失败：未找到对应 Mock 服务！');
        }

        const oldRule = mockList.find((r: any) => r.id === newRuleData.id);
        const ruleDataPath = this.yamlStore.ensureYamlFilePath(oldRule?.yamlPath || oldRule?.dataPath || mockDir, newRuleData.id);

        const ruleToSaveConfig: IMockRuleConfig = {
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

        this.draftProxies = this.draftProxies.filter((item) => item.id !== proxy.id);

        await this._mockFeature.syncServers();
        this.rulePanel?.dispose();
        this.refreshSidebar();
      }
    });
  }
}
