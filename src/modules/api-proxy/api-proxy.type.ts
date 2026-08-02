import * as http from 'http';

export interface ApiProxyServerState {
  running: boolean;
  port: number;
  origin: string;
}

export interface ApiProxyWebviewState {
  rules: ApiProxyRule[];
  logs: ApiProxyLogItem[];
  server: ApiProxyServerState;
}

export interface ApiProxyWebviewMessage {
  type: string;
  rules?: ApiProxyRule[];
  port?: number;
  ruleId?: string;
}

export type ApiProxyMatchType = 'exact' | 'regex';

export interface ApiProxyMatchItem {
  id: string;
  match: string;
  target?: string;
}

export interface ApiProxyRule {
  id: string;
  name: string;
  enabled: boolean;
  matchType: ApiProxyMatchType;
  match: string;
  matches?: ApiProxyMatchItem[];
  target: string;
  rewrite?: string;
  preserveQuery: boolean;
  listenHost?: string;
  listenPort?: number | string;
  devServerOrigin?: string;
}

export interface ApiProxyMatchedRule {
  rule: ApiProxyRule;
  match: string;
  target?: string;
}

export interface ApiProxyRequestMeta {
  matched: boolean;
  ruleId?: string;
  source: string;
  target: string;
}

export interface ApiProxyServerEntry {
  server: http.Server;
  listenHost: string;
  listenPort: number;
  origin: string;
}

export interface ApiProxyGroup {
  id: string;
  name: string;
  collapsed?: boolean;
  ruleIds: string[];
}

export interface ApiProxyLogItem {
  id: string;
  time: number;
  level: 'info' | 'success' | 'error';
  message: string;
  from?: string;
  to?: string;
  ruleId?: string;
}

export interface ApiProxyServerState {
  running: boolean;
  port: number;
  origin: string;
  listenHost: string;
  listenHosts: string[];
  listenPort: number;
  devServerOrigin: string;
}

export interface ApiProxyPersistedState {
  rules?: ApiProxyRule[];
  groups?: ApiProxyGroup[];
  logs?: ApiProxyLogItem[];
  activeRuleId?: string;
  proxyHost?: string;
  proxyPort?: number;
  devServerOrigin?: string;
}

export type ApiProxyWebviewAction =
  | { type: 'apiProxyReady' }
  | { type: 'saveApiProxyRules'; rules: ApiProxyRule[] }
  | { type: 'saveApiProxyGroups'; groups: ApiProxyGroup[] }
  | { type: 'openApiProxyEditor'; ruleId?: string }
  | { type: 'createApiProxyInGroup'; groupId?: string; groupName?: string; collapsed?: boolean; ruleIds?: string[] }
  | { type: 'renameApiProxyGroup'; groupId: string; groupName?: string; collapsed?: boolean; ruleIds?: string[] }
  | { type: 'deleteApiProxyGroup'; groupId: string; groupName?: string }
  | { type: 'deleteApiProxyRule'; ruleId: string; ruleName?: string }
  | { type: 'showApiProxyValidationError'; message?: string; ruleId?: string }
  | { type: 'saveApiProxyServerOptions'; listenHost?: string; listenPort?: number | string; devServerOrigin?: string }
  | { type: 'startApiProxyServer'; rules?: ApiProxyRule[]; listenHost?: string; listenPort?: number | string; devServerOrigin?: string }
  | { type: 'stopApiProxyServer' }
  | { type: 'openApiProxyExternal'; url?: string }
  | { type: 'clearApiProxyLogs' };
