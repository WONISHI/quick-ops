import * as http from 'http';
import * as os from 'os';
import * as vscode from 'vscode';
import httpProxy = require('http-proxy');
import type { IncomingMessage, ServerResponse } from 'http';
import type { Socket } from 'net';
import ReactWebviewHtmlWorkflow from '@/workflow/react-webview-html';
import { ExtensionContextProvider } from '@common/providers/extension-context.provider';

type ApiProxyMatchType = 'exact' | 'regex';

interface ApiProxyMatchItem {
  id: string;
  match: string;
  target?: string;
}

interface ApiProxyRule {
  id: string;
  name: string;
  enabled: boolean;
  matchType: ApiProxyMatchType;
  match: string;
  matches?: ApiProxyMatchItem[];
  target: string;
  rewrite?: string;
  preserveQuery: boolean;
}

interface ApiProxyMatchedRule {
  rule: ApiProxyRule;
  match: string;
  target?: string;
}

interface ApiProxyGroup {
  id: string;
  name: string;
  collapsed?: boolean;
  ruleIds: string[];
}

interface ApiProxyLogItem {
  id: string;
  time: number;
  level: 'info' | 'success' | 'error';
  message: string;
  from?: string;
  to?: string;
}

interface ApiProxyServerState {
  running: boolean;
  port: number;
  origin: string;
  listenHost: string;
  listenHosts: string[];
  listenPort: number;
  devServerOrigin: string;
}

type ApiProxyWebviewMessage =
  | { type: 'apiProxyReady' }
  | { type: 'saveApiProxyRules'; rules: ApiProxyRule[] }
  | { type: 'saveApiProxyGroups'; groups: ApiProxyGroup[] }
  | { type: 'openApiProxyEditor'; ruleId?: string }
  | { type: 'createApiProxyInGroup'; groupId?: string; groupName?: string; collapsed?: boolean; ruleIds?: string[] }
  | { type: 'renameApiProxyGroup'; groupId: string; groupName?: string; collapsed?: boolean; ruleIds?: string[] }
  | { type: 'deleteApiProxyGroup'; groupId: string; groupName?: string }
  | { type: 'deleteApiProxyRule'; ruleId: string; ruleName?: string }
  | { type: 'saveApiProxyServerOptions'; listenHost?: string; listenPort?: number | string; devServerOrigin?: string }
  | { type: 'startApiProxyServer'; listenHost?: string; listenPort?: number | string; devServerOrigin?: string }
  | { type: 'stopApiProxyServer' }
  | { type: 'openApiProxyExternal'; url?: string }
  | { type: 'clearApiProxyLogs' };

const API_PROXY_LIST_WEBVIEW_ROUTE = '/api-proxy';
const API_PROXY_EDITOR_WEBVIEW_ROUTE = '/api-proxy-editor';
const API_PROXY_STORAGE_KEY = 'quickOps.apiProxy.state';
const API_PROXY_EDITOR_PANEL_TYPE = 'quickOps.apiProxyEditor';
const API_PROXY_DEFAULT_PORT = 57197;
const API_PROXY_DEFAULT_DEV_SERVER_ORIGIN = 'http://localhost:8081';

const DEFAULT_SERVER: ApiProxyServerState = {
  running: false,
  port: 0,
  origin: '',
  listenHost: '127.0.0.1',
  listenHosts: ['127.0.0.1', '0.0.0.0'],
  listenPort: API_PROXY_DEFAULT_PORT,
  devServerOrigin: API_PROXY_DEFAULT_DEV_SERVER_ORIGIN,
};

