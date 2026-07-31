import * as http from 'http';
import * as vscode from 'vscode';
import httpProxy = require('http-proxy');
import type { IncomingMessage, ServerResponse } from 'http';
import ReactWebviewHtmlWorkflow from '@/workflow/react-webview-html';
import { ExtensionContextProvider } from '@common/providers/extension-context.provider';

type ApiProxyMatchType = 'exact' | 'regex';

interface ApiProxyRule {
  id: string;
  name: string;
  enabled: boolean;
  matchType: ApiProxyMatchType;
  match: string;
  target: string;
  rewrite?: string;
  preserveQuery: boolean;
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
}

type ApiProxyWebviewMessage =
  | { type: 'apiProxyReady' }
  | { type: 'saveApiProxyRules'; rules: ApiProxyRule[] }
  | { type: 'saveApiProxyGroups'; groups: ApiProxyGroup[] }
  | { type: 'openApiProxyEditor'; ruleId?: string }
  | { type: 'startApiProxyServer' }
  | { type: 'stopApiProxyServer' }
  | { type: 'clearApiProxyLogs' };

const API_PROXY_LIST_WEBVIEW_ROUTE = '/api-proxy';
const API_PROXY_EDITOR_WEBVIEW_ROUTE = '/api-proxy-editor';
const API_PROXY_STORAGE_KEY = 'quickOps.apiProxy.state';
const API_PROXY_EDITOR_PANEL_TYPE = 'quickOps.apiProxyEditor';

const DEFAULT_SERVER: ApiProxyServerState = {
  running: false,
  port: 0,
  origin: '',
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
  private rules: ApiProxyRule[] = [];
  private groups: ApiProxyGroup[] = [];
  private logs: ApiProxyLogItem[] = [];
  private activeRuleId = '';
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

  public async openEditor(ruleId?: string): Promise<void> {
    const context = this.extensionContextProvider.getContext();

    if (ruleId) {
      this.activeRuleId = ruleId;
      await this.persistState();
    }

    if (this.editorPanel) {
      this.editorPanel.reveal(vscode.ViewColumn.One);
      this.postState();
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

      case 'startApiProxyServer':
        await this.startServer();
        break;

      case 'stopApiProxyServer':
        this.stopServer();
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

  private restoreState(): void {
    const context = this.extensionContextProvider.getContext();
    const state = context.workspaceState.get<{
      rules?: ApiProxyRule[];
      groups?: ApiProxyGroup[];
      logs?: ApiProxyLogItem[];
      activeRuleId?: string;
    }>(API_PROXY_STORAGE_KEY);

    this.rules = Array.isArray(state?.rules) ? state.rules : [];
    this.groups = Array.isArray(state?.groups) ? state.groups : [];
    this.logs = Array.isArray(state?.logs) ? state.logs : [];
    this.activeRuleId = state?.activeRuleId || this.rules[0]?.id || '';

    this.syncGroupsWithRules();
  }

  private async persistState(): Promise<void> {
    const context = this.extensionContextProvider.getContext();

    await context.workspaceState.update(API_PROXY_STORAGE_KEY, {
      rules: this.rules,
      groups: this.groups,
      logs: this.logs.slice(-300),
      activeRuleId: this.activeRuleId,
    });
  }

  private async startServer(): Promise<void> {
    if (this.server) {
      this.serverState = {
        ...this.serverState,
        running: true,
      };
      this.postState();
      return;
    }

    this.server = http.createServer((req, res) => {
      this.handleProxyRequest(req, res);
    });

    this.server.on('error', (error) => {
      this.addLog('error', `代理服务启动失败：${error.message}`);
      this.stopServer();
    });

    await new Promise<void>((resolve, reject) => {
      this.server?.listen(0, '127.0.0.1', () => resolve());
      this.server?.once('error', reject);
    });

    const address = this.server.address();
    const port = typeof address === 'object' && address ? address.port : 0;

    this.serverState = {
      running: true,
      port,
      origin: port ? `http://127.0.0.1:${port}` : '',
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

    this.serverState = DEFAULT_SERVER;
    this.postState();
  }

  private handleProxyRequest(req: IncomingMessage, res: ServerResponse): void {
    const sourceUrl = this.getRequestUrl(req);
    const matched = this.findMatchedRule(sourceUrl);

    if (!matched) {
      res.statusCode = 404;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(
        JSON.stringify({
          message: '未命中代理规则',
          url: sourceUrl.toString(),
        }),
      );
      this.addLog('error', '未命中代理规则', sourceUrl.toString());
      return;
    }

    const targetUrl = this.resolveTargetUrl(matched, sourceUrl);

    if (!targetUrl) {
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(
        JSON.stringify({
          message: '代理目标地址无效',
          rule: matched.name,
        }),
      );
      this.addLog('error', `代理目标地址无效：${matched.name}`, sourceUrl.toString());
      return;
    }

    const targetOrigin = `${targetUrl.protocol}//${targetUrl.host}`;
    req.url = `${targetUrl.pathname}${targetUrl.search}`;

    this.addLog('info', `${req.method || 'GET'} ${sourceUrl.pathname} -> ${targetUrl.toString()}`, sourceUrl.toString(), targetUrl.toString());

    this.proxy.web(req, res, {
      target: targetOrigin,
      changeOrigin: true,
      secure: false,
    });
  }

  private registerProxyEvents(): void {
    this.proxy.on('proxyRes', (proxyRes, req) => {
      const statusCode = proxyRes.statusCode || 0;
      const level = statusCode >= 400 ? 'error' : 'success';

      this.addLog(level, `${req.method || 'GET'} ${req.url || ''} 响应 ${statusCode}`);
    });

    this.proxy.on('error', (error, req, res) => {
      this.addLog('error', `代理转发失败：${error.message}`, this.getRequestUrl(req).toString());

      if (!this.isServerResponse(res) || res.headersSent) return;

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

  private isServerResponse(res: unknown): res is ServerResponse {
    return !!res && typeof (res as ServerResponse).writeHead === 'function';
  }

  private findMatchedRule(sourceUrl: URL): ApiProxyRule | null {
    const enabledRules = this.rules.filter((rule) => rule.enabled && rule.match.trim());
    const pathname = sourceUrl.pathname;
    const fullUrl = sourceUrl.toString();

    return (
      enabledRules.find((rule) => {
        if (rule.matchType === 'exact') {
          return rule.match === pathname || rule.match === fullUrl;
        }

        try {
          const regex = new RegExp(rule.match);

          return regex.test(pathname) || regex.test(fullUrl);
        } catch {
          return false;
        }
      }) || null
    );
  }

  private resolveTargetUrl(rule: ApiProxyRule, sourceUrl: URL): URL | null {
    try {
      const pathname = sourceUrl.pathname;
      const fullUrl = sourceUrl.toString();
      const rewriteValue = this.resolveRewriteValue(rule, pathname, fullUrl);
      const targetUrl = /^https?:\/\//i.test(rewriteValue) ? new URL(rewriteValue) : new URL(rewriteValue || pathname, this.ensureTargetOrigin(rule.target));

      if (rule.preserveQuery && !targetUrl.search) {
        targetUrl.search = sourceUrl.search;
      }

      return targetUrl;
    } catch {
      return null;
    }
  }

  private resolveRewriteValue(rule: ApiProxyRule, pathname: string, fullUrl: string): string {
    if (!rule.rewrite?.trim()) {
      return pathname;
    }

    if (rule.matchType === 'exact') {
      return rule.rewrite.trim();
    }

    const regex = new RegExp(rule.match);

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

  private createId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}
