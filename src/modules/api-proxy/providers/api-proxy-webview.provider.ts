import * as http from 'http';
import * as os from 'os';
import * as vscode from 'vscode';
import httpProxy = require('http-proxy');
import type { IncomingMessage, ServerResponse } from 'http';
import type { Socket } from 'net';
import WebviewWorkflow from '@/workflow/webview';
import ReactWebviewHtmlWorkflow from '@/workflow/react-webview-html';
import { ExtensionContextProvider } from '@common/providers/extension-context.provider';
import type { WebviewEnhancerOptions } from '@plugins/webview-enhancer/type';
import {
  API_PROXY_LIST_WEBVIEW_ROUTE,
  API_PROXY_EDITOR_WEBVIEW_ROUTE,
  API_PROXY_STORAGE_KEY,
  API_PROXY_EDITOR_PANEL_TYPE,
  API_PROXY_DEFAULT_PORT,
  API_PROXY_DEFAULT_DEV_SERVER_ORIGIN,
  DEFAULT_SERVER,
} from '@modules/api-proxy/constants/api-proxy.constant';
import type {
  ApiProxyServerState,
  ApiProxyServerEntry,
  ApiProxyRequestMeta,
  ApiProxyRule,
  ApiProxyGroup,
  ApiProxyLogItem,
  ApiProxyWebviewAction,
  ApiProxyPersistedState,
  ApiProxyMatchItem,
  ApiProxyMatchedRule,
} from '@modules/api-proxy/api-proxy.type';