export class ApiProxyWebviewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  public static readonly listViewType = 'quickOpsApiProxyList';

  public static inject = [ExtensionContextProvider];

  private readonly reactWebviewHtmlWorkflow = new ReactWebviewHtmlWorkflow();
  private view?: vscode.WebviewView;
  private editorPanel?: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly proxy = httpProxy.createProxyServer({
    changeOrigin: true,
    secure: false,
    ws: true,
  });

  private server?: http.Server;
  private readonly apiProxyRequests = new WeakSet<IncomingMessage>();
  private readonly apiProxyRequestTargets = new WeakMap<IncomingMessage, { source: string; target: string }>();
  private rules: ApiProxyRule[] = [];
  private groups: ApiProxyGroup[] = [];
  private logs: ApiProxyLogItem[] = [];
  private activeRuleId = '';
  private proxyHost = DEFAULT_SERVER.listenHost;
  private proxyPort = API_PROXY_DEFAULT_PORT;
  private devServerOrigin = API_PROXY_DEFAULT_DEV_SERVER_ORIGIN;
  private serverState: ApiProxyServerState = DEFAULT_SERVER;

  constructor(private readonly extensionContextProvider: ExtensionContextProvider) {
    this.restoreState();
    this.registerProxyEvents();
  }

  public async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
    const context = this.extensionContextProvider.getContext();
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [context.extensionUri],
    };

    webviewView.webview.html = await this.reactWebviewHtmlWorkflow.createReactWebviewHtml({
      extensionUri: context.extensionUri,
      webview: webviewView.webview,
      routeName: API_PROXY_LIST_WEBVIEW_ROUTE,
    });

    this.disposables.push(
      webviewView.webview.onDidReceiveMessage(async (message: ApiProxyWebviewMessage) => {
        await this.handleMessage(message);
      }),
      webviewView.onDidDispose(() => {
        if (this.view === webviewView) {
          this.view = undefined;
        }
      }),
    );
  }

  public async createGroupFromViewTitle(): Promise<void> {
    const name = await vscode.window.showInputBox({
      title: '新建代理分组',
      prompt: '请输入分组名称',
      placeHolder: '例如：监控接口',
      value: '新建分组',
      ignoreFocusOut: true,
    });

    const groupName = name?.trim();

    if (!groupName) return;

    this.groups = [
      ...this.groups,
      {
        id: this.createId('group'),
        name: groupName,
        collapsed: false,
        ruleIds: [],
      },
    ];

    await this.persistState();
    this.postState();
  }

  public async createProxyFromViewTitle(): Promise<void> {
    const name = await vscode.window.showInputBox({
      title: '新建代理',
      prompt: '请输入代理名称',
      placeHolder: '例如：登录接口',
      value: '新建代理',
      ignoreFocusOut: true,
    });

    const proxyName = name?.trim();

    if (!proxyName) return;

    const rule: ApiProxyRule = {
      id: this.createId('proxy'),
      name: proxyName,
      enabled: false,
      matchType: 'regex',
      match: '/ISAPI/(.*)',
      matches: [
        {
          id: this.createId('match'),
          match: '/ISAPI/(.*)',
          target: '',
        },
      ],
      target: 'http://127.0.0.1:80',
      rewrite: '/ISAPI/$1',
      preserveQuery: true,
    };

    this.rules = [...this.rules, rule];

    if (this.groups.length > 0) {
      const firstGroupId = this.groups[0].id;
      this.groups = this.groups.map((group) =>
        group.id === firstGroupId
          ? {
              ...group,
              ruleIds: [...new Set([...(group.ruleIds || []), rule.id])],
            }
          : group,
      );
    }

    this.activeRuleId = rule.id;
    await this.persistState();
    this.postState();
    await this.openEditor(rule.id);
  }

  private async createProxyInGroup(message: Extract<ApiProxyWebviewMessage, { type: 'createApiProxyInGroup' }>): Promise<void> {
    const name = await vscode.window.showInputBox({
      title: '新建代理',
      prompt: '请输入代理名称',
      placeHolder: '例如：登录接口',
      value: '新建代理',
      ignoreFocusOut: true,
    });

    const proxyName = name?.trim();

    if (!proxyName) return;

    const rule: ApiProxyRule = {
      id: this.createId('proxy'),
      name: proxyName,
      enabled: false,
      matchType: 'regex',
      match: '/ISAPI/(.*)',
      matches: [
        {
          id: this.createId('match'),
          match: '/ISAPI/(.*)',
          target: '',
        },
      ],
      target: 'http://127.0.0.1:80',
      rewrite: '/ISAPI/$1',
      preserveQuery: true,
    };

    this.rules = [...this.rules, rule];

    if (message.groupId && message.groupId !== 'ungrouped') {
      const exists = this.groups.some((group) => group.id === message.groupId);

      this.groups = exists
        ? this.groups.map((group) =>
            group.id === message.groupId
              ? {
                  ...group,
                  ruleIds: [...new Set([...(group.ruleIds || []), rule.id])],
                }
              : group,
          )
        : [
            ...this.groups,
            {
              id: message.groupId,
              name: message.groupName || '默认分组',
              collapsed: !!message.collapsed,
              ruleIds: [...new Set([...(message.ruleIds || []), rule.id])],
            },
          ];
    }

    this.activeRuleId = rule.id;
    this.syncGroupsWithRules();
    await this.persistState();
    this.postState();
    await this.openEditor(rule.id);
  }

  private async renameGroup(message: Extract<ApiProxyWebviewMessage, { type: 'renameApiProxyGroup' }>): Promise<void> {
    if (!message.groupId || message.groupId === 'ungrouped') return;

    const name = await vscode.window.showInputBox({
      title: '分组重命名',
      prompt: '请输入新的分组名称',
      value: message.groupName || '默认分组',
      ignoreFocusOut: true,
    });

    const groupName = name?.trim();

    if (!groupName || groupName === message.groupName) return;

    const exists = this.groups.some((group) => group.id === message.groupId);

    this.groups = exists
      ? this.groups.map((group) =>
          group.id === message.groupId
            ? {
                ...group,
                name: groupName,
              }
            : group,
        )
      : [
          ...this.groups,
          {
            id: message.groupId,
            name: groupName,
            collapsed: !!message.collapsed,
            ruleIds: message.ruleIds || [],
          },
        ];

    this.syncGroupsWithRules();
    await this.persistState();
    this.postState();
  }

  private async deleteGroup(message: Extract<ApiProxyWebviewMessage, { type: 'deleteApiProxyGroup' }>): Promise<void> {
    if (!message.groupId || message.groupId === 'ungrouped') return;
    if (!this.groups.some((group) => group.id === message.groupId)) return;

    const groupName = message.groupName || '未命名分组';
    const confirmed = await vscode.window.showWarningMessage(`确定删除分组「${groupName}」吗？分组里的代理会移动到未分组。`, { modal: true }, '删除分组');

    if (confirmed !== '删除分组') return;

    this.groups = this.groups.filter((group) => group.id !== message.groupId);
    this.syncGroupsWithRules();
    await this.persistState();
    this.postState();
  }

  private async deleteRule(message: Extract<ApiProxyWebviewMessage, { type: 'deleteApiProxyRule' }>): Promise<void> {
    if (!message.ruleId) return;

    const rule = this.rules.find((item) => item.id === message.ruleId);

    if (!rule) return;

    if (rule.enabled) {
      await vscode.window.showWarningMessage(`代理「${rule.name || message.ruleName || '未命名代理'}」正在启用，不能删除。请先停止代理后再删除。`);
      return;
    }

    const ruleName = rule.name || message.ruleName || '未命名代理';
    const confirmed = await vscode.window.showWarningMessage(`确定删除代理「${ruleName}」吗？`, { modal: true }, '删除代理');

    if (confirmed !== '删除代理') return;

    this.rules = this.rules.filter((item) => item.id !== rule.id);
    this.groups = this.groups.map((group) => ({
      ...group,
      ruleIds: (group.ruleIds || []).filter((ruleId) => ruleId !== rule.id),
    }));

    if (this.activeRuleId === rule.id) {
      this.activeRuleId = '';
      this.postActiveRuleChanged();
    }

    this.syncGroupsWithRules();
    await this.persistState();
    this.postState();
  }

  public async openEditor(ruleId?: string): Promise<void> {
    const context = this.extensionContextProvider.getContext();

    if (ruleId) {
      this.activeRuleId = ruleId;
      await this.persistState();
    }

    if (this.editorPanel) {
      this.editorPanel.reveal(vscode.ViewColumn.One);
      this.postState();
      this.postActiveRuleChanged();
      return;
    }

    const panel = vscode.window.createWebviewPanel(API_PROXY_EDITOR_PANEL_TYPE, '接口代理配置', vscode.ViewColumn.One, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [context.extensionUri],
    });

    this.editorPanel = panel;

    panel.webview.html = await this.reactWebviewHtmlWorkflow.createReactWebviewHtml({
      extensionUri: context.extensionUri,
      webview: panel.webview,
      routeName: API_PROXY_EDITOR_WEBVIEW_ROUTE,
    });

    this.disposables.push(
      panel.webview.onDidReceiveMessage(async (message: ApiProxyWebviewMessage) => {
        await this.handleMessage(message);
      }),
      panel.onDidDispose(() => {
        if (this.editorPanel === panel) {
          this.editorPanel = undefined;
        }
      }),
    );

    this.postState();
    this.postActiveRuleChanged();
  }

  public dispose(): void {
    this.stopServer();
    this.proxy.close();

    while (this.disposables.length > 0) {
      this.disposables.pop()?.dispose();
    }
  }

  private async handleMessage(message: ApiProxyWebviewMessage): Promise<void> {
    switch (message.type) {
      case 'apiProxyReady':
        this.postState();
        break;

      case 'saveApiProxyRules':
        this.rules = Array.isArray(message.rules) ? message.rules : [];
        this.syncGroupsWithRules();
        await this.persistState();
        this.postState();
        break;

      case 'saveApiProxyGroups':
        this.groups = Array.isArray(message.groups) ? message.groups : [];
        this.syncGroupsWithRules();
        await this.persistState();
        this.postState();
        break;

      case 'openApiProxyEditor':
        await this.openEditor(message.ruleId);
        break;

      case 'createApiProxyInGroup':
        await this.createProxyInGroup(message);
        break;

      case 'renameApiProxyGroup':
        await this.renameGroup(message);
        break;

      case 'deleteApiProxyGroup':
        await this.deleteGroup(message);
        break;

      case 'deleteApiProxyRule':
        await this.deleteRule(message);
        break;

      case 'saveApiProxyServerOptions':
        await this.saveServerOptions(message);
        break;

      case 'startApiProxyServer':
        await this.startServer(message);
        break;

      case 'stopApiProxyServer':
        this.stopServer();
        break;

      case 'openApiProxyExternal':
        await this.openExternalWithConfirm(message.url);
        break;

      case 'clearApiProxyLogs':
        this.logs = [];
        await this.persistState();
        this.postState();
        break;

      default:
        break;
    }
  }

  private async openExternalWithConfirm(url?: string): Promise<void> {
    const value = String(url || '').trim();

    if (!value) return;

    this.addLog('info', `准备在浏览器打开：${value}`, value);

    let uri: vscode.Uri;

    try {
      uri = vscode.Uri.parse(value);
    } catch {
      void vscode.window.showWarningMessage(`无法打开无效地址：${value}`);
      return;
    }

    if (uri.scheme !== 'http' && uri.scheme !== 'https') {
      void vscode.window.showWarningMessage(`只支持打开 http/https 地址：${value}`);
      return;
    }

    const confirmed = await vscode.window.showWarningMessage(`是否在浏览器打开：${value}`, { modal: true }, '打开');

    if (confirmed !== '打开') return;

    await vscode.env.openExternal(uri);
  }

  private restoreState(): void {
    const context = this.extensionContextProvider.getContext();
    const state = context.workspaceState.get<{
      rules?: ApiProxyRule[];
      groups?: ApiProxyGroup[];
      logs?: ApiProxyLogItem[];
      activeRuleId?: string;
      proxyHost?: string;
      proxyPort?: number;
      devServerOrigin?: string;
    }>(API_PROXY_STORAGE_KEY);

    this.rules = Array.isArray(state?.rules) ? state.rules : [];
    this.groups = Array.isArray(state?.groups) ? state.groups : [];
    this.logs = Array.isArray(state?.logs) ? state.logs : [];
    this.activeRuleId = state?.activeRuleId || this.rules[0]?.id || '';
    this.proxyHost = this.normalizeListenHost(state?.proxyHost);
    this.proxyPort = Number(state?.proxyPort) || API_PROXY_DEFAULT_PORT;
    this.devServerOrigin = this.normalizeHttpOrigin(state?.devServerOrigin, API_PROXY_DEFAULT_DEV_SERVER_ORIGIN);
    this.serverState = this.createStoppedServerState();

    this.syncGroupsWithRules();
  }

  private async persistState(): Promise<void> {
    const context = this.extensionContextProvider.getContext();

    await context.workspaceState.update(API_PROXY_STORAGE_KEY, {
      rules: this.rules,
      groups: this.groups,
      logs: this.logs.slice(-300),
      activeRuleId: this.activeRuleId,
      proxyHost: this.proxyHost,
      proxyPort: this.proxyPort,
      devServerOrigin: this.devServerOrigin,
    });
  }

  private async saveServerOptions(options: { listenHost?: string; listenPort?: number | string; devServerOrigin?: string }): Promise<void> {
    if (this.serverState.running) {
      this.postState();
      return;
    }

    this.applyServerOptions(options);
    this.serverState = this.createStoppedServerState();

    await this.persistState();
    this.postState();
  }

  private async startServer(options?: { listenHost?: string; listenPort?: number | string; devServerOrigin?: string }): Promise<void> {
    if (this.server) {
      this.serverState = {
        ...this.serverState,
        running: true,
      };
      this.postState();
      return;
    }

    this.applyServerOptions(options);
    await this.persistState();

    if (this.isListenSameAsDevServer()) {
      const message = `代理监听地址不能和前端服务地址相同：${this.createProxyOrigin(this.proxyHost, this.proxyPort)}`;

      this.addLog('error', message);
      void vscode.window.showErrorMessage(message);
      this.serverState = this.createStoppedServerState();
      this.postState();
      return;
    }

    const server = http.createServer((req, res) => {
      this.handleProxyRequest(req, res);
    });

    server.on('upgrade', (req, socket, head) => {
      this.handleProxyUpgrade(req, socket, head);
    });

    try {
      await new Promise<void>((resolve, reject) => {
        const handleError = (error: NodeJS.ErrnoException) => {
          server.off('listening', handleListening);
          reject(error);
        };

        const handleListening = () => {
          server.off('error', handleError);
          resolve();
        };

        server.once('error', handleError);
        server.once('listening', handleListening);
        server.listen(this.proxyPort, this.proxyHost);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      this.addLog('error', `代理服务启动失败：${message}`);
      void vscode.window.showErrorMessage(`接口代理服务启动失败：${message}`);

      try {
        server.close();
      } catch {
        // ignore close errors from a server that failed before listening
      }

      this.serverState = this.createStoppedServerState();
      this.postState();
      return;
    }

    this.server = server;
    this.server.on('error', (error) => {
      this.addLog('error', `代理服务运行异常：${error.message}`);
      this.stopServer();
    });

    const address = this.server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    this.proxyPort = port || this.proxyPort;

    this.serverState = {
      running: true,
      port,
      origin: port ? this.createProxyOrigin(this.proxyHost, port) : '',
      listenHost: this.proxyHost,
      listenHosts: this.getListenHostOptions(),
      listenPort: this.proxyPort,
      devServerOrigin: this.devServerOrigin,
    };

    this.addLog('success', `代理服务已启动：${this.serverState.origin}`);
    this.postState();
  }

  private stopServer(): void {
    if (this.server) {
      this.server.close();
      this.server = undefined;
    }

    if (this.serverState.running) {
      this.addLog('info', '代理服务已停止');
    }

    this.serverState = this.createStoppedServerState();
    this.postState();
  }

  private applyServerOptions(options?: { listenHost?: string; listenPort?: number | string; devServerOrigin?: string }): void {
    if (!options) return;

    if (options.listenHost !== undefined) {
      this.proxyHost = this.normalizeListenHost(options.listenHost);
    }

    if (options.listenPort !== undefined) {
      this.proxyPort = this.normalizeListenPort(options.listenPort);
    }

    if (options.devServerOrigin !== undefined) {
      this.devServerOrigin = this.normalizeHttpOrigin(options.devServerOrigin, this.devServerOrigin);
    }
  }

  private normalizeListenHost(host?: string): string {
    const value = String(host || '').trim();

    if (!value) {
      return DEFAULT_SERVER.listenHost;
    }

    try {
      if (/^https?:\/\//i.test(value)) {
        return new URL(value).hostname || DEFAULT_SERVER.listenHost;
      }
    } catch {
      return DEFAULT_SERVER.listenHost;
    }

    return (
      value
        .replace(/^https?:\/\//i, '')
        .replace(/\/.*$/, '')
        .split(':')[0] || DEFAULT_SERVER.listenHost
    );
  }

  private normalizeListenPort(port?: number | string): number {
    const value = typeof port === 'number' ? port : Number(String(port || '').trim());

    if (!Number.isFinite(value)) {
      return API_PROXY_DEFAULT_PORT;
    }

    const normalizedPort = Math.floor(value);

    if (normalizedPort <= 0 || normalizedPort > 65535) {
      return API_PROXY_DEFAULT_PORT;
    }

    return normalizedPort;
  }

  private normalizeHttpOrigin(origin?: string, fallback: string = API_PROXY_DEFAULT_DEV_SERVER_ORIGIN): string {
    const value = String(origin || '').trim();

    if (!value) {
      return fallback;
    }

    try {
      const url = new URL(/^https?:\/\//i.test(value) ? value : `http://${value}`);

      return `${url.protocol}//${url.host}`;
    } catch {
      return fallback;
    }
  }

  private createStoppedServerState(): ApiProxyServerState {
    return {
      running: false,
      port: 0,
      origin: '',
      listenHost: this.proxyHost,
      listenHosts: this.getListenHostOptions(),
      listenPort: this.proxyPort,
      devServerOrigin: this.devServerOrigin,
    };
  }

  private getListenHostOptions(): string[] {
    const hosts = new Set<string>(['127.0.0.1', '0.0.0.0']);
    const interfaces = os.networkInterfaces();

    Object.values(interfaces).forEach((addresses) => {
      (addresses || []).forEach((address) => {
        if (!address || address.family !== 'IPv4' || address.internal) {
          return;
        }

        hosts.add(address.address);
      });
    });

    if (this.proxyHost) {
      hosts.add(this.proxyHost);
    }

    return Array.from(hosts);
  }

  private createProxyOrigin(host: string, port: number): string {
    const originHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
    const normalizedHost = originHost.includes(':') && !originHost.startsWith('[') ? `[${originHost}]` : originHost;

    return `http://${normalizedHost}:${port}`;
  }

  private isListenSameAsDevServer(): boolean {
    try {
      const devServerUrl = new URL(this.devServerOrigin);
      const devServerPort = Number(devServerUrl.port || (devServerUrl.protocol === 'https:' ? 443 : 80));

      if (devServerPort !== this.proxyPort) {
        return false;
      }

      const listenHost = this.proxyHost.toLowerCase();
      const devServerHost = devServerUrl.hostname.toLowerCase();
      const localHosts = new Set(['127.0.0.1', 'localhost', '0.0.0.0', '::1', '::']);

      return listenHost === devServerHost || (localHosts.has(listenHost) && localHosts.has(devServerHost));
    } catch {
      return false;
    }
  }

  private handleProxyRequest(req: IncomingMessage, res: ServerResponse): void {
    this.setCorsHeaders(res);

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    const sourceUrl = this.getRequestUrl(req);
    const proxyTarget = this.resolveProxyTarget(sourceUrl);

    if (!proxyTarget?.targetUrl) {
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(
        JSON.stringify({
          message: '代理目标地址无效',
          url: sourceUrl.toString(),
        }),
      );
      this.addLog('error', '代理目标地址无效', sourceUrl.toString());
      return;
    }

    const { targetUrl, matched } = proxyTarget;
    const targetOrigin = `${targetUrl.protocol}//${targetUrl.host}`;
    req.url = `${targetUrl.pathname}${targetUrl.search}`;

    if (matched) {
      this.apiProxyRequests.add(req);
      this.apiProxyRequestTargets.set(req, {
        source: sourceUrl.toString(),
        target: targetUrl.toString(),
      });
      this.addLog('info', `${req.method || 'GET'} ${sourceUrl.pathname} -> ${targetUrl.toString()}`, sourceUrl.toString(), targetUrl.toString());
    }

    this.proxy.web(req, res, {
      target: targetOrigin,
      changeOrigin: true,
      secure: false,
    });
  }

  private handleProxyUpgrade(req: IncomingMessage, socket: Socket, head: Buffer): void {
    const sourceUrl = this.getRequestUrl(req);
    const proxyTarget = this.resolveProxyTarget(sourceUrl);

    if (!proxyTarget?.targetUrl) {
      socket.destroy();
      return;
    }

    const { targetUrl } = proxyTarget;
    const targetOrigin = `${targetUrl.protocol}//${targetUrl.host}`;
    req.url = `${targetUrl.pathname}${targetUrl.search}`;

    this.proxy.ws(req, socket, head, {
      target: targetOrigin,
      changeOrigin: true,
      secure: false,
    });
  }

  private registerProxyEvents(): void {
    this.proxy.on('proxyRes', (proxyRes, req) => {
      proxyRes.headers['access-control-allow-origin'] = '*';
      proxyRes.headers['access-control-allow-methods'] = 'GET,POST,PUT,PATCH,DELETE,OPTIONS';
      proxyRes.headers['access-control-allow-headers'] = '*';

      if (!this.apiProxyRequests.has(req)) {
        return;
      }

      const targetInfo = this.apiProxyRequestTargets.get(req);
      const chunks: Buffer[] = [];
      let receivedSize = 0;
      const maxLogBodySize = 4096;

      proxyRes.on('data', (chunk: Buffer) => {
        if (receivedSize >= maxLogBodySize) {
          return;
        }

        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        const nextChunk = buffer.subarray(0, Math.max(0, maxLogBodySize - receivedSize));

        chunks.push(nextChunk);
        receivedSize += nextChunk.length;
      });

      proxyRes.on('end', () => {
        const statusCode = proxyRes.statusCode || 0;
        const level = statusCode >= 400 ? 'error' : 'success';
        const responseBody = Buffer.concat(chunks).toString('utf8').trim();
        const detail = [
          targetInfo?.target ? `target: ${targetInfo.target}` : '',
          responseBody ? `response: ${responseBody}${receivedSize >= maxLogBodySize ? '\n...响应内容过长，已截断' : ''}` : '',
        ]
          .filter(Boolean)
          .join('\n');

        this.addLog(level, `${req.method || 'GET'} ${targetInfo?.source || req.url || ''} 响应 ${statusCode}`, targetInfo?.source, detail || targetInfo?.target);
        this.apiProxyRequestTargets.delete(req);
      });
    });

    this.proxy.on('error', (error, req, res) => {
      const targetInfo = this.apiProxyRequestTargets.get(req);

      this.addLog('error', `代理转发失败：${error.message}`, targetInfo?.source || this.getRequestUrl(req).toString(), targetInfo?.target);
      this.apiProxyRequestTargets.delete(req);

      if (!this.isServerResponse(res) || res.headersSent) return;

      this.setCorsHeaders(res);

      res.writeHead(502, {
        'content-type': 'application/json; charset=utf-8',
      });
      res.end(
        JSON.stringify({
          message: '代理转发失败',
          error: error.message,
        }),
      );
    });
  }

  private setCorsHeaders(res: ServerResponse): void {
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('access-control-allow-headers', '*');
  }

  private isServerResponse(res: unknown): res is ServerResponse {
    return !!res && typeof (res as ServerResponse).writeHead === 'function';
  }

  private getRuleMatchItems(rule: ApiProxyRule): ApiProxyMatchItem[] {
    const matches = Array.isArray(rule.matches) && rule.matches.length > 0 ? rule.matches : [{ id: `${rule.id}-legacy`, match: rule.match, target: '' }];

    return matches.filter((item) => String(item.match || '').trim());
  }

  private findMatchedRule(sourceUrl: URL): ApiProxyMatchedRule | null {
    const enabledRules = this.rules.filter((rule) => rule.enabled && this.getRuleMatchItems(rule).length > 0);
    const pathname = sourceUrl.pathname;
    const fullUrl = sourceUrl.toString();

    for (const rule of enabledRules) {
      for (const matchItem of this.getRuleMatchItems(rule)) {
        const matchValue = matchItem.match.trim();

        if (rule.matchType === 'exact' && (matchValue === pathname || matchValue === fullUrl)) {
          return {
            rule,
            match: matchValue,
            target: matchItem.target,
          };
        }

        if (rule.matchType !== 'regex') {
          continue;
        }

        try {
          const regex = new RegExp(matchValue);

          if (regex.test(pathname) || regex.test(fullUrl)) {
            return {
              rule,
              match: matchValue,
              target: matchItem.target,
            };
          }
        } catch {
          // Invalid regex rules are ignored while matching.
        }
      }
    }

    return null;
  }

  private resolveProxyTarget(sourceUrl: URL): { targetUrl: URL; matched: ApiProxyMatchedRule | null } | null {
    const matched = this.findMatchedRule(sourceUrl);

    if (matched) {
      const targetUrl = this.resolveTargetUrl(matched.rule, sourceUrl, matched.match, matched.target);

      return targetUrl
        ? {
            targetUrl,
            matched,
          }
        : null;
    }

    return {
      targetUrl: this.resolveDevServerTargetUrl(sourceUrl),
      matched: null,
    };
  }

  private resolveDevServerTargetUrl(sourceUrl: URL): URL {
    return new URL(`${sourceUrl.pathname}${sourceUrl.search}`, this.devServerOrigin);
  }

  private resolveTargetUrl(rule: ApiProxyRule, sourceUrl: URL, matchValue: string = rule.match, targetOverride?: string): URL | null {
    try {
      const pathname = sourceUrl.pathname;
      const fullUrl = sourceUrl.toString();
      const rewriteValue = this.resolveRewriteValue(rule, pathname, fullUrl, matchValue);
      const targetUrl = /^https?:\/\//i.test(rewriteValue)
        ? new URL(rewriteValue)
        : new URL(rewriteValue || pathname, this.ensureTargetOrigin(String(targetOverride || '').trim() || rule.target));

      if (rule.preserveQuery && !targetUrl.search) {
        targetUrl.search = sourceUrl.search;
      }

      return targetUrl;
    } catch {
      return null;
    }
  }

  private resolveRewriteValue(rule: ApiProxyRule, pathname: string, fullUrl: string, matchValue: string = rule.match): string {
    if (!rule.rewrite?.trim()) {
      return pathname;
    }

    if (rule.matchType === 'exact') {
      return rule.rewrite.trim();
    }

    const regex = new RegExp(matchValue);

    if (regex.test(pathname)) {
      return pathname.replace(regex, rule.rewrite.trim());
    }

    return fullUrl.replace(regex, rule.rewrite.trim());
  }

  private ensureTargetOrigin(target: string): string {
    const value = target.trim();

    if (!value) {
      return 'http://127.0.0.1';
    }

    return /^https?:\/\//i.test(value) ? value : `http://${value}`;
  }

  private getRequestUrl(req: IncomingMessage): URL {
    const host = req.headers.host || '127.0.0.1';

    return new URL(req.url || '/', `http://${host}`);
  }

  private syncGroupsWithRules(): void {
    const ruleIds = new Set(this.rules.map((rule) => rule.id));
    const groupedRuleIds = new Set<string>();

    this.groups = this.groups.map((group) => {
      const nextRuleIds = (group.ruleIds || []).filter((ruleId) => ruleIds.has(ruleId));
      nextRuleIds.forEach((ruleId) => groupedRuleIds.add(ruleId));

      return {
        ...group,
        ruleIds: nextRuleIds,
      };
    });

    const ungroupedRuleIds = this.rules.map((rule) => rule.id).filter((ruleId) => !groupedRuleIds.has(ruleId));

    if (ungroupedRuleIds.length > 0) {
      const defaultGroup = this.groups.find((group) => group.id === 'default');

      if (defaultGroup) {
        this.groups = this.groups.map((group) =>
          group.id === 'default'
            ? {
                ...group,
                ruleIds: [...new Set([...group.ruleIds, ...ungroupedRuleIds])],
              }
            : group,
        );
      } else {
        this.groups = [
          {
            id: 'default',
            name: '默认分组',
            collapsed: false,
            ruleIds: ungroupedRuleIds,
          },
          ...this.groups,
        ];
      }
    }
  }

  private addLog(level: ApiProxyLogItem['level'], message: string, from?: string, to?: string): void {
    this.logs = [
      ...this.logs.slice(-299),
      {
        id: this.createId('log'),
        time: Date.now(),
        level,
        message,
        from,
        to,
      },
    ];

    void this.persistState();
    this.postState();
  }

  private postState(): void {
    const message = {
      type: 'apiProxyState',
      rules: this.rules,
      groups: this.groups,
      logs: this.logs,
      server: this.serverState,
      activeRuleId: this.activeRuleId,
    };

    void this.view?.webview.postMessage(message);
    void this.editorPanel?.webview.postMessage(message);
  }

  private postActiveRuleChanged(): void {
    void this.view?.webview.postMessage({
      type: 'apiProxyActiveRuleChanged',
      activeRuleId: this.activeRuleId,
    });
  }

  private createId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}