export class ApiProxyWebviewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  public static readonly listViewType = 'quickOpsApiProxyList';

  public static inject = [ExtensionContextProvider];

  private readonly webviewWorkflow = new WebviewWorkflow();
  private readonly reactWebviewHtmlWorkflow = new ReactWebviewHtmlWorkflow();
  private view?: vscode.WebviewView;
  private editorPanel?: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly proxy = httpProxy.createProxyServer({
    changeOrigin: true,
    secure: false,
    ws: true,
  });

  private readonly servers = new Map<string, ApiProxyServerEntry>();
  private readonly apiProxyRequestMeta = new WeakMap<IncomingMessage, ApiProxyRequestMeta>();
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
      webviewView.webview.onDidReceiveMessage(async (message: ApiProxyWebviewAction) => {
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

    const groupName = this.createUniqueName(
      name?.trim() || '',
      this.groups.map((group) => group.name),
    );

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

    const targetGroupId = this.getActiveRuleGroupId() || this.groups[0]?.id || '';
    const proxyName = this.createUniqueProxyNameInGroup(name?.trim() || '', targetGroupId);

    if (!proxyName) return;

    const rule = this.createEmptyProxyRule(proxyName);

    this.rules = [...this.rules, rule];

    if (targetGroupId) {
      this.groups = this.groups.map((group) =>
        group.id === targetGroupId
          ? {
              ...group,
              ruleIds: [...new Set([...(group.ruleIds || []), rule.id])],
            }
          : group,
      );
    }

    this.activeRuleId = rule.id;
    this.syncGroupsWithRules();
    await this.persistState();
    this.postState();
    await this.openEditor(rule.id);
  }

  private async createProxyInGroup(message: Extract<ApiProxyWebviewAction, { type: 'createApiProxyInGroup' }>): Promise<void> {
    const name = await vscode.window.showInputBox({
      title: '新建代理',
      prompt: '请输入代理名称',
      placeHolder: '例如：登录接口',
      value: '新建代理',
      ignoreFocusOut: true,
    });

    const proxyName = this.createUniqueProxyNameInGroup(name?.trim() || '', message.groupId || '');

    if (!proxyName) return;

    const rule = this.createEmptyProxyRule(proxyName);

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

  private async renameGroup(message: Extract<ApiProxyWebviewAction, { type: 'renameApiProxyGroup' }>): Promise<void> {
    if (!message.groupId || message.groupId === 'ungrouped') return;

    const name = await vscode.window.showInputBox({
      title: '分组重命名',
      prompt: '请输入新的分组名称',
      value: message.groupName || '默认分组',
      ignoreFocusOut: true,
    });

    const groupName = this.createUniqueName(
      name?.trim() || '',
      this.groups.filter((group) => group.id !== message.groupId).map((group) => group.name),
    );

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

  private async deleteGroup(message: Extract<ApiProxyWebviewAction, { type: 'deleteApiProxyGroup' }>): Promise<void> {
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

  private async deleteRule(message: Extract<ApiProxyWebviewAction, { type: 'deleteApiProxyRule' }>): Promise<void> {
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

    let panel: vscode.WebviewPanel | undefined;

    panel = await this.webviewWorkflow.createWebview<unknown, WebviewEnhancerOptions>({
      key: API_PROXY_EDITOR_PANEL_TYPE,
      viewType: API_PROXY_EDITOR_PANEL_TYPE,
      title: '接口代理配置',
      column: vscode.ViewColumn.One,
      extensionUri: context.extensionUri,
      icon: 'resources/icons/api-proxy-editor.svg',
      fullscreen: false,
      floating: false,
      revealIfExists: false,
      options: {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [context.extensionUri],
      },
      htmlFactory: async (webview) => {
        return this.reactWebviewHtmlWorkflow.createReactWebviewHtml({
          extensionUri: context.extensionUri,
          webview,
          routeName: API_PROXY_EDITOR_WEBVIEW_ROUTE,
        });
      },
      onDidReceiveMessage: async (message) => {
        await this.handleMessage(message as ApiProxyWebviewAction);
      },
      onDidDispose: () => {
        if (this.editorPanel === panel) {
          this.editorPanel = undefined;
        }
      },
    });

    this.editorPanel = panel;

    this.postState();
    this.postActiveRuleChanged();
  }

  public async dispose(): Promise<void> {
    await this.shutdownServerOnDispose();
    this.proxy.close();

    while (this.disposables.length > 0) {
      this.disposables.pop()?.dispose();
    }
  }

  private async handleMessage(message: ApiProxyWebviewAction): Promise<void> {
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

      case 'showApiProxyValidationError':
        await this.showValidationError(message);
        break;

      case 'saveApiProxyServerOptions':
        await this.saveServerOptions(message);
        break;

      case 'startApiProxyServer':
        await this.startServer(message);
        break;

      case 'stopApiProxyServer':
        await this.stopServer();
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

  private async showValidationError(message: Extract<ApiProxyWebviewAction, { type: 'showApiProxyValidationError' }>): Promise<void> {
    const text = message.message || '代理配置校验未通过，不能启动。';

    if (message.ruleId) {
      this.activeRuleId = message.ruleId;
      await this.persistState();
      this.postActiveRuleChanged();
      await this.openEditor(message.ruleId);
    }

    void vscode.window.showWarningMessage(text);
  }

  private restoreState(): void {
    const context = this.extensionContextProvider.getContext();
    const globalState = context.globalState.get<ApiProxyPersistedState>(API_PROXY_STORAGE_KEY);
    const workspaceState = context.workspaceState.get<ApiProxyPersistedState>(API_PROXY_STORAGE_KEY);
    const state = globalState || workspaceState;

    this.rules = Array.isArray(state?.rules)
      ? state.rules.map((rule) => ({
          ...rule,
          enabled: false,
        }))
      : [];
    this.groups = Array.isArray(state?.groups) ? state.groups : [];
    this.logs = [];
    this.activeRuleId = state?.activeRuleId || this.rules[0]?.id || '';
    this.proxyHost = this.normalizeListenHost(state?.proxyHost);
    this.proxyPort = Number(state?.proxyPort) || API_PROXY_DEFAULT_PORT;
    this.devServerOrigin = this.normalizeHttpOrigin(state?.devServerOrigin, API_PROXY_DEFAULT_DEV_SERVER_ORIGIN);
    this.serverState = this.createStoppedServerState();

    this.syncGroupsWithRules();

    void this.persistState();
  }

  private async persistState(): Promise<void> {
    const context = this.extensionContextProvider.getContext();
    const state = {
      rules: this.rules,
      groups: this.groups,
      logs: this.logs.slice(-300),
      activeRuleId: this.activeRuleId,
      proxyHost: this.proxyHost,
      proxyPort: this.proxyPort,
      devServerOrigin: this.devServerOrigin,
    };

    await context.globalState.update(API_PROXY_STORAGE_KEY, state);
    await context.workspaceState.update(API_PROXY_STORAGE_KEY, undefined);
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

  private async startServer(options?: { rules?: ApiProxyRule[]; listenHost?: string; listenPort?: number | string; devServerOrigin?: string }): Promise<void> {
    this.applyServerOptions(options);

    if (Array.isArray(options?.rules)) {
      this.rules = options.rules;
      this.syncGroupsWithRules();
    }

    this.rules = this.rules.map((rule) => (rule.enabled ? this.sanitizeRuleForSave(rule) : rule));

    const invalidRule = this.rules.find((rule) => rule.enabled && this.getRuleValidationMessage(rule));

    if (invalidRule) {
      const message = this.getRuleValidationMessage(invalidRule) || '代理配置校验未通过，不能启动。';

      this.rules = this.rules.map((rule) =>
        rule.id === invalidRule.id
          ? {
              ...rule,
              enabled: false,
            }
          : rule,
      );
      this.activeRuleId = invalidRule.id;
      await this.persistState();
      this.addLog('error', message);
      void vscode.window.showWarningMessage(message);
      this.postActiveRuleChanged();
      await this.openEditor(invalidRule.id);
      this.postState({
        validationRuleId: invalidRule.id,
      });
      return;
    }

    const enabledRules = this.rules.filter((rule) => rule.enabled);
    const nextServerKeys = new Set(enabledRules.map((rule) => this.getRuleServerKey(rule)));

    await this.persistState();

    this.logs = [];

    for (const [serverKey, entry] of Array.from(this.servers.entries())) {
      if (nextServerKeys.has(serverKey)) {
        continue;
      }

      entry.server.close();
      this.servers.delete(serverKey);
    }

    for (const rule of enabledRules) {
      const serverKey = this.getRuleServerKey(rule);

      if (this.servers.has(serverKey)) {
        continue;
      }

      if (this.isListenSameAsDevServer(rule)) {
        const message = `代理监听地址不能和前端服务地址相同：${this.createProxyOrigin(this.getRuleListenHost(rule), this.getRuleListenPort(rule))}`;

        this.disableRulesByServerKey(serverKey);
        await this.persistState();
        this.addLog('error', message);
        void vscode.window.showErrorMessage(message);
        this.updateServerStateFromRunningServers(rule);
        this.postState();
        return;
      }

      const listenHost = this.getRuleListenHost(rule);
      const listenPort = this.getRuleListenPort(rule);
      const server = http.createServer((req, res) => {
        this.handleProxyRequest(serverKey, req, res);
      });

      server.on('upgrade', (req, socket, head) => {
        this.handleProxyUpgrade(serverKey, req, socket as Socket, head);
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
          server.listen(listenPort, listenHost);
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        this.disableRulesByServerKey(serverKey);
        await this.persistState();
        this.addLog('error', `代理服务启动失败：${message}`);
        void vscode.window.showErrorMessage(`接口代理服务启动失败：${message}`);

        try {
          server.close();
        } catch {
          // ignore close errors from a server that failed before listening
        }

        this.updateServerStateFromRunningServers(rule);
        this.postState();
        return;
      }

      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : listenPort;
      const origin = this.createProxyOrigin(listenHost, port);

      this.servers.set(serverKey, {
        server,
        listenHost,
        listenPort: port,
        origin,
      });

      server.on('error', (error) => {
        this.addLog('error', `代理服务运行异常：${error.message}`);
        void this.stopServerByKey(serverKey);
      });

      this.addLog('success', `代理服务已启动：${origin}`);
    }

    this.updateServerStateFromRunningServers(enabledRules.find((rule) => rule.id === this.activeRuleId) || enabledRules[0]);
    this.postState();
  }

  private async stopServer(): Promise<void> {
    this.closeAllServers();

    this.disableEnabledRules();
    this.logs = [];
    this.serverState = this.createStoppedServerState();
    await this.persistState();
    this.postState();
  }

  private async shutdownServerOnDispose(): Promise<void> {
    this.closeAllServers();

    this.disableEnabledRules();
    this.serverState = this.createStoppedServerState();

    await this.persistState();
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

  private getRuleListenHost(rule?: ApiProxyRule): string {
    return this.normalizeListenHost(rule?.listenHost || this.proxyHost);
  }

  private getRuleListenPort(rule?: ApiProxyRule): number {
    return this.normalizeListenPort(rule?.listenPort || this.proxyPort);
  }

  private getRuleDevServerOrigin(rule?: ApiProxyRule): string {
    return this.normalizeHttpOrigin(rule?.devServerOrigin || this.devServerOrigin, this.devServerOrigin);
  }

  private getRuleServerKey(rule: ApiProxyRule): string {
    return `${this.getRuleListenHost(rule)}:${this.getRuleListenPort(rule)}`;
  }

  private closeAllServers(): void {
    this.servers.forEach((entry) => {
      entry.server.close();
    });
    this.servers.clear();
  }

  private async stopServerByKey(serverKey: string): Promise<void> {
    const entry = this.servers.get(serverKey);

    if (entry) {
      entry.server.close();
      this.servers.delete(serverKey);
    }

    this.disableRulesByServerKey(serverKey);
    this.updateServerStateFromRunningServers();
    await this.persistState();
    this.postState();
  }

  private updateServerStateFromRunningServers(preferredRule?: ApiProxyRule): void {
    const preferredKey = preferredRule ? this.getRuleServerKey(preferredRule) : '';
    const preferredEntry = preferredKey ? this.servers.get(preferredKey) : undefined;
    const firstEntry = preferredEntry || Array.from(this.servers.values())[0];

    if (!firstEntry) {
      this.serverState = this.createStoppedServerState();
      return;
    }

    this.proxyHost = firstEntry.listenHost;
    this.proxyPort = firstEntry.listenPort;

    this.serverState = {
      running: true,
      port: firstEntry.listenPort,
      origin: firstEntry.origin,
      listenHost: firstEntry.listenHost,
      listenHosts: this.getListenHostOptions(),
      listenPort: firstEntry.listenPort,
      devServerOrigin: preferredRule ? this.getRuleDevServerOrigin(preferredRule) : this.devServerOrigin,
    };
  }

  private isListenSameAsDevServer(rule?: ApiProxyRule): boolean {
    try {
      const devServerUrl = new URL(this.getRuleDevServerOrigin(rule));
      const devServerPort = Number(devServerUrl.port || (devServerUrl.protocol === 'https:' ? 443 : 80));
      const listenPort = rule ? this.getRuleListenPort(rule) : this.proxyPort;

      if (devServerPort !== listenPort) {
        return false;
      }

      const listenHost = (rule ? this.getRuleListenHost(rule) : this.proxyHost).toLowerCase();
      const devServerHost = devServerUrl.hostname.toLowerCase();
      const localHosts = new Set(['127.0.0.1', 'localhost', '0.0.0.0', '::1', '::']);

      return listenHost === devServerHost || (localHosts.has(listenHost) && localHosts.has(devServerHost));
    } catch {
      return false;
    }
  }

  private handleProxyRequest(serverKey: string, req: IncomingMessage, res: ServerResponse): void {
    this.setCorsHeaders(res);

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    const sourceUrl = this.getRequestUrl(req);
    const proxyTarget = this.resolveProxyTarget(serverKey, sourceUrl);

    if (!proxyTarget?.targetUrl) {
      const matchedRule = this.findMatchedRule(serverKey, sourceUrl);

      res.statusCode = 500;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(
        JSON.stringify({
          message: '代理目标地址无效',
          url: sourceUrl.toString(),
        }),
      );

      if (matchedRule) {
        this.addLog('error', '代理目标地址无效', sourceUrl.toString(), undefined, matchedRule.rule.id);
      }
      return;
    }

    const { targetUrl, matched } = proxyTarget;
    const targetOrigin = `${targetUrl.protocol}//${targetUrl.host}`;
    req.url = `${targetUrl.pathname}${targetUrl.search}`;
    this.apiProxyRequestMeta.set(req, {
      matched: !!matched,
      ruleId: matched?.rule.id,
      source: sourceUrl.toString(),
      target: targetUrl.toString(),
    });

    if (matched) {
      this.addLog('info', `${req.method || 'GET'} ${sourceUrl.pathname} -> ${targetUrl.toString()}`, sourceUrl.toString(), targetUrl.toString(), matched.rule.id);
    }

    this.proxy.web(req, res, {
      target: targetOrigin,
      changeOrigin: true,
      secure: false,
    });
  }

  private handleProxyUpgrade(serverKey: string, req: IncomingMessage, socket: Socket, head: Buffer): void {
    const sourceUrl = this.getRequestUrl(req);
    const proxyTarget = this.resolveProxyTarget(serverKey, sourceUrl);

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

      const requestMeta = this.apiProxyRequestMeta.get(req);

      if (!requestMeta?.matched) {
        this.apiProxyRequestMeta.delete(req);
        return;
      }

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
          requestMeta.target ? `target: ${requestMeta.target}` : '',
          responseBody ? `response: ${responseBody}${receivedSize >= maxLogBodySize ? '\n...响应内容过长，已截断' : ''}` : '',
        ]
          .filter(Boolean)
          .join('\n');

        this.addLog(
          level,
          `${req.method || 'GET'} ${requestMeta.source || req.url || ''} 响应 ${statusCode}`,
          requestMeta.source,
          detail || requestMeta.target,
          requestMeta.ruleId,
        );
        this.apiProxyRequestMeta.delete(req);
      });
    });

    this.proxy.on('error', (error, req, res) => {
      const requestMeta = this.apiProxyRequestMeta.get(req);

      if (requestMeta?.matched) {
        const proxyErrorMessage = this.getProxyErrorMessage(error, requestMeta.target);
        const proxyErrorDetail = this.getProxyErrorDetail(error, requestMeta.target);

        this.addLog('error', proxyErrorMessage, requestMeta.source || this.getRequestUrl(req).toString(), proxyErrorDetail, requestMeta.ruleId);
      }

      this.apiProxyRequestMeta.delete(req);

      if (!this.isServerResponse(res) || res.headersSent) return;

      this.setCorsHeaders(res);

      res.writeHead(502, {
        'content-type': 'application/json; charset=utf-8',
      });
      res.end(
        JSON.stringify({
          message: '代理转发失败',
          error: error.message,
          target: requestMeta?.target,
          suggestion: this.getProxyErrorSuggestion(error),
        }),
      );
    });
  }

  private getProxyErrorMessage(error: Error, target?: string): string {
    const code = (error as NodeJS.ErrnoException).code;

    if (code === 'ECONNREFUSED') {
      return `代理转发失败：目标服务未启动或端口不可达`;
    }

    if (code === 'ENOTFOUND') {
      return `代理转发失败：目标主机无法解析`;
    }

    if (code === 'ETIMEDOUT' || code === 'ECONNRESET') {
      return `代理转发失败：目标服务连接超时或连接被重置`;
    }

    return `代理转发失败：${error.message || target || '未知错误'}`;
  }

  private getProxyErrorSuggestion(error: Error): string {
    const code = (error as NodeJS.ErrnoException).code;

    if (code === 'ECONNREFUSED') {
      return '请确认转发目标服务已经启动，并且端口和地址填写正确。';
    }

    if (code === 'ENOTFOUND') {
      return '请确认转发目标的域名或主机地址填写正确。';
    }

    if (code === 'ETIMEDOUT' || code === 'ECONNRESET') {
      return '请确认目标服务网络可达，或目标服务没有主动断开连接。';
    }

    return '请查看代理日志中的 from/to 地址确认请求是否转发到预期服务。';
  }

  private getProxyErrorDetail(error: Error, target?: string): string {
    return [target ? `target: ${target}` : '', error.message ? `error: ${error.message}` : '', `suggestion: ${this.getProxyErrorSuggestion(error)}`].filter(Boolean).join('\n');
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

  private sanitizeRuleForSave(rule: ApiProxyRule): ApiProxyRule {
    const matches = this.getRuleMatchItems(rule).map((item) => ({
      ...item,
      match: item.match.trim(),
      target: String(item.target || '').trim(),
    }));

    return {
      ...rule,
      name: rule.name.trim(),
      target: rule.target.trim(),
      rewrite: String(rule.rewrite || '').trim(),
      listenHost: String(rule.listenHost || '').trim(),
      listenPort: Number(rule.listenPort) || undefined,
      devServerOrigin: String(rule.devServerOrigin || '').trim(),
      match: matches[0]?.match || '',
      matches,
    };
  }

  private disableEnabledRules(): void {
    this.rules = this.rules.map((rule) =>
      rule.enabled
        ? {
            ...rule,
            enabled: false,
          }
        : rule,
    );
  }

  private disableRulesByServerKey(serverKey: string): void {
    this.rules = this.rules.map((rule) =>
      rule.enabled && this.getRuleServerKey(rule) === serverKey
        ? {
            ...rule,
            enabled: false,
          }
        : rule,
    );
  }

  private getRuleValidationMessage(rule: ApiProxyRule): string {
    const listenHost = String(rule.listenHost || '').trim();
    const listenPort = Number(rule.listenPort);
    const devServerOrigin = String(rule.devServerOrigin || '').trim();

    if (!listenHost) {
      return '请先选择监听地址。';
    }

    if (!Number.isFinite(listenPort) || listenPort <= 0 || listenPort > 65535) {
      return '请填写有效的监听端口。';
    }

    if (!devServerOrigin) {
      return '请填写前端服务地址。';
    }

    if (!String(rule.name || '').trim()) {
      return '请填写代理名称。';
    }

    if (!String(rule.target || '').trim()) {
      return '请填写公共转发目标。';
    }

    if (this.getRuleMatchItems(rule).length === 0) {
      return '请至少填写一个匹配地址。';
    }

    return '';
  }

  private findMatchedRule(serverKey: string, sourceUrl: URL): ApiProxyMatchedRule | null {
    const enabledRules = this.rules.filter((rule) => rule.enabled && this.getRuleServerKey(rule) === serverKey && this.getRuleMatchItems(rule).length > 0);
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

  private resolveProxyTarget(serverKey: string, sourceUrl: URL): { targetUrl: URL; matched: ApiProxyMatchedRule | null } | null {
    const matched = this.findMatchedRule(serverKey, sourceUrl);

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
      targetUrl: this.resolveDevServerTargetUrl(serverKey, sourceUrl),
      matched: null,
    };
  }

  private resolveDevServerTargetUrl(serverKey: string, sourceUrl: URL): URL {
    const serverRule = this.rules.find((rule) => rule.enabled && this.getRuleServerKey(rule) === serverKey);

    return new URL(`${sourceUrl.pathname}${sourceUrl.search}`, this.getRuleDevServerOrigin(serverRule));
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

  private addLog(level: ApiProxyLogItem['level'], message: string, from?: string, to?: string, ruleId?: string): void {
    this.logs = [
      ...this.logs.slice(-299),
      {
        id: this.createId('log'),
        time: Date.now(),
        level,
        message,
        from,
        to,
        ruleId,
      },
    ];

    void this.persistState();
    this.postState();
  }

  private postState(options?: { validationRuleId?: string }): void {
    const message = {
      type: 'apiProxyState',
      rules: this.rules,
      groups: this.groups,
      logs: this.logs,
      server: this.serverState,
      activeRuleId: this.activeRuleId,
      validationRuleId: options?.validationRuleId,
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

  private createUniqueName(rawName: string, existingNames: string[]): string {
    const baseName = rawName.trim();

    if (!baseName) return '';

    const usedNames = new Set(existingNames.map((name) => name.trim()).filter(Boolean));

    if (!usedNames.has(baseName)) {
      return baseName;
    }

    let index = 1;
    let nextName = `${baseName}(${index})`;

    while (usedNames.has(nextName)) {
      index += 1;
      nextName = `${baseName}(${index})`;
    }

    return nextName;
  }

  private getActiveRuleGroupId(): string {
    if (!this.activeRuleId) return '';

    return this.groups.find((group) => (group.ruleIds || []).includes(this.activeRuleId))?.id || '';
  }

  private getRuleIdsByGroupId(groupId: string): string[] {
    if (!groupId) return [];

    const group = this.groups.find((item) => item.id === groupId);

    if (group) {
      return group.ruleIds || [];
    }

    const groupedRuleIds = new Set<string>();
    this.groups.forEach((item) => {
      (item.ruleIds || []).forEach((ruleId) => groupedRuleIds.add(ruleId));
    });

    return this.rules.filter((rule) => !groupedRuleIds.has(rule.id)).map((rule) => rule.id);
  }

  private createUniqueProxyNameInGroup(rawName: string, groupId: string): string {
    const groupRuleIds = new Set(this.getRuleIdsByGroupId(groupId));
    const existingNames = this.rules.filter((rule) => groupRuleIds.has(rule.id)).map((rule) => rule.name);

    return this.createUniqueName(rawName, existingNames);
  }

  private createEmptyProxyRule(name: string): ApiProxyRule {
    return {
      id: this.createId('proxy'),
      name,
      enabled: false,
      matchType: 'regex',
      match: '',
      matches: [
        {
          id: this.createId('match'),
          match: '',
          target: '',
        },
      ],
      target: '',
      rewrite: '',
      preserveQuery: true,
      listenHost: DEFAULT_SERVER.listenHost,
      listenPort: undefined,
      devServerOrigin: '',
    };
  }
}
